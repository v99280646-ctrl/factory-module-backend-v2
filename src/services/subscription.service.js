import { FactoryModel } from "../models/factory.model.js";
import { FactorySubscriptionModel } from "../models/factory-subscription.model.js";
import { CustomerModel } from "../models/customer.model.js";
import { ProjectModel } from "../models/project.model.js";
import { ServiceModel } from "../models/service.model.js";
import { SubscriptionHistoryModel } from "../models/subscription-history.model.js";
import { DEFAULT_SUBSCRIPTION_PLANS, SubscriptionPlanModel } from "../models/subscription-plan.model.js";
import { StaffUsageLogModel } from "../models/staff-usage-log.model.js";
import { UserModel } from "../models/user.model.js";
import { VendorModel } from "../models/vendor.model.js";
import { StockModel } from "../models/stock.model.js";

function addDuration(date, value, unit) {
  const next = new Date(date);
  if (unit === "months") {
    next.setMonth(next.getMonth() + value);
    return next;
  }
  if (unit === "years") {
    next.setFullYear(next.getFullYear() + value);
    return next;
  }
  next.setDate(next.getDate() + value);
  return next;
}

function normalizeFeature(feature) {
  if (!feature?.key || !feature?.label) return null;
  return {
    key: String(feature.key).trim().toLowerCase(),
    label: String(feature.label).trim(),
    enabled: feature.enabled !== false,
    mode: ["enabled", "limited", "unlimited", "disabled"].includes(feature.mode) ? feature.mode : "enabled",
    limit: feature.limit === "" || feature.limit === null || feature.limit === undefined ? null : Number(feature.limit),
    unit: String(feature.unit ?? "").trim(),
    description: String(feature.description ?? "").trim(),
  };
}

export function normalizePlanInput(input = {}) {
  return {
    key: String(input.key ?? "").trim().toLowerCase(),
    name: String(input.name ?? "").trim(),
    description: String(input.description ?? "").trim(),
    isActive: input.isActive !== false,
    isDefault: input.isDefault === true,
    price: Number(input.price ?? 0),
    currency: String(input.currency ?? "INR").trim().toUpperCase(),
    durationValue: Number(input.durationValue ?? 3),
    durationUnit: ["days", "months", "years"].includes(input.durationUnit) ? input.durationUnit : "days",
    features: Array.isArray(input.features) ? input.features.map(normalizeFeature).filter(Boolean) : [],
    sortOrder: Number(input.sortOrder ?? 0),
  };
}

export function normalizeFeatureOverrides(input = []) {
  return Array.isArray(input) ? input.map(normalizeFeature).filter(Boolean) : [];
}

export function mergePlanFeatures(base = [], overrides = []) {
  const merged = new Map();
  for (const feature of base) {
    merged.set(feature.key, { ...feature });
  }
  for (const feature of overrides) {
    merged.set(feature.key, { ...(merged.get(feature.key) ?? {}), ...feature });
  }
  return [...merged.values()];
}

export async function ensureDefaultSubscriptionPlans() {
  for (const plan of DEFAULT_SUBSCRIPTION_PLANS) {
    await SubscriptionPlanModel.updateOne(
      { key: plan.key },
      { $setOnInsert: normalizePlanInput(plan) },
      { upsert: true }
    );
  }
  return SubscriptionPlanModel.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean();
}

export async function getDefaultSubscriptionPlan() {
  await ensureDefaultSubscriptionPlans();
  return SubscriptionPlanModel.findOne({ isDefault: true, isActive: true }).sort({ sortOrder: 1 }).lean();
}

export async function getActiveFactorySubscription(factoryId) {
  const current = await FactorySubscriptionModel.findOne({ factoryId, isCurrent: true }).lean();
  if (!current) return null;
  const plan = await SubscriptionPlanModel.findById(current.planId).lean();
  return plan ? { subscription: current, plan } : { subscription: current, plan: null };
}

export async function syncFactorySubscriptionSnapshot(factoryId, subscription, plan) {
  if (!factoryId || !subscription) return null;

  const effectivePlan = plan ?? (await SubscriptionPlanModel.findById(subscription.planId).lean());
  const mergedFeatures = mergePlanFeatures(effectivePlan?.features ?? [], subscription.featureOverrides ?? []);

  const factoryUpdate = {
    subscriptionId: subscription._id,
    subscriptionPlan: effectivePlan?.key ?? subscription.planSnapshot?.key ?? "trial",
    subscriptionStatus: subscription.status,
    subscriptionStartedAt: subscription.currentPeriodStart ?? null,
    subscriptionEndsAt: subscription.currentPeriodEnd ?? null,
    subscriptionTrialEndsAt: subscription.trialEndsAt ?? null,
    subscriptionCycle: subscription.billingCycle ?? effectivePlan?.durationUnit ?? "days",
  };

  await FactoryModel.findByIdAndUpdate(factoryId, factoryUpdate, { new: true });

  return {
    ...subscription,
    plan: effectivePlan,
    features: mergedFeatures,
  };
}

