import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { ServiceModel } from "../models/service.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";

export const servicesRoutes = Router();

servicesRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);

const serviceSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative().default(0),
  unit: z.string().min(1),
});

function mapService(row: any) {
  return {
    id: String(row._id),
    name: row.name || "",
    price: Number(row.price ?? 0),
    unit: row.unit || row.category || "",
  };
}

function generateServiceCode(name: string) {
  const key = name.replace(/[^a-z0-9]+/gi, "").slice(0, 8).toUpperCase();
  return key || `SVC${Date.now().toString().slice(-6)}`;
}

servicesRoutes.get("/", requirePagePermission("services", "view"), async (req, res) => {
  const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
  const services = await ServiceModel.find(filter).sort({ createdAt: -1 }).lean();
  ok(res, services.map(mapService));
});

servicesRoutes.post("/", requirePagePermission("services", "add"), async (req, res) => {
  const parsed = serviceSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid service payload");

  if (req.user?.globalRole !== "super_admin" && !req.factoryId) {
    return fail(res, 400, "Factory scope is required");
  }

  const code = generateServiceCode(parsed.data.name);
  const created = await ServiceModel.create({
    factoryId: req.factoryId,
    code,
    name: parsed.data.name,
    price: parsed.data.price,
    unit: parsed.data.unit,
    category: parsed.data.unit,
  });

  ok(res, mapService(created.toObject()), "Service created");
});

servicesRoutes.patch("/:id", requirePagePermission("services", "edit"), async (req, res) => {
  const parsed = serviceSchema.partial().safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid service payload");

  const update: any = {};
  if (parsed.data.name !== undefined) update.name = parsed.data.name;
  if (parsed.data.price !== undefined) update.price = parsed.data.price;
  if (parsed.data.unit !== undefined) {
    update.unit = parsed.data.unit;
    update.category = parsed.data.unit;
  }

  const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
  const updated = await ServiceModel.findOneAndUpdate({ _id: req.params.id, ...filter }, update, {
    new: true,
  }).lean();
  if (!updated) return fail(res, 404, "Service not found");
  ok(res, mapService(updated), "Service updated");
});

servicesRoutes.delete("/:id", requirePagePermission("services", "delete"), async (req, res) => {
  const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
  const deleted = await ServiceModel.findOneAndDelete({ _id: req.params.id, ...filter }).lean();
  if (!deleted) return fail(res, 404, "Service not found");
  ok(res, { message: "Service deleted" });
});
