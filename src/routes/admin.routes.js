import { Router } from "express";
import { ok } from "../utils/api-response.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { FactoryModel } from "../models/factory.model.js";
import { FactorySubscriptionModel } from "../models/factory-subscription.model.js";
import { TransactionModel } from "../models/transaction.model.js";
import { UserModel } from "../models/user.model.js";
import { z } from "zod";
export const adminRoutes = Router();
adminRoutes.use(requireAuth, requireRole("super_admin"));
const factoriesQuerySchema = z.object({
    search: z.string().trim().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});
adminRoutes.get("/dashboard/summary", async (_req, res) => {
    const [factories, subscriptions, superAdmins, factoryUsers, payments, revenueResult] = await Promise.all([
        FactoryModel.find({}).sort({ createdAt: -1 }).limit(10).lean(),
        FactorySubscriptionModel.find({ isCurrent: true }).sort({ createdAt: -1 }).limit(10).populate("factoryId", "name code").lean(),
        UserModel.countDocuments({ globalRole: "super_admin", active: true }),
        UserModel.countDocuments({ factoryId: { $ne: null }, active: true }),
        TransactionModel.find({}).sort({ date: -1 }).limit(10).populate("factoryId", "name").lean(),
        TransactionModel.aggregate([
            { $match: { type: "income", status: "completed" } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
        ]),
    ]);
    ok(res, {
        stats: {
            factories: await FactoryModel.countDocuments(),
            superAdmins,
            factoryUsers,
            revenue: Number(revenueResult[0]?.total ?? 0),
        },
        recentFactories: factories.map((factory) => ({
            id: String(factory._id),
            name: factory.name,
            code: factory.code,
            status: factory.status,
            subscription: { status: factory.subscriptionStatus, plan: factory.subscriptionPlan },
        })),
        recentSubscriptions: subscriptions.map((subscription) => ({
            id: String(subscription._id),
            plan: subscription.planSnapshot?.name || subscription.planSnapshot?.key || "trial",
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            factoryId: {
                id: String(subscription.factoryId?._id ?? subscription.factoryId),
                name: subscription.factoryId?.name || "Unknown Factory",
                code: subscription.factoryId?.code || "",
            },
        })),
        recentPayments: payments.map((payment) => ({
            id: String(payment._id),
            amount: Number(payment.amount),
            currency: payment.currency,
            status: payment.status === "completed" ? "paid" : payment.status,
            paidAt: payment.date,
            factoryId: payment.factoryId,
        })),
    });
});
adminRoutes.get("/factories", async (req, res) => {
    const parsedQuery = factoriesQuerySchema.safeParse(req.query);
    if (!parsedQuery.success)
        return res.status(400).json({ success: false, data: null, message: "Invalid factories query" });
    const search = parsedQuery.data.search?.trim() ?? "";
    const limit = parsedQuery.data.limit ?? 100;
    const filter = search
        ? {
            $or: [
                { name: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu") },
                { code: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu") },
                { status: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu") },
            ],
        }
        : {};
    const factories = await FactoryModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    const rows = await Promise.all(factories.map(async (factory) => {
        const [members, payments, adminUser] = await Promise.all([
            UserModel.countDocuments({ factoryId: factory._id, active: true }),
            TransactionModel.countDocuments({ factoryId: factory._id }),
            UserModel.findOne({ factoryId: factory._id, factoryRole: "admin", active: true }).lean(),
        ]);
        return {
            id: String(factory._id),
            name: factory.name,
            code: factory.code,
            adminEmail: adminUser?.email,
            status: factory.status,
            subscriptionStatus: factory.subscriptionStatus,
            subscriptionPlan: factory.subscriptionPlan,
            memberCount: members,
            paymentCount: payments,
        };
    }));
    ok(res, rows);
});
