import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { CustomerModel } from "../models/customer.model.js";
import { ProjectModel } from "../models/project.model.js";
import { StaffUsageLogModel } from "../models/staff-usage-log.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import { StockModel } from "../models/stock.model.js";
import { UserModel } from "../models/user.model.js";
import { assertFactoryFeatureLimit } from "../services/subscription.service.js";
export const projectsRoutes = Router();
projectsRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
const projectListQuerySchema = z.object({
    search: z.string().optional().nullable(),
    status: z.enum(["all", "ongoing", "hold", "completed", "cancelled"]).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});
const projectSchema = z.object({
    code: z.string().min(1).optional(),
    name: z.string().min(1),
    customerName: z.string().min(1),
    customerId: z.string().optional().nullable(),
    status: z
        .enum(["ongoing", "hold", "completed", "cancelled"])
        .default("ongoing"),
    progress: z.number().min(0).max(100).default(0),
    subtotal: z.number().nonnegative().default(0),
    taxType: z.enum(["percent", "amount"]).default("percent"),
    taxValue: z.number().nonnegative().default(0),
    taxAmount: z.number().nonnegative().default(0),
    discountType: z.enum(["percent", "amount"]).default("amount"),
    discountValue: z.number().nonnegative().default(0),
    discountAmount: z.number().nonnegative().default(0),
    grandTotal: z.number().nonnegative().default(0),
    delivery: z
        .string()
        .optional()
        .nullable()
        .refine((val) => {
        if (!val)
            return true;
        try {
            const date = new Date(val);
            return !isNaN(date.getTime());
        }
        catch {
            return false;
        }
    }, "Invalid date format"),
    amount: z.number().nonnegative().default(0),
    notes: z.string().optional().nullable(),
    workType: z.string().default("own"),
    materials: z
        .array(z.object({
        id: z.string().optional(),
        source: z.enum(["inventory", "new-stock"]),
        stockItemId: z.string().optional().nullable(),
        materialName: z.string(),
        materialType: z.string(),
        thickness: z.string().optional(),
        quantity: z.number().positive(),
        unit: z.string(),
    }))
        .optional(),
    services: z
        .array(z.object({
        id: z.string().optional(),
        serviceId: z.string().optional().nullable(),
        serviceName: z.string(),
        employeeRole: z.string().optional().nullable(),
        unit: z.string().optional(),
        quantity: z.number().nonnegative().optional(),
        rate: z.number().nonnegative().optional(),
        total: z.number().nonnegative().optional(),
    }))
        .optional(),
    assignedStaff: z
        .array(z.object({
        userId: z.string().min(1),
        status: z.enum(["Not started", "In progress", "On hold", "Completed"]).default("Not started"),
        updatedBy: z.string().optional().nullable(),
        updatedAt: z.string().optional().nullable(),
        assignedAt: z.string().optional().nullable(),
    }))
        .optional(),
});
const workflowSchema = z.object({
    stages: z.array(z.record(z.string(), z.unknown())),
});
const stageAllocationSchema = z.object({
    role: z.string().optional(),
    staffName: z.string().optional(),
    materials: z
        .array(z.object({
        projectMaterialId: z.string().min(1),
        requiredQuantity: z.number().positive(),
    }))
        .min(1)
        .refine((materials) => new Set(materials.map((material) => material.projectMaterialId))
        .size === materials.length, "Each project material can only be allocated once"),
});
const stageUsageSchema = z.object({
    userId: z.string().nullable().optional(),
    serviceId: z.string().optional(),
    role: z.string().optional(),
    staffName: z.string().optional(),
    note: z.string().optional(),
    stageStatus: z.string().optional(),
    usageMode: z.enum(["incremental", "absolute"]).optional(),
    isAdminOverride: z.boolean().optional(),
    directUsage: z.number().nonnegative().optional(),
    materials: z
        .array(z.object({
        projectMaterialId: z.string().min(1),
        quantityUsed: z.number().nonnegative(),
    }))
        .default([])
        .refine((materials) => new Set(materials.map((material) => material.projectMaterialId))
        .size === materials.length, "Each project material can only be submitted once"),
});
function projectFilter(req) {
    return req.user?.globalRole === "super_admin"
        ? {}
        : { factoryId: req.factoryId };
}
function mapProject(project, userId) {
    const row = project?.toObject ? project.toObject() : project;
    const assignedStaffEntries = normalizeAssignedStaffEntries(row);
    const assignedStaffIds = assignedStaffEntries.map((entry) => String(entry.userId)).filter(Boolean);
    return {
        ...row,
        id: String(row._id),
        assignedToMe: userId ? assignedStaffIds.includes(userId) : false,
        assignedStaff: assignedStaffEntries,
        materials: (row.materials ?? []).map((material) => ({
            ...material,
            id: materialId(material),
        })),
        services: (row.services ?? []).map((service) => ({
            ...normalizeServiceRow(service),
        })),
        workflowStages: (row.workflowStages ?? []).map((stage) => ({
            ...stage,
            id: String(stage.id ?? stage._id ?? stage.name ?? ""),
        })),
    };
}
function mapCustomerDetails(row) {
    if (!row)
        return null;
    return {
        id: String(row._id),
        company: row.company || row.companyName || "",
        contact: row.contact || row.name || "",
        phone: row.phone || "",
        email: row.email || "",
        address: row.address || "",
        state: row.state || "",
        district: row.district || "",
        pincode: row.pincode || row.zipCode || "",
        gstin: row.gstin || row.taxId || "",
    };
}
function normalizeAssignedStaffEntries(row) {
    const rawEntries = Array.isArray(row?.assignedStaff) ? row.assignedStaff : [];
    const entriesByUserId = new Map();
    rawEntries.forEach((entry) => {
        const userId = String(entry?.userId ?? entry?.id ?? entry?._id ?? "").trim();
        if (!userId)
            return;
        entriesByUserId.set(userId, {
            userId,
            status: ["Not started", "In progress", "On hold", "Completed"].includes(entry?.status)
                ? entry.status
                : "Not started",
            updatedBy: entry?.updatedBy ? String(entry.updatedBy) : undefined,
            updatedAt: entry?.updatedAt ? new Date(entry.updatedAt) : undefined,
            assignedAt: entry?.assignedAt ? new Date(entry.assignedAt) : undefined,
        });
    });
    (row?.assignedStaffIds ?? []).map(String).filter(Boolean).forEach((userId) => {
        if (!entriesByUserId.has(userId)) {
            entriesByUserId.set(userId, {
                userId,
                status: "Not started",
                updatedBy: undefined,
                updatedAt: undefined,
                assignedAt: undefined,
            });
        }
    });
    return [...entriesByUserId.values()];
}
function upsertAssignedStaffEntry(entries, userId, patch = {}) {
    const nextEntries = [...entries];
    const index = nextEntries.findIndex((entry) => String(entry.userId) === String(userId));
    const current = index >= 0 ? nextEntries[index] : { userId: String(userId), status: "Not started" };
    const nextEntry = {
        ...current,
        ...patch,
        userId: String(userId),
    };
    if (index >= 0) {
        nextEntries[index] = nextEntry;
    }
    else {
        nextEntries.push(nextEntry);
    }
    return nextEntries;
}
async function enrichProjectDetail(project, req) {
    const mapped = mapProject(project, req.user?.id);
    const row = project?.toObject ? project.toObject() : project;
    const serviceUsageSummary = buildProjectServiceUsageSummary(row);
    const assignedStaffEntries = normalizeAssignedStaffEntries(row);
    const assignedStaffIds = assignedStaffEntries.map((entry) => String(entry.userId)).filter(Boolean);
    const projectFactoryFilter = row.factoryId ? { factoryId: row.factoryId } : projectFilter(req);
    const customerQuery = row.customerId
        ? CustomerModel.findOne({ _id: row.customerId, ...projectFilter(req) }).lean()
        : row.customerName
            ? CustomerModel.findOne({
                ...projectFilter(req),
                $or: [{ company: row.customerName }, { companyName: row.customerName }],
            }).lean()
            : Promise.resolve(null);
    const [assignedUsers, customer] = await Promise.all([
        assignedStaffIds.length
            ? UserModel.find({ _id: { $in: assignedStaffIds } }, { name: 1, email: 1 }).lean()
            : Promise.resolve([]),
        customerQuery,
    ]);
    const [allProjects, stockRows] = row.factoryId
        ? await Promise.all([
            ProjectModel.find(projectFactoryFilter, { materials: 1, workflowStages: 1 }).lean(),
            StockModel.find(projectFactoryFilter).lean(),
        ])
        : [[], []];
    const assignedUserById = new Map(assignedUsers.map((user) => [
        String(user._id),
        {
            id: String(user._id),
            name: user.name || user.email || "Staff",
            email: user.email || "",
        },
    ]));
    const assignedStaff = [];
    const workflowStaff = [];
    const seenStaff = new Set();
    const pushStaff = (staff) => {
        const name = staff?.name?.trim();
        if (!name)
            return;
        const key = staff?.id || name.toLowerCase();
        if (seenStaff.has(key))
            return;
        seenStaff.add(key);
        assignedStaff.push({
            id: staff?.id,
            name,
            email: staff?.email || "",
            role: staff?.role || "",
            status: staff?.status || "Not started",
            updatedAt: staff?.updatedAt || undefined,
        });
    };
    assignedStaffEntries.forEach((entry) => {
        const user = assignedUserById.get(entry.userId);
        pushStaff({
            ...(user || {}),
            id: entry.userId,
            role: "Assigned",
            status: entry.status,
            updatedAt: entry.updatedAt,
        });
    });
    (row.workflowStages ?? []).forEach((stage) => {
        const pushWorkflowStaff = (staff) => {
            const name = staff?.name?.trim();
            if (!name)
                return;
            const key = `${staff?.id || name.toLowerCase()}::${staff?.role || ""}`;
            if (seenStaff.has(key))
                return;
            seenStaff.add(key);
            workflowStaff.push({
                id: staff?.id,
                name,
                email: staff?.email || "",
                role: staff?.role || "",
            });
        };
        pushWorkflowStaff({
            id: stage?.configuredBy?.userId ? String(stage.configuredBy.userId) : undefined,
            name: stage?.configuredBy?.staffName,
            role: stage?.configuredBy?.role || stage?.name || "Configured",
        });
        (stage?.usageHistory ?? []).forEach((entry) => {
            pushWorkflowStaff({
                id: entry?.userId ? String(entry.userId) : undefined,
                name: entry?.staffName,
                role: entry?.role || stage?.name || "Updated",
            });
        });
    });
    const materialStockSummary = buildProjectMaterialStockSummary(row, allProjects, stockRows);
    return {
        ...mapped,
        services: serviceUsageSummary,
        serviceUsageSummary,
        materialStockSummary,
        assignedStaffIds,
        assignedStaff,
        workflowStaff,
        customerDetails: mapCustomerDetails(customer),
    };
}
function routeParam(value) {
    return Array.isArray(value) ? value[0] : value;
}
function materialId(material) {
    return String(material.id ?? material._id ?? "");
}
function stageTotals(materials) {
    return {
        completed: materials.reduce((sum, material) => sum + Number(material.completedQuantity ?? 0), 0),
        total: materials.reduce((sum, material) => sum + Number(material.requiredQuantity ?? 0), 0),
    };
}
function normalizeVariant(value) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}
function normalizeThickness(value) {
    const compact = value.trim().replace(/\s+/g, "").toLowerCase();
    const millimeters = compact.match(/^(\d+(?:\.\d+)?)(?:mm)?$/);
    return millimeters ? `${Number(millimeters[1])}mm` : compact;
}
function resolveMaterialStockKeyFromValues(materialType, thickness) {
    const typeKey = normalizeVariant(String(materialType || "").trim());
    const thicknessKey = normalizeThickness(String(thickness || "").trim());
    if (!typeKey || !thicknessKey)
        return "";
    return `${typeKey}::${thicknessKey}`;
}
function resolveMaterialStockKeyFromStock(stock) {
    return resolveMaterialStockKeyFromValues(stock?.type || stock?.material || "", stock?.thickness || "");
}
function resolveMaterialStockKeyFromProjectMaterial(material, stockById = new Map()) {
    if (material?.stockItemId && stockById.has(String(material.stockItemId))) {
        return resolveMaterialStockKeyFromStock(stockById.get(String(material.stockItemId)));
    }
    return resolveMaterialStockKeyFromValues(material?.materialType || material?.materialName || "", material?.thickness || "");
}
function buildProjectMaterialStockSummary(project, allProjects = [], stockRows = []) {
    const stockById = new Map(stockRows.map((stock) => [String(stock._id), stock]));
    const stockTotals = new Map();
    const requiredTotals = new Map();
    const usedTotals = new Map();
    const currentProjectRequired = new Map();
    const targetMaterials = project?.materials ?? [];
    for (const stock of stockRows) {
        const key = resolveMaterialStockKeyFromStock(stock);
        if (!key)
            continue;
        stockTotals.set(key, (stockTotals.get(key) ?? 0) + Number(stock.quantity ?? 0));
    }
    for (const projectRow of allProjects) {
        for (const material of projectRow?.materials ?? []) {
            const key = resolveMaterialStockKeyFromProjectMaterial(material, stockById);
            if (!key)
                continue;
            const quantity = Number(material.quantity ?? 0);
            requiredTotals.set(key, (requiredTotals.get(key) ?? 0) + quantity);
            if (String(projectRow._id) === String(project?._id)) {
                currentProjectRequired.set(key, (currentProjectRequired.get(key) ?? 0) + quantity);
            }
        }
        for (const stage of projectRow?.workflowStages ?? []) {
            for (const stageMaterial of stage?.materials ?? []) {
                const key = resolveMaterialStockKeyFromProjectMaterial(stageMaterial, stockById);
                if (!key)
                    continue;
                const quantity = Number(stageMaterial.completedQuantity ?? 0);
                usedTotals.set(key, (usedTotals.get(key) ?? 0) + quantity);
            }
        }
    }
    return targetMaterials.map((material) => {
        const key = resolveMaterialStockKeyFromProjectMaterial(material, stockById);
        const totalStock = Number(stockTotals.get(key) ?? 0);
        const totalRequired = Number(requiredTotals.get(key) ?? Number(material.quantity ?? 0));
        const totalUsed = Number(usedTotals.get(key) ?? 0);
        const availableRemaining = totalStock - totalUsed;
        const currentProjectQty = Number(currentProjectRequired.get(key) ?? Number(material.quantity ?? 0));
        const status = availableRemaining >= totalRequired
            ? "Sufficient"
            : availableRemaining > 0
                ? "Insufficient (Partial)"
                : "Insufficient";
        return {
            material: material.materialName || material.materialType || "Material",
            materialType: material.materialType || "",
            thickness: material.thickness || "",
            unit: material.unit || "units",
            currentProjectRequired: currentProjectQty,
            totalStock,
            totalRequired,
            totalUsed,
            availableRemaining,
            status,
        };
    });
}
function normalizeServiceRow(service) {
    const quantity = Math.max(0, Number(service.quantity ?? 1));
    const rate = Math.max(0, Number(service.rate ?? 0));
    const total = Math.max(0, Number(service.total ?? quantity * rate));
    return {
        id: String(service.id ?? service._id ?? ""),
        serviceId: service.serviceId ?? null,
        serviceName: String(service.serviceName ?? ""),
        employeeRole: String(service.employeeRole ?? service.role ?? ""),
        unit: String(service.unit ?? ""),
        quantity,
        rate,
        total,
    };
}
function resolveServiceStageKey(value) {
    const name = String(value ?? "").toLowerCase();
    if (name.includes("press"))
        return "pressing";
    if (name.includes("cut"))
        return "cutting";
    if (name.includes("edge"))
        return "edge band";
    if (name.includes("bor"))
        return "boring";
    if (name.includes("pack") || name.includes("deliver"))
        return "packing";
    return name.replace(/machine|mechine/g, "").trim();
}
function resolveMachineUsageKey(value) {
    const name = String(value ?? "").toLowerCase();
    if (name.includes("press"))
        return "pressing";
    if (name.includes("cut"))
        return "cutting";
    return null;
}
function machineStockConsumption(stageRows, materialId) {
    const stage = Array.isArray(stageRows) ? stageRows : [];
    const pressingUsage = Number(stage.find((row) => resolveMachineUsageKey(row?.name) === "pressing")?.materials?.find((material) => String(material.projectMaterialId) === String(materialId))?.completedQuantity ?? 0);
    const cuttingUsage = Number(stage.find((row) => resolveMachineUsageKey(row?.name) === "cutting")?.materials?.find((material) => String(material.projectMaterialId) === String(materialId))?.completedQuantity ?? 0);
    return Math.max(pressingUsage, cuttingUsage);
}
function usageRecordTime(record) {
    const value = record?.updatedAt ?? record?.createdAt ?? 0;
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
}
function buildProjectServiceUsageSummary(project) {
    const stageUsageByKey = new Map();
    const stageUsageByServiceId = new Map();
    (project?.workflowStages ?? []).forEach((stage) => {
        const stageKey = resolveServiceStageKey(stage?.name ?? "");
        const materialUsage = (stage?.materials ?? []).reduce((materialSum, material) => materialSum + Number(material.completedQuantity ?? 0), 0);
        const directUsage = (stage?.usageHistory ?? []).reduce((usageSum, record) => usageSum + Number(record?.directUsage ?? 0), 0);
        const stageUsage = (stage?.materials ?? []).length > 0 ? materialUsage : directUsage;
        if (stageKey) {
            stageUsageByKey.set(stageKey, stageUsage);
        }
        if (stage?.serviceId) {
            stageUsageByServiceId.set(String(stage.serviceId), stageUsage);
        }
    });
    return (project?.services ?? []).map((service) => {
        const normalized = normalizeServiceRow(service);
        const stageKey = resolveServiceStageKey(normalized.employeeRole || normalized.serviceName);
        const serviceKey = String(normalized.serviceId || normalized.id || "");
        const usage =
            stageUsageByServiceId.get(serviceKey) ??
                stageUsageByKey.get(stageKey) ??
                normalized.quantity ??
                0;
        const amount = usage * Number(normalized.rate ?? 0);
        return {
            ...normalized,
            usage,
            amount,
        };
    });
}
function calculateProjectAmount(services = []) {
    return services.reduce((sum, service) => sum + Number(service.total ?? 0), 0);
}
function calculateProjectPricing(services = [], taxType = "percent", taxValue = 0, discountType = "amount", discountValue = 0) {
    const subtotal = calculateProjectAmount(services);
    const resolvedTaxType = taxType === "amount" ? "amount" : "percent";
    const resolvedDiscountType = discountType === "percent" ? "percent" : "amount";
    const discountAmount = resolvedDiscountType === "percent"
        ? subtotal * (Number(discountValue ?? 0) / 100)
        : Number(discountValue ?? 0);
    const discountedBase = Math.max(0, subtotal - discountAmount);
    const taxAmount = resolvedTaxType === "percent"
        ? discountedBase * (Number(taxValue ?? 0) / 100)
        : Number(taxValue ?? 0);
    const grandTotal = Math.max(0, discountedBase + taxAmount);
    return { subtotal, taxAmount, discountAmount, grandTotal, amount: grandTotal };
}
function generateStockCode(type, thickness) {
    const cleaned = `${type}${thickness}`
        .replace(/[^a-z0-9]+/gi, "")
        .slice(0, 10)
        .toUpperCase();
    return `${cleaned || "STK"}${Date.now().toString().slice(-6)}`;
}
async function attachStockItemsToProjectMaterials(factoryId, materials = [], actorId, enforceLimits = true) {
    const syncedMaterials = [];
    for (const material of materials) {
        if (material.source !== "new-stock") {
            syncedMaterials.push(material);
            continue;
        }
        const type = String(material.materialType || material.materialName || "").trim();
        const thickness = String(material.thickness || "").trim();
        const quantity = Number(material.quantity ?? 0);
        const unit = String(material.unit || "sheets").trim() || "sheets";
        if (!type || !thickness || quantity <= 0) {
            syncedMaterials.push(material);
            continue;
        }
        const typeKey = normalizeVariant(type);
        const thicknessKey = normalizeThickness(thickness);
        let stockItem = await StockModel.findOne({
            factoryId,
            typeKey,
            thicknessKey,
        });
        if (stockItem) {
            stockItem.quantity = Number(stockItem.quantity ?? 0) + quantity;
            if (!stockItem.unit)
                stockItem.unit = unit;
            if (!stockItem.material)
                stockItem.material = material.materialName || type;
            if (!stockItem.name)
                stockItem.name = material.materialName || type;
            if (actorId)
                stockItem.updatedBy = actorId;
            await stockItem.save();
        }
        else {
            if (enforceLimits) {
                const limitCheck = await assertFactoryFeatureLimit(factoryId, "stock");
                if (!limitCheck.allowed) {
                    const error = new Error(limitCheck.state.message || "Stock limit reached");
                    error.status = 403;
                    throw error;
                }
            }
            stockItem = await StockModel.create({
                factoryId,
                createdBy: actorId,
                updatedBy: actorId,
                code: generateStockCode(type, thickness),
                name: material.materialName || type,
                material: material.materialName || type,
                category: type,
                type,
                thickness,
                typeKey,
                thicknessKey,
                quantity,
                unit,
            });
        }
        syncedMaterials.push({
            ...material,
            stockItemId: stockItem._id,
            materialName: material.materialName || `${type} ${thickness}`,
            materialType: type,
            thickness,
            unit,
        });
    }
    return syncedMaterials;
}
function dayBounds(date = new Date()) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
}
function isSameDayUsageRecord(entry, input) {
    const createdAt = entry?.createdAt ? new Date(entry.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime()))
        return false;
    if (createdAt < input.start || createdAt >= input.end)
        return false;
    if (input.userId && entry?.userId) {
        return String(entry.userId) === input.userId;
    }
    if (input.staffName?.trim() && entry?.staffName) {
        return (String(entry.staffName).trim().toLowerCase() ===
            input.staffName.trim().toLowerCase());
    }
    return false;
}
async function resolveStaffContext(input) {
    if (!input.factoryId)
        return null;
    const clauses = [];
    if (input.userId)
        clauses.push({ _id: input.userId });
    if (input.staffName?.trim())
        clauses.push({ name: input.staffName.trim() });
    if (!clauses.length)
        return null;
    const user = await UserModel.findOne({
        factoryId: input.factoryId,
        factoryRole: "staff",
        $or: clauses,
    }).lean();
    if (!user)
        return null;
    return { user };
}
projectsRoutes.get("/", requirePagePermission("projects", "view"), async (req, res) => {
    try {
        const parsedQuery = projectListQuerySchema.safeParse(req.query);
        if (!parsedQuery.success)
            return fail(res, 400, "Invalid project query");
        const { search, status, page, limit } = parsedQuery.data;
        const filter = req.user?.globalRole === "super_admin"
            ? {}
            : { factoryId: req.factoryId };
        if (req.query.scope === "mine" && req.user?.globalRole === "staff") {
            Object.assign(filter, { assignedStaffIds: req.user.id });
        }
        if (status && status !== "all") {
            filter.status = status;
        }
        if (search?.trim()) {
            const keyword = search.trim();
            filter.$or = [
                { code: { $regex: keyword, $options: "i" } },
                { name: { $regex: keyword, $options: "i" } },
                { customerName: { $regex: keyword, $options: "i" } },
                { status: { $regex: keyword, $options: "i" } },
            ];
        }
        if (page !== undefined) {
            const pageNumber = page;
            const pageLimit = limit ?? 20;
            const total = await ProjectModel.countDocuments(filter);
            const totalPages = total ? Math.ceil(total / pageLimit) : 0;
            const projects = await ProjectModel.find(filter)
                .sort({ createdAt: -1 })
                .skip((pageNumber - 1) * pageLimit)
                .limit(pageLimit)
                .lean();
            return ok(res, {
                items: projects.map((project) => mapProject(project, req.user?.id)),
                pagination: {
                    page: pageNumber,
                    limit: pageLimit,
                    total,
                    totalPages,
                    hasNext: pageNumber < totalPages,
                    hasPrev: pageNumber > 1,
                },
            });
        }
        const projects = await ProjectModel.find(filter)
            .sort({ createdAt: -1 })
            .lean();
        ok(res, projects.map((project) => mapProject(project, req.user?.id)));
    }
    catch (error) {
        fail(res, 500, error.message);
    }
});
projectsRoutes.get("/:id", requirePagePermission("projects", "view"), async (req, res) => {
    const project = await ProjectModel.findOne({
        _id: req.params.id,
        ...projectFilter(req),
    }).lean();
    if (!project)
        return fail(res, 404, "Project not found");
    ok(res, await enrichProjectDetail(project, req));
});
projectsRoutes.post("/:id/assign-self", requirePagePermission("projects", "view"), async (req, res) => {
    if (req.user?.globalRole !== "staff") {
        return fail(res, 403, "Only staff can add projects to My Projects");
    }
    const project = await ProjectModel.findOne({ _id: req.params.id, ...projectFilter(req) });
    if (!project)
        return fail(res, 404, "Project not found");
    project.assignedStaffIds = Array.from(new Set([...(project.assignedStaffIds ?? []).map(String), String(req.user.id)]));
    project.assignedStaff = upsertAssignedStaffEntry(normalizeAssignedStaffEntries(project), req.user.id, {
        status: "Not started",
        updatedBy: req.user.id,
        updatedAt: new Date(),
        assignedAt: new Date(),
    });
    await project.save();
    const saved = await ProjectModel.findById(project._id).lean();
    if (!saved)
        return fail(res, 404, "Project not found");
    ok(res, mapProject(saved, req.user.id), "Project added to My Projects");
});
projectsRoutes.delete("/:id/assign-self", requirePagePermission("projects", "view"), async (req, res) => {
    if (req.user?.globalRole !== "staff") {
        return fail(res, 403, "Only staff can remove projects from My Projects");
    }
    const project = await ProjectModel.findOne({ _id: req.params.id, ...projectFilter(req) });
    if (!project)
        return fail(res, 404, "Project not found");
    project.assignedStaffIds = (project.assignedStaffIds ?? []).map(String).filter((id) => id !== String(req.user.id));
    project.assignedStaff = normalizeAssignedStaffEntries(project).filter((entry) => String(entry.userId) !== String(req.user.id));
    await project.save();
    const saved = await ProjectModel.findById(project._id).lean();
    if (!saved)
        return fail(res, 404, "Project not found");
    ok(res, mapProject(saved, req.user.id), "Project removed from My Projects");
});
projectsRoutes.patch("/:id/assigned-staff/:userId/status", requirePagePermission("projects", "view"), async (req, res) => {
    const statusSchema = z.object({
        status: z.enum(["Not started", "In progress", "On hold", "Completed"]),
    });
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid status payload");
    const targetUserId = routeParam(req.params.userId);
    const canEditAnyStaff = req.user?.globalRole === "super_admin" || req.user?.globalRole === "admin";
    const isSelf = String(req.user?.id || "") === String(targetUserId);
    if (!canEditAnyStaff && !isSelf) {
        return fail(res, 403, "You can only update your own status");
    }
    const project = await ProjectModel.findOne({ _id: req.params.id, ...projectFilter(req) });
    if (!project)
        return fail(res, 404, "Project not found");
    const normalized = normalizeAssignedStaffEntries(project);
    const user = await UserModel.findOne({ _id: targetUserId, ...projectFilter(req) }, { name: 1, email: 1 }).lean();
    if (!user && !normalized.some((entry) => String(entry.userId) === String(targetUserId))) {
        return fail(res, 404, "Assigned staff member not found");
    }
    project.assignedStaffIds = Array.from(new Set([...(project.assignedStaffIds ?? []).map(String), String(targetUserId)]));
    project.assignedStaff = upsertAssignedStaffEntry(normalized, targetUserId, {
        status: parsed.data.status,
        updatedBy: req.user?.id,
        updatedAt: new Date(),
        assignedAt: normalized.find((entry) => String(entry.userId) === String(targetUserId))?.assignedAt || new Date(),
    });
    await project.save();
    const saved = await ProjectModel.findById(project._id).lean();
    if (!saved)
        return fail(res, 404, "Project not found");
    ok(res, await enrichProjectDetail(saved, req), "Assigned staff status updated");
});
projectsRoutes.post("/", requirePagePermission("projects", "add"), async (req, res) => {
    try {
        const parsed = projectSchema.safeParse(req.body);
        if (!parsed.success)
            return fail(res, 400, "Invalid project payload");
        if (req.user?.globalRole !== "super_admin" && !req.factoryId) {
            return fail(res, 400, "Factory scope is required");
        }
        if (req.user?.globalRole !== "super_admin") {
            const limitCheck = await assertFactoryFeatureLimit(req.factoryId, "projects");
            if (!limitCheck.allowed) {
                return fail(res, 403, limitCheck.state.message || "Project limit reached");
            }
        }
        const code = parsed.data.code || `P${Date.now().toString().slice(-8).toUpperCase()}`;
        const materials = req.factoryId
            ? await attachStockItemsToProjectMaterials(req.factoryId, parsed.data.materials ?? [], req.user?.id, req.user?.globalRole !== "super_admin")
            : parsed.data.materials;
        const services = (parsed.data.services ?? []).map(normalizeServiceRow);
        const pricing = calculateProjectPricing(services, parsed.data.taxType, parsed.data.taxValue, parsed.data.discountType, parsed.data.discountValue);
        const created = await ProjectModel.create({
            factoryId: req.factoryId,
            createdBy: req.user?.id,
            updatedBy: req.user?.id,
            code: code.toUpperCase(),
            ...parsed.data,
            materials,
            services,
            subtotal: pricing.subtotal,
            taxAmount: pricing.taxAmount,
            discountAmount: pricing.discountAmount,
            grandTotal: pricing.grandTotal,
            amount: pricing.amount,
            delivery: parsed.data.delivery
                ? new Date(parsed.data.delivery)
                : undefined,
        });
        ok(res, mapProject(created, req.user?.id), "Project created");
    }
    catch (error) {
        fail(res, error.status || 400, error.message);
    }
});
projectsRoutes.patch("/:id/workflow", requirePagePermission("projects", "update"), async (req, res) => {
    const parsed = workflowSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid workflow payload");
    const updated = await ProjectModel.findOneAndUpdate({ _id: req.params.id, ...projectFilter(req) }, { workflowStages: parsed.data.stages, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Project not found");
    ok(res, mapProject(updated, req.user?.id), "Project workflow updated");
});
projectsRoutes.post("/:id/stages/:stage/allocation", requirePagePermission("projects", "update"), async (req, res) => {
    try {
        const parsed = stageAllocationSchema.safeParse(req.body);
        if (!parsed.success)
            return fail(res, 400, "Invalid stage allocation payload");
        const project = await ProjectModel.findOne({
            _id: req.params.id,
            ...projectFilter(req),
        });
        if (!project)
            return fail(res, 404, "Project not found");
        const stages = [...(project.workflowStages ?? [])];
        const stageName = routeParam(req.params.stage);
        let stageIndex = stages.findIndex((stage) => String(stage.name).toLowerCase() === stageName.toLowerCase());
        const projectMaterials = project.materials ?? [];
        const existingStage = stageIndex >= 0 ? stages[stageIndex] : null;
        const existingByMaterial = new Map((existingStage?.materials ?? []).map((material) => [
            String(material.projectMaterialId),
            material,
        ]));
        const allocatedMaterials = parsed.data.materials.map((allocation) => {
            const material = projectMaterials.find((item) => materialId(item) === allocation.projectMaterialId);
            if (!material) {
                throw new Error(`Project material ${allocation.projectMaterialId} was not found`);
            }
            if (allocation.requiredQuantity > Number(material.quantity ?? 0)) {
                throw new Error(`${material.materialName || material.materialType} cannot exceed the project quantity`);
            }
            const previous = existingByMaterial.get(allocation.projectMaterialId);
            const completedQuantity = Number(previous?.completedQuantity ?? 0);
            if (allocation.requiredQuantity < completedQuantity) {
                throw new Error(`${material.materialName || material.materialType} requirement cannot be below already used quantity`);
            }
            return {
                projectMaterialId: allocation.projectMaterialId,
                stockItemId: material.stockItemId ?? null,
                materialName: material.materialName ?? "Material",
                materialType: material.materialType ?? "",
                thickness: material.thickness ?? "",
                requiredQuantity: allocation.requiredQuantity,
                completedQuantity,
                unit: material.unit ?? "units",
            };
        });
        const totals = stageTotals(allocatedMaterials);
        const nextStage = {
            ...(existingStage ?? {}),
            id: existingStage?.id ??
                `${stageName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
            name: stageName,
            sortOrder: existingStage?.sortOrder ?? stages.length,
            materials: allocatedMaterials,
            ...totals,
            configuredBy: {
                userId: req.user?.id,
                role: parsed.data.role,
                staffName: parsed.data.staffName,
                configuredAt: new Date(),
            },
        };
        if (stageIndex >= 0)
            stages[stageIndex] = nextStage;
        else {
            stages.push(nextStage);
            stageIndex = stages.length - 1;
        }
        project.workflowStages = stages;
        await project.save();
        ok(res, mapProject(project, req.user?.id), "Stage material allocation updated");
    }
    catch (error) {
        fail(res, 400, error.message);
    }
});
projectsRoutes.post("/:id/stages/:stage/usage", requirePagePermission("projects", "update"), async (req, res) => {
    const parsed = stageUsageSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid stage usage payload");
    const project = await ProjectModel.findOne({
        _id: req.params.id,
        ...projectFilter(req),
    });
    if (!project)
        return fail(res, 404, "Project not found");
    const stages = [...(project.workflowStages ?? [])];
    const stageName = routeParam(req.params.stage);
    let stageIndex = stages.findIndex((stage) => String(stage.name).toLowerCase() === stageName.toLowerCase());
    const serviceId = typeof parsed.data.serviceId === "string" ? parsed.data.serviceId.trim() : "";
    if (stageIndex < 0) {
        stages.push({
            id: `${stageName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
            name: stageName,
            sortOrder: stages.length,
            materials: [],
            usageHistory: [],
            completed: 0,
            total: 0,
            serviceId: serviceId || undefined,
        });
        stageIndex = stages.length - 1;
    }
    if (serviceId && !stages[stageIndex].serviceId) {
        stages[stageIndex].serviceId = serviceId;
    }
    const stageMaterials = [...(stages[stageIndex].materials ?? [])];
    const usageActorId = typeof parsed.data.userId === "string" ? parsed.data.userId.trim() : null;
    const usageByMaterial = new Map(parsed.data.materials.map((usage) => [
        usage.projectMaterialId,
        usage.quantityUsed,
    ]));
    const stageStatus = parsed.data.stageStatus?.trim();
    const hasStatusUpdate = Boolean(stageStatus);
    const hasMaterialUsage = parsed.data.materials.length > 0;
    const hasDirectUsage = parsed.data.directUsage !== undefined;
    const directUsage = Number(parsed.data.directUsage ?? 0);
    const todayRange = dayBounds();
    const currentUsageHistory = [...(stages[stageIndex].usageHistory ?? [])];
    const usageMode = parsed.data.usageMode ?? "incremental";
    const matchedUsageRecords = currentUsageHistory.filter((entry) => isSameDayUsageRecord(entry, {
        userId: usageActorId || undefined,
        staffName: parsed.data.staffName,
        start: todayRange.start,
        end: todayRange.end,
    }));
    const historicalUsageRecords = currentUsageHistory.filter((entry) => isSameDayUsageRecord(entry, {
        userId: usageActorId || undefined,
        staffName: parsed.data.staffName,
        start: new Date(0),
        end: todayRange.start,
    }));
    const existingUsageRecord = [...matchedUsageRecords]
        .sort((a, b) => usageRecordTime(b) - usageRecordTime(a))[0] ?? null;
    const matchedUsageIds = new Set(matchedUsageRecords.map((entry) => String(entry.id || "")).filter(Boolean));
    const previousUsageRecord = existingUsageRecord ?? null;
    const existingUsageByMaterial = new Map();
    if (previousUsageRecord) {
        for (const material of (previousUsageRecord?.materials ?? [])) {
            const materialId = String(material.projectMaterialId);
            existingUsageByMaterial.set(materialId, Number(material.quantityUsed ?? 0));
        }
    }
    const historicalUsageByMaterial = new Map();
    for (const record of historicalUsageRecords) {
        for (const material of (record?.materials ?? [])) {
            const materialId = String(material.projectMaterialId);
            historicalUsageByMaterial.set(materialId, (historicalUsageByMaterial.get(materialId) ?? 0) + Number(material.quantityUsed ?? 0));
        }
    }
    if (!hasMaterialUsage && !hasDirectUsage && !hasStatusUpdate && !parsed.data.note?.trim()) {
        return fail(res, 400, "Add material usage, update the stage status, or add a note");
    }
    const unknownUsage = parsed.data.materials.find((usage) => !stageMaterials.some((material) => String(material.projectMaterialId) === usage.projectMaterialId));
    if (unknownUsage)
        return fail(res, 400, "Submitted material is not allocated to this stage");
    for (const material of stageMaterials) {
        const materialId = String(material.projectMaterialId);
        const nextUsage = usageByMaterial.get(materialId);
        if (nextUsage === undefined)
            continue;
        const previousUsage = existingUsageByMaterial.get(materialId) ?? 0;
        const nextCompletedQuantity = Number(material.completedQuantity ?? 0) - previousUsage + nextUsage;
        if (nextCompletedQuantity < 0) {
            return fail(res, 400, `${material.materialName || "Material"} usage cannot be below 0 ${material.unit || "units"}`);
        }
        if (nextCompletedQuantity > Number(material.requiredQuantity ?? 0)) {
            const remaining = Number(material.requiredQuantity ?? 0) -
                (Number(material.completedQuantity ?? 0) - previousUsage);
            return fail(res, 400, `${material.materialName || "Material"} usage cannot exceed the remaining ${remaining} ${material.unit || "units"}`);
        }
    }
    for (const usage of parsed.data.materials) {
        const materialIndex = stageMaterials.findIndex((item) => String(item.projectMaterialId) === usage.projectMaterialId);
        if (materialIndex < 0)
            continue;
        const material = stageMaterials[materialIndex];
        const previousUsage = existingUsageByMaterial.get(String(usage.projectMaterialId)) ?? 0;
        const historicalUsage = historicalUsageByMaterial.get(String(usage.projectMaterialId)) ?? 0;
        const resolvedUsage = usageMode === "absolute"
            ? Math.max(0, Number(usage.quantityUsed ?? 0) - historicalUsage)
            : Number(usage.quantityUsed ?? 0);
        stageMaterials[materialIndex] = {
            ...material,
            completedQuantity: Number(material.completedQuantity ?? 0) - previousUsage + resolvedUsage,
        };
    }
    const machineKey = resolveMachineUsageKey(stageName);
    if (machineKey === "pressing" || machineKey === "cutting") {
        const otherMachineKey = machineKey === "pressing" ? "cutting" : "pressing";
        const stageRowsBeforeUpdate = stages.map((stage, index) => ({
            ...stage,
            materials: index === stageIndex ? [...(stages[stageIndex].materials ?? [])] : stage.materials ?? [],
        }));
        const stageRowsAfterUpdate = stages.map((stage, index) => ({
            ...stage,
            materials: index === stageIndex ? stageMaterials : stage.materials ?? [],
        }));
        const materialIds = new Set([
            ...stageMaterials.map((material) => String(material.projectMaterialId)),
            ...stageRowsBeforeUpdate
                .filter((row) => resolveMachineUsageKey(row?.name) === otherMachineKey)
                .flatMap((row) => (row.materials ?? []).map((material) => String(material.projectMaterialId))),
        ]);
        const stockAdjustments = new Map();
        for (const materialId of materialIds) {
            const before = machineStockConsumption(stageRowsBeforeUpdate, materialId);
            const after = machineStockConsumption(stageRowsAfterUpdate, materialId);
            const delta = after - before;
            if (!delta)
                continue;
            const currentStageMaterial = stageMaterials.find((item) => String(item.projectMaterialId) === materialId);
            const otherStageMaterial = stageRowsBeforeUpdate
                .find((row) => resolveMachineUsageKey(row?.name) === otherMachineKey)
                ?.materials?.find((item) => String(item.projectMaterialId) === materialId);
            const stockItemId = currentStageMaterial?.stockItemId || otherStageMaterial?.stockItemId;
            if (!stockItemId)
                continue;
            stockAdjustments.set(String(stockItemId), (stockAdjustments.get(String(stockItemId)) ?? 0) + delta);
        }
        for (const [stockId, quantity] of stockAdjustments) {
            if (quantity <= 0)
                continue;
            const stock = await StockModel.findOne({
                _id: stockId,
                ...projectFilter(req),
            }).lean();
            if (!stock)
                return fail(res, 404, "Allocated stock item was not found");
            if (Number(stock.quantity ?? 0) < quantity) {
                return fail(res, 400, `${stock.name} has only ${stock.quantity} ${stock.unit} available`);
            }
        }
        if (stockAdjustments.size) {
            await StockModel.bulkWrite([...stockAdjustments]
                .filter(([, quantity]) => quantity !== 0)
                .map(([stockId, quantity]) => ({
                updateOne: {
                    filter: { _id: stockId, ...projectFilter(req) },
                    update: { $inc: { quantity: -quantity } },
                },
            })));
        }
    }
    const mergedMaterials = new Map((existingUsageRecord?.materials ?? []).map((material) => [
        String(material.projectMaterialId),
        {
            projectMaterialId: String(material.projectMaterialId),
            materialName: material.materialName ?? "Material",
            materialType: material.materialType ?? "",
            thickness: material.thickness ?? "",
            quantityUsed: Number(material.quantityUsed ?? 0),
            unit: material.unit ?? "units",
        },
    ]));
    const directUsageValue = hasDirectUsage ? Math.max(0, directUsage) : Number(existingUsageRecord?.directUsage ?? 0);
    for (const usage of parsed.data.materials) {
        const material = stageMaterials.find((item) => String(item.projectMaterialId) === usage.projectMaterialId);
        const historicalUsage = historicalUsageByMaterial.get(String(usage.projectMaterialId)) ?? 0;
        const resolvedUsage = usageMode === "absolute"
            ? Math.max(0, Number(usage.quantityUsed ?? 0) - historicalUsage)
            : Number(usage.quantityUsed ?? 0);
        mergedMaterials.set(String(usage.projectMaterialId), {
            projectMaterialId: usage.projectMaterialId,
            materialName: material?.materialName ?? "Material",
            materialType: material?.materialType ?? "",
            thickness: material?.thickness ?? "",
            quantityUsed: resolvedUsage,
            unit: material?.unit ?? "units",
        });
    }
    const usageMaterials = [...mergedMaterials.values()].filter((material) => Number(material.quantityUsed ?? 0) > 0);
    const keepUsageRecord = usageMaterials.length > 0 || directUsageValue > 0 || hasStatusUpdate || parsed.data.note?.trim();
    const usageRecord = {
        id: existingUsageRecord?.id ?? `usage-${Date.now()}`,
        userId: usageActorId || null,
        serviceId: serviceId || stages[stageIndex].serviceId || undefined,
        role: parsed.data.role,
        staffName: parsed.data.staffName,
        note: parsed.data.note !== undefined
            ? parsed.data.note
            : existingUsageRecord?.note,
        stageStatus: stageStatus || existingUsageRecord?.stageStatus || undefined,
        isAdminOverride: Boolean(parsed.data.isAdminOverride || !usageActorId),
        directUsage: hasDirectUsage ? directUsageValue : existingUsageRecord?.directUsage,
        createdAt: existingUsageRecord?.createdAt
            ? new Date(existingUsageRecord.createdAt)
            : new Date(),
        updatedAt: new Date(),
        materials: usageMaterials,
    };
    const totals = stageTotals(stageMaterials);
    const nextUsageHistory = usageMaterials.length === 0 && directUsageValue <= 0
        ? keepUsageRecord
            ? [
                usageRecord,
                ...currentUsageHistory.filter((entry) => !matchedUsageIds.has(String(entry?.id || ""))),
            ]
            : currentUsageHistory.filter((entry) => !matchedUsageIds.has(String(entry?.id || "")))
        : [
            usageRecord,
            ...currentUsageHistory.filter((entry) => !matchedUsageIds.has(String(entry?.id || ""))),
        ];
        stages[stageIndex] = {
        ...stages[stageIndex],
        materials: stageMaterials,
        ...totals,
        staffStatus: stageStatus || stages[stageIndex].staffStatus || "In progress",
        serviceId: serviceId || stages[stageIndex].serviceId,
        usageHistory: nextUsageHistory,
        lastUpdate: usageRecord,
    };
    project.workflowStages = stages;
    const currentAssignedStaff = normalizeAssignedStaffEntries(project);
    const nextAssignedStaff = usageActorId
        ? upsertAssignedStaffEntry(currentAssignedStaff, usageActorId, {
            status: stageStatus || existingUsageRecord?.stageStatus || "In progress",
            updatedBy: req.user?.id,
            updatedAt: new Date(),
            assignedAt: currentAssignedStaff.find((entry) => String(entry.userId) === String(usageActorId))?.assignedAt || new Date(),
        })
        : currentAssignedStaff;
    project.assignedStaff = nextAssignedStaff;
    if (usageActorId) {
        project.assignedStaffIds = Array.from(new Set([...(project.assignedStaffIds ?? []).map(String), String(usageActorId)]));
    }
    const allStageMaterials = stages.flatMap((stage) => stage.materials ?? []);
    const projectTotals = stageTotals(allStageMaterials);
    project.progress = projectTotals.total
        ? Math.min(100, Math.round((projectTotals.completed / projectTotals.total) * 100))
        : project.progress;
    const updatedServices = buildProjectServiceUsageSummary(project).map((service) => ({
        ...service,
        total: Number(service.amount ?? 0),
    }));
    project.services = updatedServices;
    const pricing = calculateProjectPricing(updatedServices, project.taxType ?? "percent", project.taxValue ?? 0, project.discountType ?? "amount", project.discountValue ?? 0);
    project.subtotal = pricing.subtotal;
    project.taxAmount = pricing.taxAmount;
    project.discountAmount = pricing.discountAmount;
    project.grandTotal = pricing.grandTotal;
    project.amount = pricing.amount;
    await project.save();
    const staffContext = await resolveStaffContext({
        factoryId: req.factoryId,
        userId: usageActorId || undefined,
        staffName: parsed.data.staffName,
    });
    const staffUser = staffContext?.user;
    const resolvedUsageUserId = usageActorId || (staffUser?._id ? String(staffUser._id) : "");
    if (usageRecord.materials.length || Number(usageRecord.directUsage ?? 0) > 0) {
        await StaffUsageLogModel.findOneAndUpdate({
            factoryId: req.factoryId,
            sourceRecordId: usageRecord.id,
        }, {
            $set: {
                factoryId: req.factoryId,
                userId: staffUser?._id ? String(staffUser._id) : null,
                staffName: parsed.data.staffName || staffUser?.name || (parsed.data.isAdminOverride ? "Admin (Manual Entry)" : "Staff"),
                staffEmail: staffUser?.email || "",
                staffRole: parsed.data.role || staffUser?.employeeRole || "",
                projectId: project._id,
                projectCode: project.code,
                projectName: project.name,
                stageName,
                note: usageRecord.note || "",
                totalQuantityUsed: usageRecord.materials.length
                    ? usageRecord.materials.reduce((sum, material) => sum + Number(material.quantityUsed ?? 0), 0)
                    : Number(usageRecord.directUsage ?? 0),
                sourceRecordId: usageRecord.id,
                activityAt: usageRecord.createdAt,
                materials: usageRecord.materials,
                updatedBy: req.user?.id,
                isAdminOverride: Boolean(parsed.data.isAdminOverride || !usageActorId),
            },
            $setOnInsert: {
                createdBy: req.user?.id,
            },
        }, { upsert: true, new: true, setDefaultsOnInsert: true });
        const duplicateSourceRecordIds = [...matchedUsageIds].filter((sourceRecordId) => sourceRecordId !== usageRecord.id);
        if (duplicateSourceRecordIds.length) {
            await StaffUsageLogModel.deleteMany({
                factoryId: req.factoryId,
                sourceRecordId: { $in: duplicateSourceRecordIds },
            });
        }
    }
    else if (matchedUsageIds.size) {
        await StaffUsageLogModel.deleteMany({
            factoryId: req.factoryId,
            sourceRecordId: { $in: [...matchedUsageIds] },
        });
    }
    if (resolvedUsageUserId) {
        project.assignedStaffIds = Array.from(new Set([...(project.assignedStaffIds ?? []).map(String), String(resolvedUsageUserId)]));
        project.assignedStaff = upsertAssignedStaffEntry(normalizeAssignedStaffEntries(project), resolvedUsageUserId, {
            status: stageStatus || existingUsageRecord?.stageStatus || "In progress",
            updatedBy: req.user?.id,
            updatedAt: new Date(),
            assignedAt: currentAssignedStaff.find((entry) => String(entry.userId) === String(resolvedUsageUserId))?.assignedAt || new Date(),
        });
        await project.save();
    }
    ok(res, mapProject(project, req.user?.id), "Project usage updated");
});
projectsRoutes.patch("/:id", requirePagePermission("projects", "edit"), async (req, res) => {
    try {
        const parsed = projectSchema.partial().safeParse(req.body);
        if (!parsed.success)
            return fail(res, 400, "Invalid project payload");
        const filter = req.user?.globalRole === "super_admin"
            ? { _id: req.params.id }
            : { _id: req.params.id, factoryId: req.factoryId };
        const current = await ProjectModel.findOne(filter).lean();
        if (!current)
            return fail(res, 404, "Project not found");
        const update = { ...parsed.data };
        if (parsed.data.delivery) {
            update.delivery = new Date(parsed.data.delivery);
        }
        const nextServices = parsed.data.services
            ? parsed.data.services.map(normalizeServiceRow)
            : (current.services ?? []).map(normalizeServiceRow);
        if (parsed.data.services) {
            update.services = nextServices;
        }
        const pricing = calculateProjectPricing(nextServices, parsed.data.taxType ?? current.taxType ?? "percent", parsed.data.taxValue ?? current.taxValue ?? 0, parsed.data.discountType ?? current.discountType ?? "amount", parsed.data.discountValue ?? current.discountValue ?? 0);
        update.subtotal = pricing.subtotal;
        update.taxAmount = pricing.taxAmount;
        update.discountAmount = pricing.discountAmount;
        update.grandTotal = pricing.grandTotal;
        update.amount = pricing.amount;
        const updated = await ProjectModel.findOneAndUpdate(filter, { ...update, updatedBy: req.user?.id }, {
            new: true,
        }).lean();
        ok(res, mapProject(updated, req.user?.id), "Project updated");
    }
    catch (error) {
        fail(res, 400, error.message);
    }
});
projectsRoutes.delete("/:id", requirePagePermission("projects", "delete"), async (req, res) => {
    try {
        const filter = req.user?.globalRole === "super_admin"
            ? { _id: req.params.id }
            : { _id: req.params.id, factoryId: req.factoryId };
        const deleted = await ProjectModel.findOneAndDelete(filter).lean();
        if (!deleted)
            return fail(res, 404, "Project not found");
        ok(res, { message: "Project deleted" });
    }
    catch (error) {
        fail(res, 400, error.message);
    }
});
