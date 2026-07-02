import { fail, ok } from "../../utils/api-response.js";
import { z } from "zod";
import { FactoryModel } from "../../models/factory.model.js";
import { ProjectModel } from "../../models/project.model.js";
import { UserModel } from "../../models/user.model.js";
import { getFactorySubscriptionContext, getFactorySubscriptionOverview } from "../../services/subscription.service.js";
const subscriptionOverviewQuerySchema = z.object({
    plansPage: z.coerce.number().int().min(1).optional(),
    plansLimit: z.coerce.number().int().min(1).max(50).optional(),
    usagePage: z.coerce.number().int().min(1).optional(),
    usageLimit: z.coerce.number().int().min(1).max(50).optional(),
});
export async function handleGetFactory(req, res) {
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
}
export async function handleUpdateFactory(req, res) {
    const updated = await FactoryModel.findByIdAndUpdate(req.params.factoryId, { ...req.body, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Factory not found");
    ok(res, updated, "Factory updated");
}
export async function handleGetFactorySettings(req, res) {
    const factory = await FactoryModel.findById(req.params.factoryId).lean();
    if (!factory)
        return fail(res, 404, "Factory not found");
    ok(res, {
        adminProfile: factory.adminProfile ?? {},
        companyProfile: {
            ...(factory.companyProfile ?? {}),
            companyName: factory.companyProfile?.companyName || factory.name || "",
        },
        integrations: factory.integrations ?? {},
    });
}
export async function handleGetFactorySubscription(req, res) {
    const parsedQuery = subscriptionOverviewQuerySchema.safeParse(req.query);
    if (!parsedQuery.success)
        return fail(res, 400, "Invalid subscription query");
    const overview = await getFactorySubscriptionOverview(req.params.factoryId, {
        userId: req.user?.id ?? null,
        globalRole: req.user?.globalRole ?? "staff",
        ...parsedQuery.data,
    });
    ok(res, overview);
}
export async function handleSaveFactorySettings(req, res) {
    const companyProfile = req.body.companyProfile ?? {};
    const companyName = String(companyProfile.companyName ?? "").trim();
    const updated = await FactoryModel.findByIdAndUpdate(req.params.factoryId, {
        adminProfile: req.body.adminProfile ?? {},
        companyProfile: {
            ...companyProfile,
            companyName,
        },
        ...(companyName ? { name: companyName } : {}),
        integrations: req.body.integrations ?? {},
        updatedBy: req.user?.id,
    }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Factory not found");
    ok(res, {
        message: "Settings saved",
        settings: {
            adminProfile: updated.adminProfile ?? {},
            companyProfile: {
                ...(updated.companyProfile ?? {}),
                companyName: updated.companyProfile?.companyName || updated.name || "",
            },
            integrations: updated.integrations ?? {},
        },
    });
}
export async function handleSaveFactoryAdminProfile(req, res) {
    const adminProfile = req.body.adminProfile ?? req.body;
    const updated = await FactoryModel.findByIdAndUpdate(req.params.factoryId, { adminProfile, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Factory not found");
    ok(res, { message: "Admin profile saved" });
}
