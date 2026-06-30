import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { WasteMaterialModel } from "../models/waste.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
export const wasteRoutes = Router();
wasteRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
const wasteSchema = z.object({
    code: z.string().min(1),
    material: z.string().min(1),
    projectId: z.string().optional().nullable(),
    projectName: z.string().optional().nullable(),
    usedForProjectId: z.string().optional().nullable(),
    usedForProjectName: z.string().optional().nullable(),
    size: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
});
const wasteListQuerySchema = z.object({
    status: z.enum(["all", "available", "used"]).optional(),
    search: z.string().trim().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});
function mapWasteMaterial(row) {
    return {
        id: String(row._id),
        code: row.code,
        material: row.material,
        projectId: row.projectId || null,
        projectName: row.projectName || "",
        usedForProjectId: row.usedForProjectId || null,
        usedForProjectName: row.usedForProjectName || "",
        size: row.size || "",
        note: row.note || "",
    };
}
function nextWasteCode(current) {
    const match = /(?:\D*)(\d+)$/u.exec(current ?? "");
    const nextNumber = match ? Number(match[1]) + 1 : 1;
    return `W${String(nextNumber).padStart(3, "0")}`;
}
wasteRoutes.get("/", requirePagePermission("stock", "view"), async (req, res) => {
    const parsedQuery = wasteListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success)
        return fail(res, 400, "Invalid waste query");
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    if (parsedQuery.data.status === "available") {
        filter.$or = [{ usedForProjectId: null }, { usedForProjectId: { $exists: false } }];
    }
    if (parsedQuery.data.status === "used") {
        filter.usedForProjectId = { $ne: null };
    }
    const search = parsedQuery.data.search?.trim();
    if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
        filter.$or = [
            { code: regex },
            { material: regex },
            { projectName: regex },
            { usedForProjectName: regex },
            { size: regex },
            { note: regex },
        ];
    }
    if (parsedQuery.data.page !== undefined) {
        const page = parsedQuery.data.page;
        const limit = parsedQuery.data.limit ?? 20;
        const total = await WasteMaterialModel.countDocuments(filter);
        const totalPages = total ? Math.ceil(total / limit) : 0;
        const waste = await WasteMaterialModel.find(filter)
            .sort({ createdAt: -1 })
            .skip((page - 1) * limit)
            .limit(limit)
            .lean();
        return ok(res, {
            items: waste.map(mapWasteMaterial),
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
    const waste = await WasteMaterialModel.find(filter).sort({ createdAt: -1 }).lean();
    ok(res, waste.map(mapWasteMaterial));
});
wasteRoutes.get("/next-code", requirePagePermission("stock", "view"), async (req, res) => {
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const latest = await WasteMaterialModel.find(filter).sort({ createdAt: -1 }).limit(1).lean();
    ok(res, { code: nextWasteCode(latest[0]?.code) });
});
wasteRoutes.post("/", requirePagePermission("stock", "add"), async (req, res) => {
    const parsed = wasteSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid waste payload");
    if (req.user?.globalRole !== "super_admin" && !req.factoryId) {
        return fail(res, 400, "Factory scope is required");
    }
    const created = await WasteMaterialModel.create({
        factoryId: req.factoryId,
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
        code: parsed.data.code,
        material: parsed.data.material,
        projectId: parsed.data.projectId,
        projectName: parsed.data.projectName,
        usedForProjectId: parsed.data.usedForProjectId,
        usedForProjectName: parsed.data.usedForProjectName,
        size: parsed.data.size,
        note: parsed.data.note,
    });
    ok(res, mapWasteMaterial(created.toObject()), "Waste material created");
});
wasteRoutes.patch("/:id", requirePagePermission("stock", "update"), async (req, res) => {
    const parsed = wasteSchema.partial().safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid waste payload");
    const update = {};
    if (parsed.data.code !== undefined)
        update.code = parsed.data.code;
    if (parsed.data.material !== undefined)
        update.material = parsed.data.material;
    if (parsed.data.projectId !== undefined)
        update.projectId = parsed.data.projectId;
    if (parsed.data.projectName !== undefined)
        update.projectName = parsed.data.projectName;
    if (parsed.data.usedForProjectId !== undefined)
        update.usedForProjectId = parsed.data.usedForProjectId;
    if (parsed.data.usedForProjectName !== undefined)
        update.usedForProjectName = parsed.data.usedForProjectName;
    if (parsed.data.size !== undefined)
        update.size = parsed.data.size;
    if (parsed.data.note !== undefined)
        update.note = parsed.data.note;
    update.updatedBy = req.user?.id;
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const updated = await WasteMaterialModel.findOneAndUpdate({ _id: req.params.id, ...filter }, update, {
        new: true,
    }).lean();
    if (!updated)
        return fail(res, 404, "Waste material not found");
    ok(res, mapWasteMaterial(updated), "Waste material updated");
});
wasteRoutes.delete("/:id", requirePagePermission("stock", "delete"), async (req, res) => {
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const deleted = await WasteMaterialModel.findOneAndDelete({ _id: req.params.id, ...filter }).lean();
    if (!deleted)
        return fail(res, 404, "Waste material not found");
    ok(res, { message: "Waste material deleted" });
});