export async function createFactorySubscription({
  factoryId,
  planId,
  status = "trial",
  startedAt = new Date(),
  periodValue,
  periodUnit,
  featureOverrides = [],
  assignedBy = null,
  changedBy = null,
  notes = "",
}) {
  const plan = await SubscriptionPlanModel.findById(planId).lean();
  if (!plan) {
    throw new Error("Subscription plan not found");
  }

  const start = startedAt instanceof Date ? startedAt : new Date(startedAt);
  const durationValue = Number(periodValue ?? plan.durationValue ?? 3);
  const billingCycle = periodUnit && ["days", "months", "years"].includes(periodUnit) ? periodUnit : plan.durationUnit;
  const currentPeriodEnd = addDuration(start, durationValue, billingCycle);

  const subscription = await FactorySubscriptionModel.create({
    factoryId,
    planId: plan._id,
    status,
    billingCycle,
    currentPeriodStart: start,
    currentPeriodEnd,
    featureOverrides: normalizeFeatureOverrides(featureOverrides),
    planSnapshot: {
      key: plan.key,
      name: plan.name,
      description: plan.description,
      price: plan.price,
      currency: plan.currency,
      durationValue: plan.durationValue,
      durationUnit: plan.durationUnit,
      features: plan.features ?? [],
    },
    assignedBy,
    createdBy: changedBy ?? assignedBy,
    updatedBy: changedBy ?? assignedBy,
    notes,
    isCurrent: true,
  });

  await FactorySubscriptionModel.updateMany(
    { factoryId, _id: { $ne: subscription._id }, isCurrent: true },
    { $set: { isCurrent: false, status: "superseded", updatedBy: changedBy ?? assignedBy } }
  );

  await syncFactorySubscriptionSnapshot(factoryId, subscription, plan);

  await SubscriptionHistoryModel.create({
    factoryId,
    subscriptionId: subscription._id,
    planId: plan._id,
    action: "assigned",
    fromStatus: "",
    toStatus: status,
    note: notes,
    snapshot: {
      plan: plan.key,
      durationValue,
      durationUnit: billingCycle,
      features: mergePlanFeatures(plan.features ?? [], normalizeFeatureOverrides(featureOverrides)),
    },
    changedBy,
  });

  return subscription;
}

export async function cancelFactorySubscription({ factoryId, changedBy = null, note = "" }) {
  const active = await FactorySubscriptionModel.findOne({ factoryId, isCurrent: true });
  if (!active) {
    return null;
  }

  active.status = "cancelled";
  active.isCurrent = false;
  active.updatedBy = changedBy ?? active.updatedBy ?? null;
  active.notes = note || active.notes || "Subscription cancelled";
  active.currentPeriodEnd = active.currentPeriodEnd && new Date(active.currentPeriodEnd) < new Date() ? active.currentPeriodEnd : new Date();
  await active.save();

  await FactoryModel.findByIdAndUpdate(factoryId, {
    subscriptionStatus: "cancelled",
    subscriptionId: active._id,
    subscriptionEndsAt: active.currentPeriodEnd,
  });

  await SubscriptionHistoryModel.create({
    factoryId,
    subscriptionId: active._id,
    planId: active.planId,
    action: "cancelled",
    fromStatus: "active",
    toStatus: "cancelled",
    note: note || "Subscription cancelled",
    snapshot: {
      planId: String(active.planId),
      billingCycle: active.billingCycle,
      currentPeriodStart: active.currentPeriodStart,
      currentPeriodEnd: active.currentPeriodEnd,
    },
    changedBy,
  });

  return active.toObject();
}

export async function ensureFactoryDefaultSubscription(factoryId, actorId = null, { onlyIfNoHistory = true } = {}) {
  const existing = await FactorySubscriptionModel.findOne({ factoryId, isCurrent: true }).lean();
  if (existing) {
    return existing;
  }
  if (onlyIfNoHistory) {
    const hasAnySubscription = await FactorySubscriptionModel.exists({ factoryId });
    const hasHistory = await SubscriptionHistoryModel.exists({ factoryId });
    if (hasAnySubscription || hasHistory) {
      return null;
    }
  }
  const plan = await getDefaultSubscriptionPlan();
  if (!plan) {
    throw new Error("Default subscription plan is missing");
  }
  return createFactorySubscription({
    factoryId,
    planId: plan._id,
    status: "trial",
    startedAt: new Date(),
    periodValue: plan.durationValue,
    periodUnit: plan.durationUnit,
    assignedBy: actorId,
    changedBy: actorId,
    notes: "Default trial subscription",
  });
}

