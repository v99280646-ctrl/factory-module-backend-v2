import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { CustomerModel } from "../models/customer.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import { assertFactoryFeatureLimit } from "../services/subscription.service.js";
export const customersRoutes = Router();
customersRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
const customerListQuerySchema = z.object({
    search: z.string().optional().nullable(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
});
const customerSchema = z.object({
    company: z.string().min(1),
    contact: z.string().optional().nullable(),
    countryCode: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
    address: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    district: z.string().optional().nullable(),
    pincode: z.string().optional().nullable(),
    gstin: z.string().optional().nullable(),
});
function mapCustomer(row) {
    return {
        id: String(row._id),
        company: row.company || row.companyName || "",
        contact: row.contact || row.name || "",
        countryCode: row.countryCode || "",
        phone: row.phone || "",
        email: row.email || "",
        address: row.address || "",
        state: row.state || "",
        district: row.district || "",
        pincode: row.pincode || row.zipCode || "",
        gstin: row.gstin || row.taxId || "",
    };
}
customersRoutes.get("/", requirePagePermission("customers", "view"), async (req, res) => {
    const parsedQuery = customerListQuerySchema.safeParse(req.query);
    if (!parsedQuery.success)
        return fail(res, 400, "Invalid customer query");
    const { search, page, limit } = parsedQuery.data;
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    if (search?.trim()) {
        const keyword = search.trim();
        filter.$or = [
            { company: { $regex: keyword, $options: "i" } },
            { companyName: { $regex: keyword, $options: "i" } },
            { contact: { $regex: keyword, $options: "i" } },
            { name: { $regex: keyword, $options: "i" } },
            { email: { $regex: keyword, $options: "i" } },
            { phone: { $regex: keyword, $options: "i" } },
        ];
    }
    if (page !== undefined) {
        const pageNumber = page;
        const pageLimit = limit ?? 20;
        const total = await CustomerModel.countDocuments(filter);
        const totalPages = total ? Math.ceil(total / pageLimit) : 0;
        const customers = await CustomerModel.find(filter)
            .sort({ createdAt: -1 })
            .skip((pageNumber - 1) * pageLimit)
            .limit(pageLimit)
            .lean();
        return ok(res, {
            items: customers.map(mapCustomer),
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
    const customers = await CustomerModel.find(filter).sort({ createdAt: -1 }).lean();
    ok(res, customers.map(mapCustomer));
});
customersRoutes.post("/", requirePagePermission("customers", "add"), async (req, res) => {
    const parsed = customerSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid customer payload");
    if (req.user?.globalRole !== "super_admin" && !req.factoryId) {
        return fail(res, 400, "Factory scope is required");
    }
    if (req.user?.globalRole !== "super_admin") {
        const limitCheck = await assertFactoryFeatureLimit(req.factoryId, "customers");
        if (!limitCheck.allowed) {
            return fail(res, 403, limitCheck.state.message || "Customer limit reached");
        }
    }
    const created = await CustomerModel.create({
        factoryId: req.factoryId,
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
        // `name` is required by the model; prefer contact name, fall back to company
        name: parsed.data.contact || parsed.data.company,
        company: parsed.data.company,
        contact: parsed.data.contact,
        countryCode: parsed.data.countryCode,
        phone: parsed.data.phone,
        email: parsed.data.email,
        address: parsed.data.address,
        state: parsed.data.state,
        district: parsed.data.district,
        zipCode: parsed.data.pincode,
        pincode: parsed.data.pincode,
        gstin: parsed.data.gstin,
        taxId: parsed.data.gstin,
        companyName: parsed.data.company,
    });
    ok(res, mapCustomer(created.toObject()), "Customer created");
});
customersRoutes.patch("/:id", requirePagePermission("customers", "edit"), async (req, res) => {
    const parsed = customerSchema.partial().safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid customer payload");
    const update = {};
    if (parsed.data.company !== undefined) {
        update.company = parsed.data.company;
        update.companyName = parsed.data.company;
        // keep `name` in sync if contact/name is not set separately
        if (!parsed.data.contact)
            update.name = parsed.data.company;
    }
    if (parsed.data.contact !== undefined)
        update.contact = parsed.data.contact;
    if (parsed.data.contact !== undefined)
        update.name = parsed.data.contact;
    if (parsed.data.countryCode !== undefined)
        update.countryCode = parsed.data.countryCode;
    if (parsed.data.phone !== undefined)
        update.phone = parsed.data.phone;
    if (parsed.data.email !== undefined)
        update.email = parsed.data.email;
    if (parsed.data.address !== undefined)
        update.address = parsed.data.address;
    if (parsed.data.state !== undefined)
        update.state = parsed.data.state;
    if (parsed.data.district !== undefined)
        update.district = parsed.data.district;
    if (parsed.data.pincode !== undefined) {
        update.pincode = parsed.data.pincode;
        update.zipCode = parsed.data.pincode;
    }
    if (parsed.data.gstin !== undefined) {
        update.gstin = parsed.data.gstin;
        update.taxId = parsed.data.gstin;
    }
    update.updatedBy = req.user?.id;
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const updated = await CustomerModel.findOneAndUpdate({ _id: req.params.id, ...filter }, update, {
        new: true,
    }).lean();
    if (!updated)
        return fail(res, 404, "Customer not found");
    ok(res, mapCustomer(updated), "Customer updated");
});
customersRoutes.delete("/:id", requirePagePermission("customers", "delete"), async (req, res) => {
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const deleted = await CustomerModel.findOneAndDelete({ _id: req.params.id, ...filter }).lean();
    if (!deleted)
        return fail(res, 404, "Customer not found");
    ok(res, { message: "Customer deleted" });
});
