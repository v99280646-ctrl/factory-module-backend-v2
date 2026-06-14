import { Router } from "express";
import { ok } from "../utils/api-response.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { FactoryModel } from "../models/factory.model.js";
import { MembershipModel } from "../models/membership.model.js";
import { TransactionModel } from "../models/transaction.model.js";
import { UserModel } from "../models/user.model.js";

export const adminRoutes = Router();

adminRoutes.use(requireAuth, requireRole("super_admin"));

adminRoutes.get("/dashboard/summary", async (_req, res) => {
  const [factories, superAdmins, factoryUsers, payments, revenueResult] = await Promise.all([
    FactoryModel.find({}).sort({ createdAt: -1 }).limit(10).lean(),
    UserModel.countDocuments({ globalRole: "super_admin", active: true }),
    MembershipModel.countDocuments({ active: true }),
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
    recentSubscriptions: factories.map((factory) => ({
      id: String(factory._id),
      plan: factory.subscriptionPlan,
      status: factory.subscriptionStatus,
      currentPeriodEnd: null,
      factoryId: { name: factory.name },
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

adminRoutes.get("/factories", async (_req, res) => {
  const factories = await FactoryModel.find({}).sort({ createdAt: -1 }).lean();
  const rows = await Promise.all(factories.map(async (factory) => {
    const [members, payments, adminMembership] = await Promise.all([
      MembershipModel.countDocuments({ factoryId: factory._id, active: true }),
      TransactionModel.countDocuments({ factoryId: factory._id }),
      MembershipModel.findOne({ factoryId: factory._id, role: "admin", active: true }).lean(),
    ]);
    const admin = adminMembership ? await UserModel.findById(adminMembership.userId).lean() : null;
    return {
      id: String(factory._id),
      name: factory.name,
      code: factory.code,
      adminEmail: admin?.email,
      status: factory.status,
      subscriptionStatus: factory.subscriptionStatus,
      subscriptionPlan: factory.subscriptionPlan,
      memberCount: members,
      paymentCount: payments,
    };
  }));
  ok(res, rows);
});