export async function expireFactorySubscriptionIfNeeded(factoryId) {
  const active = await FactorySubscriptionModel.findOne({ factoryId, isCurrent: true }).lean();
  if (!active) return null;
  if (!active.currentPeriodEnd) return active;
  if (new Date(active.currentPeriodEnd).getTime() > Date.now()) return active;

  await FactorySubscriptionModel.findByIdAndUpdate(active._id, { status: "expired", isCurrent: false });
  await FactoryModel.findByIdAndUpdate(factoryId, { subscriptionStatus: "expired" });
  await SubscriptionHistoryModel.create({
    factoryId,
    subscriptionId: active._id,
    planId: active.planId,
    action: "expired",
    fromStatus: active.status,
    toStatus: "expired",
    snapshot: active,
  });
  return { ...active, status: "expired", isCurrent: false };
}

export async function getFactorySubscriptionContext(factoryId) {
  const active = await expireFactorySubscriptionIfNeeded(factoryId);
  if (!active) {
    return null;
  }
  const plan = await SubscriptionPlanModel.findById(active.planId).lean();
  return {
    subscription: active,
    plan,
    features: mergePlanFeatures(plan?.features ?? [], active.featureOverrides ?? []),
  };
}

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

function mapUsageLog(row) {
  return {
    id: String(row._id),
    staffName: row.staffName,
    staffEmail: row.staffEmail,
    staffRole: row.staffRole,
    projectId: row.projectId ? String(row.projectId) : null,
    projectCode: row.projectCode,
    projectName: row.projectName,
    stageName: row.stageName,
    note: row.note,
    totalQuantityUsed: row.totalQuantityUsed ?? 0,
    sourceRecordId: row.sourceRecordId,
    activityAt: row.activityAt,
    materials: row.materials ?? [],
  };
}

function normalizePagination(input, fallbackPage, fallbackLimit) {
  const page = Number.parseInt(String(input?.page ?? fallbackPage), 10);
  const limit = Number.parseInt(String(input?.limit ?? fallbackLimit), 10);
  return {
    page: Number.isFinite(page) && page > 0 ? page : fallbackPage,
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 50) : fallbackLimit,
  };
}

function buildFeatureUsage({ counts = {}, features = [] } = {}) {
  const countFor = (key) => Number(counts[key] ?? 0);

  return features.reduce((acc, feature) => {
    if (!feature?.key) return acc;

    const used = countFor(feature.key);
    const limit = feature.mode === "limited" ? Number(feature.limit ?? 0) : null;
    const percentage = feature.mode === "limited" && limit > 0 ? Math.min((used / limit) * 100, 100) : null;

    acc[feature.key] = {
      used,
      limit,
      unit: feature.unit ?? "",
      mode: feature.mode,
      enabled: feature.enabled !== false,
      percentage,
      remaining: feature.mode === "limited" && limit !== null ? Math.max(limit - used, 0) : null,
      status:
        feature.enabled === false
          ? "disabled"
          : feature.mode === "unlimited"
            ? "unlimited"
            : feature.mode === "limited"
              ? used >= limit
                ? "at-limit"
                : used >= Math.max(limit * 0.8, 1)
                  ? "near-limit"
                  : "ok"
              : "enabled",
    };

    return acc;
  }, {});
}

async function countFactoryFeatureUsage(factoryId) {
  const [projectCount, customerCount, vendorCount, serviceCount, staffCount, stockCount] = await Promise.all([
    ProjectModel.countDocuments({ factoryId }),
    CustomerModel.countDocuments({ factoryId, active: true }),
    VendorModel.countDocuments({ factoryId, active: true }),
    ServiceModel.countDocuments({ factoryId, active: true }),
    UserModel.countDocuments({ factoryId, active: true, factoryRole: "staff" }),
    StockModel.countDocuments({ factoryId, active: true }),
  ]);

  return {
    projects: projectCount,
    customers: customerCount,
    vendors: vendorCount,
    services: serviceCount,
    staff: staffCount,
    stock: stockCount,
  };
}

function mapSubscriptionHistory(row) {
  return {
    id: String(row._id),
    action: row.action,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    note: row.note,
    createdAt: row.createdAt,
    subscriptionId: row.subscriptionId ? String(row.subscriptionId) : null,
    planId: row.planId ? String(row.planId) : null,
  };
}

