import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { MaterialTypeModel } from "../models/material-type.model.js";
import { StockModel } from "../models/stock.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import { assertFactoryFeatureLimit } from "../services/subscription.service.js";
export const stockRoutes = Router();
stockRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
const stockSchema = z.object({
    material: z.string().min(1),
    type: z.string().min(1),
    thickness: z.string().min(1),
    quantity: z.number().nonnegative().default(0),
    unit: z.string().min(1).default("sheets"),
});
const quantitySchema = z.object({
    quantity: z.number().nonnegative(),
});
const materialTypeSchema = z.object({
    label: z.string().min(1),
});
const stockListQuerySchema = z.object({
    search: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});
const DEFAULT_MATERIAL_TYPES = [
    "MDF",
    "Plywood",
    "Laminate",
    "Veneer",
    "Acrylic",
    "Edge Band",
    "Hardware",
];
function mapStockItem(row) {
    return {
        id: String(row._id),
        material: row.material || row.name || "",
        type: row.type || row.category || "",
        thickness: row.thickness || "",
        quantity: Number(row.quantity ?? 0),
        unit: row.unit || "sheets",
    };
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function normalizeVariant(value) {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
}
function normalizeThickness(value) {
    const compact = value.trim().replace(/\s+/g, "").toLowerCase();
    const millimeters = compact.match(/^(\d+(?:\.\d+)?)(?:mm)?$/);
    return millimeters ? `${Number(millimeters[1])}mm` : compact;
}
function generateStockCode(type, thickness) {
    const cleaned = `${type}${thickness}`
        .replace(/[^a-z0-9]+/gi, "")
        .slice(0, 10)
        .toUpperCase();
    return `${cleaned || "STK"}${Date.now().toString().slice(-6)}`;
}
function normalizeTypeLabel(value) {
    return value.trim().replace(/\s+/g, " ");
}
function normalizeTypeKey(value) {
    return normalizeTypeLabel(value).toLowerCase();
}
stockRoutes.get("/material-types", requirePagePermission("stock", "view"), async (req, res) => {
    const factoryId = req.factoryId;
    const customTypes = factoryId
        ? await MaterialTypeModel.find({ factoryId, active: true }).sort({ createdAt: 1 }).lean()
        : [];
    ok(res, {
        defaults: DEFAULT_MATERIAL_TYPES.map((label) => ({
            id: `default:${normalizeTypeKey(label)}`,
            label,
            source: "default",
        })),
        custom: customTypes.map((row) => ({
            id: String(row._id),
            label: row.label,
            source: "custom",
        })),
    });
});
stockRoutes.post("/material-types", requirePagePermission("stock", "add"), async (req, res) => {
    const parsed = materialTypeSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid material type payload");
    if (!req.factoryId)
        return fail(res, 400, "Factory scope is required");
    const label = normalizeTypeLabel(parsed.data.label);
    const labelKey = normalizeTypeKey(label);
    if (!label)
        return fail(res, 400, "Material type is required");
    const defaultExists = DEFAULT_MATERIAL_TYPES.some((item) => normalizeTypeKey(item) === labelKey);
    const customExists = await MaterialTypeModel.exists({ factoryId: req.factoryId, labelKey });
    if (defaultExists || customExists) {
        return fail(res, 409, "This material type already exists");
    }
    const created = await MaterialTypeModel.create({
        factoryId: req.factoryId,
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
        label,
        labelKey,
        active: true,
    });
    ok(res, {
        id: String(created._id),
        label: created.label,
        source: "custom",
    }, "Material type added");
});
stockRoutes.get("/", requirePagePermission("stock", "view"), async (req, res) => {
    const parsedQuery = stockListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success)
        return fail(res, 400, "Invalid stock query");
    const filter = req.user?.globalRole === "super_admin"
        ? {}
        : { factoryId: req.factoryId };
    const search = parsedQuery.data.search?.trim();
    if (search) {
        const regex = new RegExp(escapeRegex(search), "iu");
        filter.$or = [
            { material: regex },
            { name: regex },
            { type: regex },
            { category: regex },
            { thickness: regex },
        ];
    }
    if (parsedQuery.data.page !== undefined) {
        const page = parsedQuery.data.page;
        const limit = parsedQuery.data.limit ?? 20;
        const total = await StockModel.countDocuments(filter);
        const totalPages = total ? Math.ceil(total / limit) : 0;
        const rows = await StockModel.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();
        return ok(res, {
            items: rows.map(mapStockItem),
            pagination: {
                page,
                limit,
                total,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
            },
        });
    }
    const stockItems = await StockModel.find(filter)
        .sort({ createdAt: -1 })
        .lean();
    ok(res, stockItems.map(mapStockItem));
});
stockRoutes.post("/", requirePagePermission("stock", "add"), async (req, res) => {
    try {
        const parsed = stockSchema.safeParse(req.body);
        if (!parsed.success)
            return fail(res, 400, "Type, thickness, quantity, and unit are required");
        if (!req.factoryId)
            return fail(res, 400, "Factory scope is required");
        if (req.user?.globalRole !== "super_admin") {
            const limitCheck = await assertFactoryFeatureLimit(req.factoryId, "stock");
            if (!limitCheck.allowed) {
                return fail(res, 403, limitCheck.state.message || "Stock limit reached");
            }
        }
        const typeKey = normalizeVariant(parsed.data.type);
        const thicknessKey = normalizeThickness(parsed.data.thickness);
        const duplicate = await StockModel.exists({
            factoryId: req.factoryId,
            typeKey,
            thicknessKey,
        });
        if (duplicate) {
            return fail(res, 409, `${parsed.data.type} ${parsed.data.thickness} already exists in stock`);
        }
        const code = generateStockCode(parsed.data.type, parsed.data.thickness);
        const created = await StockModel.create({
            factoryId: req.factoryId,
            createdBy: req.user?.id,
            updatedBy: req.user?.id,
            code,
            name: parsed.data.material,
            material: parsed.data.material,
            category: parsed.data.type,
            type: parsed.data.type,
            thickness: parsed.data.thickness,
            typeKey,
            thicknessKey,
            quantity: parsed.data.quantity,
            unit: parsed.data.unit,
        });
        ok(res, mapStockItem(created.toObject()), "Stock created");
    }
    catch (error) {
        if (error?.code === 11000)
            return fail(res, 409, "This stock type and thickness already exists");
        fail(res, 400, error.message || "Unable to create stock");
    }
});
stockRoutes.patch("/:id", requirePagePermission("stock", "edit"), async (req, res) => {
    try {
        const parsed = stockSchema.partial().safeParse(req.body);
        if (!parsed.success)
            return fail(res, 400, "Invalid stock payload");
        const filter = req.user?.globalRole === "super_admin"
            ? {}
            : { factoryId: req.factoryId };
        const current = await StockModel.findOne({
            _id: req.params.id,
            ...filter,
        }).lean();
        if (!current)
            return fail(res, 404, "Stock item not found");
        const nextType = parsed.data.type ?? current.type ?? current.category;
        const nextThickness = parsed.data.thickness ?? current.thickness;
        if (!nextType || !nextThickness)
            return fail(res, 400, "Type and thickness are required");
        const typeKey = normalizeVariant(nextType);
        const thicknessKey = normalizeThickness(nextThickness);
        const duplicate = await StockModel.exists({
            _id: { $ne: current._id },
            factoryId: current.factoryId,
            typeKey,
            thicknessKey,
        });
        if (duplicate)
            return fail(res, 409, `${nextType} ${nextThickness} already exists in stock`);
        const update = { typeKey, thicknessKey, updatedBy: req.user?.id };
        if (parsed.data.material !== undefined) {
            update.name = parsed.data.material;
            update.material = parsed.data.material;
        }
        if (parsed.data.type !== undefined) {
            update.category = parsed.data.type;
            update.type = parsed.data.type;
        }
        if (parsed.data.thickness !== undefined)
            update.thickness = parsed.data.thickness;
        if (parsed.data.quantity !== undefined)
            update.quantity = parsed.data.quantity;
        if (parsed.data.unit !== undefined)
            update.unit = parsed.data.unit;
        const updated = await StockModel.findOneAndUpdate({ _id: req.params.id, ...filter }, update, {
            new: true,
        }).lean();
        ok(res, mapStockItem(updated), "Stock updated");
    }
    catch (error) {
        if (error?.code === 11000)
            return fail(res, 409, "This stock type and thickness already exists");
        fail(res, 400, error.message || "Unable to update stock");
    }
});
stockRoutes.patch("/:id/quantity", requirePagePermission("stock", "update"), async (req, res) => {
    const parsed = quantitySchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid quantity payload");
    const filter = req.user?.globalRole === "super_admin"
        ? {}
        : { factoryId: req.factoryId };
    const updated = await StockModel.findOneAndUpdate({ _id: req.params.id, ...filter }, { quantity: parsed.data.quantity, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Stock item not found");
    ok(res, mapStockItem(updated), "Stock quantity updated");
});
stockRoutes.delete("/:id", requirePagePermission("stock", "delete"), async (req, res) => {
    const filter = req.user?.globalRole === "super_admin"
        ? {}
        : { factoryId: req.factoryId };
    const deleted = await StockModel.findOneAndDelete({
        _id: req.params.id,
        ...filter,
    }).lean();
    if (!deleted)
        return fail(res, 404, "Stock item not found");
    ok(res, { message: "Stock deleted" });
});
