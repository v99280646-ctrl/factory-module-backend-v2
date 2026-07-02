import { z } from "zod";
import { fail, ok } from "../../utils/api-response.js";
import { FactoryModel } from "../../models/factory.model.js";
import { FactorySubscriptionModel } from "../../models/factory-subscription.model.js";
import { SubscriptionHistoryModel } from "../../models/subscription-history.model.js";
import { SubscriptionPlanModel } from "../../models/subscription-plan.model.js";
import {
  createFactorySubscription,
  cancelFactorySubscription,
  ensureDefaultSubscriptionPlans,
  getFactorySubscriptionContext,
  normalizeFeatureOverrides,
  normalizePlanInput,
  syncFactorySubscriptionSnapshot,
} from "../../services/subscription.service.js";

function mapPlan(plan) {
  return {
    id: String(plan._id),
    key: plan.key,
    name: plan.name,
    description: plan.description,
    isActive: plan.isActive,
    isDefault: plan.isDefault,
    price: plan.price,
    currency: plan.currency,
    durationValue: plan.durationValue,
    durationUnit: plan.durationUnit,
    sortOrder: plan.sortOrder,
    features: plan.features ?? [],
  };
}

const planSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional().default(""),
  isActive: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
  price: z.number().nonnegative().optional().default(0),
  currency: z.string().optional().default("INR"),
  durationValue: z.number().int().positive().optional().default(3),
  durationUnit: z.enum(["days", "months", "years"]).optional().default("days"),
  sortOrder: z.number().optional().default(0),
  features: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    enabled: z.boolean().optional().default(true),
    mode: z.enum(["enabled", "limited", "unlimited", "disabled"]).optional().default("enabled"),
    limit: z.coerce.number().nullable().optional().default(null),
    unit: z.string().optional().default(""),
    description: z.string().optional().default(""),
  })).optional().default([]),
});

const assignSchema = z.object({
  planId: z.string().min(1),
  status: z.enum(["trial", "active", "past_due", "cancelled", "expired", "superseded"]).optional().default("active"),
  periodValue: z.number().int().positive().optional(),
  periodUnit: z.enum(["days", "months", "years"]).optional(),
  featureOverrides: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    enabled: z.boolean().optional(),
    mode: z.enum(["enabled", "limited", "unlimited", "disabled"]).optional(),
    limit: z.coerce.number().nullable().optional(),
    unit: z.string().optional(),
    description: z.string().optional(),
  })).optional().default([]),
  notes: z.string().optional().default(""),
});

const cancelSchema = z.object({
  note: z.string().optional().default(""),
});

const historyQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});

const factoriesQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: z.enum(["all", "active", "trial", "past_due", "cancelled", "expired", "superseded"]).optional().default("all"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});
export async function handleListSubscriptionPlans(_req, res) {
  const plans = await ensureDefaultSubscriptionPlans();
  ok(res, plans.map(mapPlan));
}

export async function handleCreateSubscriptionPlan(req, res) {
  const parsed = planSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid subscription plan payload");
  const created = await SubscriptionPlanModel.create(normalizePlanInput(parsed.data));
  ok(res, mapPlan(created.toObject()), "Subscription plan created");
}

export async function handleUpdateSubscriptionPlan(req, res) {
  const parsed = planSchema.partial().safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid subscription plan payload");
  const updated = await SubscriptionPlanModel.findByIdAndUpdate(
    req.params.id,
    normalizePlanInput({ ...(await SubscriptionPlanModel.findById(req.params.id).lean()), ...parsed.data }),
    { new: true }
  ).lean();
  if (!updated) return fail(res, 404, "Subscription plan not found");
  ok(res, mapPlan(updated), "Subscription plan updated");
}

