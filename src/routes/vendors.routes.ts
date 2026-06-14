import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { VendorModel } from "../models/vendor.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";

export const vendorsRoutes = Router();

vendorsRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);

const vendorSchema = z.object({
  name: z.string().min(1),
  contact: z.string().optional().nullable(),
  alternativeContact: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  gst: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  materials: z.string().optional().nullable(),
});

function mapVendor(row: any) {
  return {
    id: String(row._id),
    name: row.name || row.companyName || "",
    contact: row.phone || row.contact || "",
    alternativeContact: row.alternativeContact || "",
    email: row.email || "",
    gst: row.gst || row.taxId || "",
    address: row.address || "",
    materials: row.materials || row.category || "",
  };
}

vendorsRoutes.get("/", requirePagePermission("vendors", "view"), async (req, res) => {
  const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
  const vendors = await VendorModel.find(filter).sort({ createdAt: -1 }).lean();
  ok(res, vendors.map(mapVendor));
});

vendorsRoutes.post("/", requirePagePermission("vendors", "add"), async (req, res) => {
  const parsed = vendorSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid vendor payload");

  if (req.user?.globalRole !== "super_admin" && !req.factoryId) {
    return fail(res, 400, "Factory scope is required");
  }

  const created = await VendorModel.create({
    factoryId: req.factoryId,
    name: parsed.data.name,
    phone: parsed.data.contact,
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
  if (!parsed.success) return fail(res, 400, "Invalid vendor payload");

  const update: any = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.contact !== undefined) update.phone = parsed.data.contact;
  if (parsed.data.alternativeContact !== undefined) update.alternativeContact = parsed.data.alternativeContact;
  if (parsed.data.email !== undefined) update.email = parsed.data.email;
  if (parsed.data.address !== undefined) update.address = parsed.data.address;
  if (parsed.data.gst !== undefined) {
    update.gst = parsed.data.gst;
    update.taxId = parsed.data.gst;
  }
  if (parsed.data.materials !== undefined) {
    update.materials = parsed.data.materials;
    update.category = parsed.data.materials;
  }

  const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
  const updated = await VendorModel.findOneAndUpdate({ _id: req.params.id, ...filter }, update, {
    new: true,
  }).lean();
  if (!updated) return fail(res, 404, "Vendor not found");
  ok(res, mapVendor(updated), "Vendor updated");
});

vendorsRoutes.delete("/:id", requirePagePermission("vendors", "delete"), async (req, res) => {
  const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
  const deleted = await VendorModel.findOneAndDelete({ _id: req.params.id, ...filter }).lean();
  if (!deleted) return fail(res, 404, "Vendor not found");
  ok(res, { message: "Vendor deleted" });
});
