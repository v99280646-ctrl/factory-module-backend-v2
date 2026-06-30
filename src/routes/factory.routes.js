import { Router } from "express";
import { fail, ok } from "../utils/api-response.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import { z } from "zod";
import { FactoryModel } from "../models/factory.model.js";
import { ProjectModel } from "../models/project.model.js";
import { UserModel } from "../models/user.model.js";
import { getFactorySubscriptionContext, getFactorySubscriptionOverview } from "../services/subscription.service.js";
export const factoryRoutes = Router();
const subscriptionOverviewQuerySchema = z.object({
    plansPage: z.coerce.number().int().min(1).optional(),
    plansLimit: z.coerce.number().int().min(1).max(50).optional(),
    usagePage: z.coerce.number().int().min(1).optional(),
    usageLimit: z.coerce.number().int().min(1).max(50).optional(),
});
// Allow super_admin or a factory-level admin (factoryRole === 'admin')
// Mount the auth + factory-admin middleware on the "/:factoryId" path
// so `req.params.factoryId` is populated when the middleware runs.
factoryRoutes.use('/:factoryId', requireAuth);
factoryRoutes.get("/:factoryId", requirePagePermission("settings", "view"), async (req, res) => {
    const factory = await FactoryModel.findById(req.params.factoryId).lean();
    if (!factory)
        return fail(res, 404, "Factory not found");
    const [adminMembership, staff, projectCount] = await Promise.all([
        UserModel.findOne({ factoryId: factory._id, factoryRole: "admin", active: true }).lean(),
        UserModel.find({ factoryId: factory._id, factoryRole: "staff", active: true }).lean(),
        ProjectModel.countDocuments({ factoryId: factory._id }),
    ]);
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
        admin: adminMembership ? {
            fullName: factory.adminProfile?.fullName || adminMembership.name,
            role: factory.adminProfile?.role || "Admin",
            phone: factory.adminProfile?.phone,
            email: adminMembership.email,
            city: factory.adminProfile?.city,
            state: factory.adminProfile?.state,
            pincode: factory.adminProfile?.pincode,
        } : null,
        employees: staff.map((employee) => {
            return {
                fullName: employee.name || "",
                role: employee.employeeRole || "Employee",
                employeeRole: employee.employeeRole || "",
                phone: employee.phone || "",
                loginDetails: { email: employee.email || "", active: employee.active, lastLoginAt: null },
            };
        }),
        details: {
            companyName: factory.companyProfile?.companyName || factory.name,
            ...factory.companyProfile,
            projectCount,
        },
    });
});
factoryRoutes.patch("/:factoryId", requirePagePermission("settings", "edit"), async (req, res) => {
    const updated = await FactoryModel.findByIdAndUpdate(req.params.factoryId, { ...req.body, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Factory not found");
    ok(res, updated, "Factory updated");
});
factoryRoutes.get("/:factoryId/settings", requirePagePermission("settings", "view"), async (req, res) => {
    const factory = await FactoryModel.findById(req.params.factoryId).lean();
    if (!factory)
        return fail(res, 404, "Factory not found");
    ok(res, {
        adminProfile: factory.adminProfile ?? {},
        companyProfile: factory.companyProfile ?? {},
        integrations: factory.integrations ?? {},
    });
});
factoryRoutes.get("/:factoryId/subscription", requireFactoryScope, async (req, res) => {
    const parsedQuery = subscriptionOverviewQuerySchema.safeParse(req.query);
    if (!parsedQuery.success)
        return fail(res, 400, "Invalid subscription query");
    const overview = await getFactorySubscriptionOverview(req.params.factoryId, {
        userId: req.user?.id ?? null,
        globalRole: req.user?.globalRole ?? "staff",
        ...parsedQuery.data,
    });
    ok(res, overview);
});
factoryRoutes.put("/:factoryId/settings", requirePagePermission("settings", "update"), async (req, res) => {
    const updated = await FactoryModel.findByIdAndUpdate(req.params.factoryId, {
        adminProfile: req.body.adminProfile ?? {},
        companyProfile: req.body.companyProfile ?? {},
        integrations: req.body.integrations ?? {},
        updatedBy: req.user?.id,
    }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Factory not found");
    ok(res, { message: "Settings saved" });
});
factoryRoutes.post("/:factoryId/admin-profile", requirePagePermission("settings", "update"), async (req, res) => {
    const adminProfile = req.body.adminProfile ?? req.body;
    const updated = await FactoryModel.findByIdAndUpdate(req.params.factoryId, { adminProfile, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Factory not found");
    ok(res, { message: "Admin profile saved" });
});