export async function handleListFactorySubscriptions(req, res) {
  const parsed = factoriesQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, "Invalid subscriptions query");

  const { search, status, page, limit } = parsed.data;
  const escapedSearch = search
    ? search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    : "";
  const searchRegex = escapedSearch ? new RegExp(escapedSearch, "iu") : null;

  const match = {
    isCurrent: true,
    ...(status !== "all" ? { status } : {}),
  };

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: FactoryModel.collection.name,
        localField: "factoryId",
        foreignField: "_id",
        as: "factory",
      },
    },
    { $unwind: { path: "$factory", preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: SubscriptionPlanModel.collection.name,
        localField: "planId",
        foreignField: "_id",
        as: "planDoc",
      },
    },
    { $unwind: { path: "$planDoc", preserveNullAndEmptyArrays: true } },
    ...(searchRegex
      ? [{
          $match: {
            $or: [
              { "factory.name": searchRegex },
              { "factory.code": searchRegex },
              { status: searchRegex },
              { billingCycle: searchRegex },
              { "planDoc.name": searchRegex },
              { "planDoc.key": searchRegex },
              { "planSnapshot.name": searchRegex },
              { "planSnapshot.key": searchRegex },
            ],
          },
        }]
      : []),
    {
      $facet: {
        items: [
          { $sort: { createdAt: -1 } },
          { $skip: (page - 1) * limit },
          { $limit: limit },
        ],
        meta: [{ $count: "total" }],
        summary: [
          {
            $group: {
              _id: null,
              totalFactories: { $sum: 1 },
              activeFactories: {
                $sum: {
                  $cond: [{ $in: ["$status", ["active", "trial"]] }, 1, 0],
                },
              },
              expiredFactories: {
                $sum: {
                  $cond: [{ $in: ["$status", ["expired", "past_due"]] }, 1, 0],
                },
              },
            },
          },
        ],
      },
    },
  ];

  const [result] = await FactorySubscriptionModel.aggregate(pipeline);
  const items = result?.items ?? [];
  const total = result?.meta?.[0]?.total ?? 0;
  const summary = result?.summary?.[0] ?? { totalFactories: 0, activeFactories: 0, expiredFactories: 0 };

  ok(res, {
    items: items.map((subscription) => ({
      id: String(subscription._id),
      factoryId: {
        id: String(subscription.factory?._id ?? subscription.factoryId),
        name: subscription.factory?.name || "Unknown Factory",
        code: subscription.factory?.code || "",
        status: subscription.factory?.status || "active",
      },
      plan: {
        id: String(subscription.planDoc?._id ?? subscription.planId),
        key: subscription.planSnapshot?.key || subscription.planDoc?.key || "trial",
        name: subscription.planSnapshot?.name || subscription.planDoc?.name || "Trial",
      },
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart,
      currentPeriodEnd: subscription.currentPeriodEnd,
      trialEndsAt: subscription.trialEndsAt,
      billingCycle: subscription.billingCycle,
      features: subscription.planSnapshot?.features ?? [],
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    summary,
  });
}

export async function handleGetFactorySubscriptionHistory(req, res) {
  const history = await SubscriptionHistoryModel.find({ factoryId: req.params.factoryId }).sort({ createdAt: -1 }).lean();
  ok(
    res,
    history.map((row) => ({
      id: String(row._id),
      action: row.action,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      note: row.note,
      createdAt: row.createdAt,
    }))
  );
}

export async function handleListSubscriptionHistory(req, res) {
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 400, "Invalid history query");

  const { search, page, limit } = parsed.data;
  const matchStages = [];

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "iu");
    matchStages.push({
      $match: {
        $or: [
          { "factory.name": regex },
          { "factory.code": regex },
          { action: regex },
          { note: regex },
          { fromStatus: regex },
          { toStatus: regex },
        ],
      },
    });
  }

  const pipeline = [
    {
      $lookup: {
        from: FactoryModel.collection.name,
        localField: "factoryId",
        foreignField: "_id",
        as: "factory",
      },
    },
    { $unwind: { path: "$factory", preserveNullAndEmptyArrays: true } },
    ...matchStages,
    { $sort: { createdAt: -1 } },
    {
      $facet: {
        items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
        meta: [{ $count: "total" }],
      },
    },
  ];

  const [result] = await SubscriptionHistoryModel.aggregate(pipeline);
  const items = result?.items ?? [];
  const total = result?.meta?.[0]?.total ?? 0;

  ok(res, {
    items: items.map((row) => ({
      id: String(row._id),
      factoryId: {
        id: String(row.factory?._id ?? row.factoryId),
        name: row.factory?.name || "Unknown Factory",
        code: row.factory?.code || "",
      },
      action: row.action,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      note: row.note,
      createdAt: row.createdAt,
    })),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function handleAssignFactorySubscription(req, res) {
  const parsed = assignSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid assignment payload");
  const factory = await FactoryModel.findById(req.params.factoryId).lean();
  if (!factory) return fail(res, 404, "Factory not found");

  const assignment = await createFactorySubscription({
    factoryId: factory._id,
    planId: parsed.data.planId,
    status: parsed.data.status,
    periodValue: parsed.data.periodValue,
    periodUnit: parsed.data.periodUnit,
    featureOverrides: normalizeFeatureOverrides(parsed.data.featureOverrides),
    assignedBy: req.user?.id ?? null,
    changedBy: req.user?.id ?? null,
    notes: parsed.data.notes,
  });

  await syncFactorySubscriptionSnapshot(factory._id, assignment);

  ok(res, { id: String(assignment._id) }, "Subscription assigned");
}

export async function handleRenewFactorySubscription(req, res) {
  const factoryId = req.params.factoryId;
  const current = await getFactorySubscriptionContext(factoryId);
  if (!current?.subscription) {
    return fail(res, 404, "Factory subscription not found");
  }
  const updated = await createFactorySubscription({
    factoryId,
    planId: current.subscription.planId,
    status: "active",
    periodValue: current.plan?.durationValue,
    periodUnit: current.plan?.durationUnit,
    featureOverrides: current.subscription.featureOverrides,
    assignedBy: req.user?.id ?? null,
    changedBy: req.user?.id ?? null,
    notes: "Renewed subscription",
  });
  ok(res, { id: String(updated._id) }, "Subscription renewed");
}

export async function handleCancelFactorySubscription(req, res) {
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid cancel payload");

  const cancelled = await cancelFactorySubscription({
    factoryId: req.params.factoryId,
    changedBy: req.user?.id ?? null,
    note: parsed.data.note,
  });

  if (!cancelled) {
    return fail(res, 404, "Factory subscription not found");
  }

  ok(res, { id: String(cancelled._id) }, "Subscription cancelled");
}
