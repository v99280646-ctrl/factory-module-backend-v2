import { Router } from "express";
import { fail, ok } from "../utils/api-response.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import { FactoryModel } from "../models/factory.model.js";
import { MembershipModel } from "../models/membership.model.js";
import { ProjectModel } from "../models/project.model.js";
import { StaffModel } from "../models/staff.model.js";
import { UserModel } from "../models/user.model.js";

export const factoryRoutes = Router();

// Allow super_admin or a factory-level admin (membership.role === 'admin')
// Mount the auth + factory-admin middleware on the "/:factoryId" path
// so `req.params.factoryId` is populated when the middleware runs.
factoryRoutes.use('/:factoryId', requireAuth);

factoryRoutes.get("/:factoryId", requirePagePermission("settings", "view"), async (req, res) => {
  const factory = await FactoryModel.findById(req.params.factoryId).lean();
  if (!factory) return fail(res, 404, "Factory not found");
  const [adminMembership, staff, projectCount] = await Promise.all([
    MembershipModel.findOne({ factoryId: factory._id, role: "admin", active: true }).lean(),
    StaffModel.find({ factoryId: factory._id }).lean(),
    ProjectModel.countDocuments({ factoryId: factory._id }),
  ]);
  const adminUser = adminMembership ? await UserModel.findById(adminMembership.userId).lean() : null;
  ok(res, {
    factory: {
      id: String(factory._id),
      name: factory.name,
      code: factory.code,
      status: factory.status,
      subscriptionStatus: factory.subscriptionStatus,
      subscriptionPlan: factory.subscriptionPlan,
      location: factory.companyProfile?.address,
    },
    admin: adminUser ? {
      fullName: factory.adminProfile?.fullName || adminUser.name,
      role: factory.adminProfile?.role || "Admin",
      phone: factory.adminProfile?.phone,
      email: adminUser.email,
      city: factory.adminProfile?.city,
      state: factory.adminProfile?.state,
      pincode: factory.adminProfile?.pincode,
    } : null,
    employees: staff.map((employee) => ({
      fullName: employee.name,
      role: employee.role,
      loginDetails: { email: employee.email || "", active: employee.active, lastLoginAt: null },
    })),
    details: {
      companyName: factory.companyProfile?.companyName || factory.name,
      ...factory.companyProfile,
      projectCount,
    },
  });
});

factoryRoutes.patch("/:factoryId", requirePagePermission("settings", "edit"), async (req, res) => {
  const updated = await FactoryModel.findByIdAndUpdate(req.params.factoryId, req.body, { new: true }).lean();
  if (!updated) return fail(res, 404, "Factory not found");
  ok(res, updated, "Factory updated");
});

factoryRoutes.get("/:factoryId/settings", requirePagePermission("settings", "view"), async (req, res) => {
  const factory = await FactoryModel.findById(req.params.factoryId).lean();
  if (!factory) return fail(res, 404, "Factory not found");
  ok(res, {
    adminProfile: factory.adminProfile ?? {},
    companyProfile: factory.companyProfile ?? {},
    integrations: factory.integrations ?? {},
  });
});

factoryRoutes.put("/:factoryId/settings", requirePagePermission("settings", "update"), async (req, res) => {
  const updated = await FactoryModel.findByIdAndUpdate(
    req.params.factoryId,
    {
      adminProfile: req.body.adminProfile ?? {},
      companyProfile: req.body.companyProfile ?? {},
      integrations: req.body.integrations ?? {},
    },
    { new: true },
  ).lean();
  if (!updated) return fail(res, 404, "Factory not found");
  ok(res, { message: "Settings saved" });
});

factoryRoutes.post("/:factoryId/admin-profile", requirePagePermission("settings", "update"), async (req, res) => {
  const adminProfile = req.body.adminProfile ?? req.body;
  const updated = await FactoryModel.findByIdAndUpdate(
    req.params.factoryId,
    { adminProfile },
    { new: true },
  ).lean();
  if (!updated) return fail(res, 404, "Factory not found");
  ok(res, { message: "Admin profile saved" });
});
