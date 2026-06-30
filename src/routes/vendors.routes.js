import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { VendorModel } from "../models/vendor.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import { assertFactoryFeatureLimit } from "../services/subscription.service.js";
export const vendorsRoutes = Router();
vendorsRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
const vendorListQuerySchema = z.object({
    search: z.string().optional().nullable(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});
const vendorSchema = z.object({
    name: z.string().min(1),
    contact: z.string().optional().nullable(),
    countryCode: z.string().optional().nullable(),
    alternativeContact: z.string().optional().nullable(),
    alternativeCountryCode: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    gst: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    materials: z.string().optional().nullable(),
});
function mapVendor(row) {
    return {
        id: String(row._id),
        name: row.name || row.companyName || "",
        countryCode: row.countryCode || "",
        contact: row.phone || row.contact || "",
        alternativeCountryCode: row.alternativeCountryCode || "",
        alternativeContact: row.alternativeContact || "",
        email: row.email || "",
        gst: row.gst || row.taxId || "",
        address: row.address || "",
        materials: row.materials || row.category || "",
    };
}
vendorsRoutes.get("/", requirePagePermission("vendors", "view"), async (req, res) => {
    const parsedQuery = vendorListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success)
        return fail(res, 400, "Invalid vendor query");
    const { search, page, limit } = parsedQuery.data;
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    if (search?.trim()) {
        const keyword = search.trim();
        filter.$or = [
            { name: { $regex: keyword, $options: "i" } },
            { companyName: { $regex: keyword, $options: "i" } },
            { email: { $regex: keyword, $options: "i" } },
            { phone: { $regex: keyword, $options: "i" } },
            { alternativeContact: { $regex: keyword, $options: "i" } },
            { materials: { $regex: keyword, $options: "i" } },
            { category: { $regex: keyword, $options: "i" } },
        ];
    }
    if (page !== undefined) {
        const pageNumber = page;
        const pageLimit = limit ?? 20;
        const total = await VendorModel.countDocuments(filter);
        const totalPages = total ? Math.ceil(total / pageLimit) : 0;
        const vendors = await VendorModel.find(filter)
            .sort({ createdAt: -1 })
            .skip((pageNumber - 1) * pageLimit)
            .limit(pageLimit)
            .lean();
        return ok(res, {
            items: vendors.map(mapVendor),
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
    const vendors = await VendorModel.find(filter).sort({ createdAt: -1 }).lean();
    ok(res, vendors.map(mapVendor));
});
vendorsRoutes.post("/", requirePagePermission("vendors", "add"), async (req, res) => {
    const parsed = vendorSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid vendor payload");
    if (req.user?.globalRole !== "super_admin" && !req.factoryId) {
        return fail(res, 400, "Factory scope is required");
    }
    if (req.user?.globalRole !== "super_admin") {
        const limitCheck = await assertFactoryFeatureLimit(req.factoryId, "vendors");
        if (!limitCheck.allowed) {
            return fail(res, 403, limitCheck.state.message || "Vendor limit reached");
        }
    }
    const created = await VendorModel.create({
        factoryId: req.factoryId,
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
        name: parsed.data.name,
        countryCode: parsed.data.countryCode,
        phone: parsed.data.contact,
        alternativeCountryCode: parsed.data.alternativeCountryCode,
        alternativeContact: parsed.data.alternativeContact,
        email: parsed.data.email,
        address: parsed.data.address,
        gst: parsed.data.gst,
        taxId: parsed.data.gst,
        materials: parsed.data.materials,
        category: parsed.data.materials,
    });
    ok(res, mapVendor(created.toObject()), "Vendor created");
});
vendorsRoutes.patch("/:id", requirePagePermission("vendors", "edit"), async (req, res) => {
    const parsed = vendorSchema.partial().safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid vendor payload");
    const update = {};
    if (parsed.data.name !== undefined)
        update.name = parsed.data.name;
    if (parsed.data.countryCode !== undefined)
        update.countryCode = parsed.data.countryCode;
    if (parsed.data.contact !== undefined)
        update.phone = parsed.data.contact;
    if (parsed.data.alternativeCountryCode !== undefined)
        update.alternativeCountryCode = parsed.data.alternativeCountryCode;
    if (parsed.data.alternativeContact !== undefined)
        update.alternativeContact = parsed.data.alternativeContact;
    if (parsed.data.email !== undefined)
        update.email = parsed.data.email;
    if (parsed.data.address !== undefined)
        update.address = parsed.data.address;
    if (parsed.data.gst !== undefined) {
        update.gst = parsed.data.gst;
        update.taxId = parsed.data.gst;
    }
    if (parsed.data.materials !== undefined) {
        update.materials = parsed.data.materials;
        update.category = parsed.data.materials;
    }
    update.updatedBy = req.user?.id;
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const updated = await VendorModel.findOneAndUpdate({ _id: req.params.id, ...filter }, update, {
        new: true,
    }).lean();
    if (!updated)
        return fail(res, 404, "Vendor not found");
    ok(res, mapVendor(updated), "Vendor updated");
});
vendorsRoutes.delete("/:id", requirePagePermission("vendors", "delete"), async (req, res) => {
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const deleted = await VendorModel.findOneAndDelete({ _id: req.params.id, ...filter }).lean();
    if (!deleted)
        return fail(res, 404, "Vendor not found");
    ok(res, { message: "Vendor deleted" });
});
