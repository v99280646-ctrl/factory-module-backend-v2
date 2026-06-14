import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { CustomerModel } from "../models/customer.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";

export const customersRoutes = Router();

customersRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);

const customerSchema = z.object({
  company: z.string().min(1),
  contact: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  address: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  district: z.string().optional().nullable(),
  pincode: z.string().optional().nullable(),
  gstin: z.string().optional().nullable(),
});

function mapCustomer(row: any) {
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

customersRoutes.get("/", requirePagePermission("customers", "view"), async (req, res) => {
  const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
  const customers = await CustomerModel.find(filter).sort({ createdAt: -1 }).lean();
  ok(res, customers.map(mapCustomer));
});

customersRoutes.post("/", requirePagePermission("customers", "add"), async (req, res) => {
  const parsed = customerSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid customer payload");

  if (req.user?.globalRole !== "super_admin" && !req.factoryId) {
    return fail(res, 400, "Factory scope is required");
  }

  const created = await CustomerModel.create({
    factoryId: req.factoryId,
    // `name` is required by the model; prefer contact name, fall back to company
    name: parsed.data.contact || parsed.data.company,
    company: parsed.data.company,
    contact: parsed.data.contact,
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
  if (!parsed.success) return fail(res, 400, "Invalid customer payload");

  const update: any = {};
  if (parsed.data.company !== undefined) {
    update.company = parsed.data.company;
    update.companyName = parsed.data.company;
    // keep `name` in sync if contact/name is not set separately
    if (!parsed.data.contact) update.name = parsed.data.company;
  }
  if (parsed.data.contact !== undefined) update.contact = parsed.data.contact;
  if (parsed.data.contact !== undefined) update.name = parsed.data.contact;
  if (parsed.data.phone !== undefined) update.phone = parsed.data.phone;
  if (parsed.data.email !== undefined) update.email = parsed.data.email;
  if (parsed.data.address !== undefined) update.address = parsed.data.address;
  if (parsed.data.state !== undefined) update.state = parsed.data.state;
  if (parsed.data.district !== undefined) update.district = parsed.data.district;
  if (parsed.data.pincode !== undefined) {
    update.pincode = parsed.data.pincode;
    update.zipCode = parsed.data.pincode;
  }
  if (parsed.data.gstin !== undefined) {
    update.gstin = parsed.data.gstin;
    update.taxId = parsed.data.gstin;
  }

  const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
  const updated = await CustomerModel.findOneAndUpdate({ _id: req.params.id, ...filter }, update, {
    new: true,
  }).lean();
  if (!updated) return fail(res, 404, "Customer not found");
  ok(res, mapCustomer(updated), "Customer updated");
});

customersRoutes.delete("/:id", requirePagePermission("customers", "delete"), async (req, res) => {
  const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
  const deleted = await CustomerModel.findOneAndDelete({ _id: req.params.id, ...filter }).lean();
  if (!deleted) return fail(res, 404, "Customer not found");
  ok(res, { message: "Customer deleted" });
});
