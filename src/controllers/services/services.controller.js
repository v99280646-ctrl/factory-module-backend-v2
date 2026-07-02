import { z } from "zod";
import { ServiceModel } from "../../models/service.model.js";
import { EMPLOYEE_ROLES } from "../../models/membership.model.js";
import { fail, ok } from "../../utils/api-response.js";
import { assertFactoryFeatureLimit } from "../../services/subscription.service.js";
const serviceListQuerySchema = z.object({
    search: z.string().optional().nullable(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});
const serviceSchema = z.object({
    name: z.string().min(1),
    price: z.number().nonnegative().default(0),
    unit: z.string().min(1),
    employeeRole: z.enum(EMPLOYEE_ROLES).nullable().optional(),
});
function mapService(row) {
    return {
        id: String(row._id),
        name: row.name || "",
        price: Number(row.price ?? 0),
        unit: row.unit || row.category || "",
        employeeRole: row.employeeRole || null,
    };
}
function generateServiceCode(name) {
    const key = name.replace(/[^a-z0-9]+/gi, "").slice(0, 8).toUpperCase();
    return key || `SVC${Date.now().toString().slice(-6)}`;
}
export async function handleListServices(req, res) {
    const parsedQuery = serviceListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success)
        return fail(res, 400, "Invalid service query");
    const { search, page, limit } = parsedQuery.data;
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    if (search?.trim()) {
        const keyword = search.trim();
        filter.$or = [
            { name: { $regex: keyword, $options: "i" } },
            { unit: { $regex: keyword, $options: "i" } },
            { category: { $regex: keyword, $options: "i" } },
            { employeeRole: { $regex: keyword, $options: "i" } },
        ];
    }
    if (page !== undefined) {
        const pageNumber = page;
        const pageLimit = limit ?? 20;
        const total = await ServiceModel.countDocuments(filter);
        const totalPages = total ? Math.ceil(total / pageLimit) : 0;
        const services = await ServiceModel.find(filter)
            .sort({ createdAt: -1 })
            .skip((pageNumber - 1) * pageLimit)
            .limit(pageLimit)
            .lean();
        return ok(res, {
            items: services.map(mapService),
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
    const services = await ServiceModel.find(filter).sort({ createdAt: -1 }).lean();
    ok(res, services.map(mapService));
}
export async function handleCreateService(req, res) {
    const parsed = serviceSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid service payload");
    if (req.user?.globalRole !== "super_admin" && !req.factoryId) {
        return fail(res, 400, "Factory scope is required");
    }
    if (req.user?.globalRole !== "super_admin") {
        const limitCheck = await assertFactoryFeatureLimit(req.factoryId, "services");
        if (!limitCheck.allowed) {
            return fail(res, 403, limitCheck.state.message || "Service limit reached");
        }
    }
    const code = generateServiceCode(parsed.data.name);
    const created = await ServiceModel.create({
        factoryId: req.factoryId,
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
        code,
        name: parsed.data.name,
        price: parsed.data.price,
        unit: parsed.data.unit,
        category: parsed.data.unit,
        employeeRole: parsed.data.employeeRole ?? null,
    });
    ok(res, mapService(created.toObject()), "Service created");
}
export async function handleUpdateService(req, res) {
    const parsed = serviceSchema.partial().safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid service payload");
    const update = {};
    if (parsed.data.name !== undefined)
        update.name = parsed.data.name;
    if (parsed.data.price !== undefined)
        update.price = parsed.data.price;
    if (parsed.data.unit !== undefined) {
        update.unit = parsed.data.unit;
        update.category = parsed.data.unit;
    }
    if (parsed.data.employeeRole !== undefined) {
        update.employeeRole = parsed.data.employeeRole;
    }
    update.updatedBy = req.user?.id;
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const updated = await ServiceModel.findOneAndUpdate({ _id: req.params.id, ...filter }, update, {
        new: true,
    }).lean();
    if (!updated)
        return fail(res, 404, "Service not found");
    ok(res, mapService(updated), "Service updated");
}
export async function handleDeleteService(req, res) {
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const deleted = await ServiceModel.findOneAndDelete({ _id: req.params.id, ...filter }).lean();
    if (!deleted)
        return fail(res, 404, "Service not found");
    ok(res, { message: "Service deleted" });
}