function buildFeatureLimitState(feature, used) {
  if (!feature) {
    return {
      allowed: true,
      used,
      limit: null,
      mode: "enabled",
      status: "enabled",
      message: "",
    };
  }

  if (feature.enabled === false || feature.mode === "disabled") {
    return {
      allowed: false,
      used,
      limit: 0,
      mode: "disabled",
      status: "disabled",
      message: `${feature.label || "This feature"} is not available in your current subscription`,
    };
  }

  if (feature.mode === "unlimited" || feature.limit === null || feature.limit === undefined) {
    return {
      allowed: true,
      used,
      limit: null,
      mode: feature.mode,
      status: "unlimited",
      message: "",
    };
  }

  const limit = Number(feature.limit ?? 0);
  const remaining = limit - used;

  return {
    allowed: used < limit,
    used,
    limit,
    mode: feature.mode,
    status: used >= limit ? "at-limit" : used >= Math.max(limit * 0.8, 1) ? "near-limit" : "ok",
    remaining,
    message:
      used >= limit
        ? `${feature.label || "This feature"} limit reached for your current subscription (${used}/${limit} ${feature.unit || "items"})`
        : "",
  };
}

export async function getFactoryFeatureLimitState(factoryId, featureKey) {
  const subscriptionContext = await getFactorySubscriptionContext(factoryId);
  const activePlan = subscriptionContext?.plan;
  const effectiveFeatures = mergePlanFeatures(activePlan?.features ?? [], subscriptionContext?.subscription?.featureOverrides ?? []);
  const feature = effectiveFeatures.find((item) => item.key === String(featureKey).trim().toLowerCase());
  const usageCounts = await countFactoryFeatureUsage(factoryId);
  const used = Number(usageCounts[String(featureKey).trim().toLowerCase()] ?? 0);
  return buildFeatureLimitState(feature, used);
}

export async function assertFactoryFeatureLimit(factoryId, featureKey) {
  const state = await getFactoryFeatureLimitState(factoryId, featureKey);
  return state.allowed
    ? { allowed: true, state }
    : { allowed: false, state };
}

export async function getFactorySubscriptionOverview(
  factoryId,
  { plansPage = 1, plansLimit = 8, usagePage = 1, usageLimit = 8 } = {}
) {
  const plansPaging = normalizePagination({ page: plansPage, limit: plansLimit }, 1, 8);
  const usagePaging = normalizePagination({ page: usagePage, limit: usageLimit }, 1, 8);
  const usageFilter = { factoryId };

  const [context, latestSubscription, plansCount, usageCount, usageSummary, subscriptionHistory, allPlans] = await Promise.all([
    getFactorySubscriptionContext(factoryId),
    FactorySubscriptionModel.findOne({ factoryId }).sort({ createdAt: -1 }).lean(),
    SubscriptionPlanModel.countDocuments({ isActive: true }),
    StaffUsageLogModel.countDocuments(usageFilter),
    StaffUsageLogModel.aggregate([
      { $match: usageFilter },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          totalQuantityUsed: { $sum: { $ifNull: ["$totalQuantityUsed", 0] } },
          projects: { $addToSet: "$projectId" },
        },
      },
    ]),
    SubscriptionHistoryModel.find({ factoryId }).sort({ createdAt: -1 }).limit(20).lean(),
    ensureDefaultSubscriptionPlans(),
  ]);

  const activePlans = allPlans.filter((plan) => plan.isActive);
  const plansStart = (plansPaging.page - 1) * plansPaging.limit;
  const pagedPlans = activePlans.slice(plansStart, plansStart + plansPaging.limit);

  const usageRows = await StaffUsageLogModel.find(usageFilter)
    .sort({ activityAt: -1, createdAt: -1 })
    .skip((usagePaging.page - 1) * usagePaging.limit)
    .limit(usagePaging.limit)
    .lean();

  const subscription = context?.subscription ?? latestSubscription ?? null;
  const effectivePlan = context?.plan ?? (subscription ? await SubscriptionPlanModel.findById(subscription.planId).lean() : null);
  const effectiveFeatures = context?.features ?? mergePlanFeatures(effectivePlan?.features ?? [], subscription?.featureOverrides ?? []);

  const usageCounts = await countFactoryFeatureUsage(factoryId);
  const featureUsage = buildFeatureUsage({
    features: effectiveFeatures,
    counts: usageCounts,
  });

  return {
    subscription,
    plan: effectivePlan,
    features: effectiveFeatures,
    featureUsage,
    subscriptionHistory: subscriptionHistory.map(mapSubscriptionHistory),
    plans: pagedPlans.map(mapPlan),
    plansPagination: {
      page: plansPaging.page,
      limit: plansPaging.limit,
      total: plansCount,
      totalPages: plansCount ? Math.ceil(plansCount / plansPaging.limit) : 0,
    },
    usageHistory: usageRows.map(mapUsageLog),
    usagePagination: {
      page: usagePaging.page,
      limit: usagePaging.limit,
      total: usageCount,
      totalPages: usageCount ? Math.ceil(usageCount / usagePaging.limit) : 0,
    },
    usageSummary: {
      totalRecords: usageSummary[0]?.totalRecords ?? 0,
      totalQuantityUsed: usageSummary[0]?.totalQuantityUsed ?? 0,
      projectsCount: usageSummary[0]?.projects?.length ?? 0,
    },
  };
}
