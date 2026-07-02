import { ok } from "../../utils/api-response.js";
import { FactoryModel } from "../../models/factory.model.js";
import { CustomerModel } from "../../models/customer.model.js";
import { FactorySubscriptionModel } from "../../models/factory-subscription.model.js";
import { NotificationDispatchModel } from "../../models/notification-dispatch.model.js";
import { NotificationScheduleRunModel } from "../../models/notification-schedule-run.model.js";
import { NotificationSettingModel } from "../../models/notification-setting.model.js";
import { ProjectModel } from "../../models/project.model.js";
import { ServiceModel } from "../../models/service.model.js";
import { StockModel } from "../../models/stock.model.js";
import { TransactionModel } from "../../models/transaction.model.js";
import { VendorModel } from "../../models/vendor.model.js";
import { UserModel } from "../../models/user.model.js";
import { getNotificationSettings } from "../../services/notification-settings.service.js";
import { z } from "zod";
const factoriesQuerySchema = z.object({
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const factoryNotificationAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  search: z.string().trim().optional(),
  status: z
    .enum(["all", "scheduled", "sent", "cancelled", "skipped", "failed"])
    .optional(),
});
const globalNotificationHistoryQuerySchema = z.object({
  view: z.enum(["dispatch", "scheduled"]).default("dispatch"),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  search: z.string().trim().optional(),
  status: z
    .enum([
      "all",
      "pending",
      "scheduled",
      "sent",
      "cancelled",
      "skipped",
      "failed",
    ])
    .optional(),
  eventKey: z.string().trim().optional(),
  channel: z.enum(["all", "email", "whatsapp"]).optional(),
  factoryId: z.string().trim().optional(),
});
const factorySectionQuerySchema = z.object({
  section: z.enum([
    "staff",
    "customers",
    "vendors",
    "stocks",
    "services",
    "projects",
    "notifications",
  ]),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().optional(),
});

function parseTimezoneOffsetMinutes(timezone = "") {
  const value = String(timezone || "")
    .trim()
    .toUpperCase();
  if (!value) return 0;
  const match = value.match(/^(?:GMT|UTC)?([+-])(\d{1,2})(?::?(\d{2}))?$/i);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  return sign * (hours * 60 + minutes);
}

function getZonedParts(date = new Date(), timezone = "GMT+5:30") {
  const offsetMinutes = parseTimezoneOffsetMinutes(timezone);
  const zoned = new Date(date.getTime() + offsetMinutes * 60_000);
  return {
    year: zoned.getUTCFullYear(),
    month: zoned.getUTCMonth() + 1,
    day: zoned.getUTCDate(),
    hour: zoned.getUTCHours(),
    minute: zoned.getUTCMinutes(),
    dayOfWeek: zoned.getUTCDay(),
  };
}

function formatDateKey(parts) {
  return [
    parts.year,
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

function getWeekdayKey(dayOfWeek) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][dayOfWeek] || "sun";
}

function parseScheduleTime(time = "09:00") {
  const [hourText = "9", minuteText = "0"] = String(time || "09:00").split(":");
  return { hour: Number(hourText), minute: Number(minuteText) };
}

function formatScheduleLabel(schedule = {}) {
  return `${schedule.time || "09:00"} ${schedule.timezone || "GMT+5:30"}`;
}

function isScheduleDue(schedule, now = new Date()) {
  if (!schedule?.enabled) return false;
  const timezone = schedule.timezone || "GMT+5:30";
  const current = getZonedParts(now, timezone);
  const target = parseScheduleTime(schedule.time);
  const workingDays =
    Array.isArray(schedule.workingDays) && schedule.workingDays.length
      ? schedule.workingDays
      : ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  if (!workingDays.includes(getWeekdayKey(current.dayOfWeek))) {
    return false;
  }
  const currentMinutes = current.hour * 60 + current.minute;
  const targetMinutes = target.hour * 60 + target.minute;
  return currentMinutes >= targetMinutes;
}

async function buildScheduledTodayOverview(now = new Date()) {
  const settingRows = await NotificationSettingModel.find({
    "events.dailyUpdates.schedule.enabled": true,
  })
    .select({ factoryId: 1 })
    .lean();

  const items = [];
  for (const row of settingRows) {
    const factoryId = String(row.factoryId || "");
    if (!factoryId) continue;

    const [factory, settings] = await Promise.all([
      FactoryModel.findById(factoryId).lean(),
      getNotificationSettings(factoryId),
    ]);
    if (!factory || !settings?.events?.dailyUpdates?.schedule?.enabled) {
      continue;
    }

    const event = settings.events.dailyUpdates;
    const schedule = event.schedule || {};
    const timezone = schedule.timezone || "GMT+5:30";
    const zoned = getZonedParts(now, timezone);
    const dateKey = formatDateKey(zoned);
    const workingDays =
      Array.isArray(schedule.workingDays) && schedule.workingDays.length
        ? schedule.workingDays
        : ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    if (!workingDays.includes(getWeekdayKey(zoned.dayOfWeek))) {
      continue;
    }

    const run = await NotificationScheduleRunModel.findOne({
      factoryId,
      eventKey: "dailyUpdates",
      scheduleDateKey: dateKey,
      actionType: "schedule_run",
    })
      .sort({ sentAt: -1, createdAt: -1 })
      .lean();

    if (!run) {
      continue;
    }

    const scheduleTime = schedule.time || "09:00";
    const scheduleLabel = formatScheduleLabel(schedule);

    items.push({
      id: String(run._id),
      _id: String(run._id),
      factoryId: {
        id: String(factory._id),
        name: factory.name,
        code: factory.code,
      },
      factoryName: factory.name,
      eventKey: "dailyUpdates",
      title: event.title || "Daily updates",
      subject: `Daily updates - ${factory.name}`,
      message:
        run.message || `Scheduled daily update for ${factory.name} at ${scheduleLabel}.`,
      previewText:
        run.previewText || `Scheduled daily update for ${factory.name} at ${scheduleLabel}.`,
      status: run.status || "scheduled",
      scheduleDate: dateKey,
      scheduleDateKey: dateKey,
      scheduleTime,
      scheduleTimezone: timezone,
      sentAt: run.sentAt || null,
      createdAt: run.createdAt || null,
      channelResults: run.channelResults || {},
      summary: {
        ...(run.summary || {}),
        factoryName: factory.name,
        scheduleDate: dateKey,
        scheduleDateKey: dateKey,
      },
      meta: {
        ...(run.meta || {}),
        scheduleDateKey: dateKey,
        scheduleTime,
        scheduleTimezone: timezone,
      },
      recipients: run.recipients || [],
      workingDays,
    });
  }

  return items;
}

function matchesSearchTerm(item, search = "") {
  if (!search) return true;
  const needle = search.toLowerCase();
  return [
    item.title,
    item.subject,
    item.message,
    item.previewText,
    item.factoryName,
    item.scheduleDate,
    item.scheduleDateKey,
    item.scheduleTime,
    item.scheduleTimezone,
    item.eventKey,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}
export async function handleAdminDashboardSummary(_req, res) {
  const [
    factories,
    subscriptions,
    superAdmins,
    factoryUsers,
    payments,
    revenueResult,
  ] = await Promise.all([
    FactoryModel.find({}).sort({ createdAt: -1 }).limit(10).lean(),
    FactorySubscriptionModel.find({ isCurrent: true })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("factoryId", "name code")
      .lean(),
    UserModel.countDocuments({ globalRole: "super_admin", active: true }),
    UserModel.countDocuments({ factoryId: { $ne: null }, active: true }),
    TransactionModel.find({})
      .sort({ date: -1 })
      .limit(10)
      .populate("factoryId", "name")
      .lean(),
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
      subscription: {
        status: factory.subscriptionStatus,
        plan: factory.subscriptionPlan,
      },
    })),
    recentSubscriptions: subscriptions.map((subscription) => ({
      id: String(subscription._id),
      plan:
        subscription.planSnapshot?.name ||
        subscription.planSnapshot?.key ||
        "trial",
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
}
export async function handleAdminListFactories(req, res) {
  const parsedQuery = factoriesQuerySchema.safeParse(req.query);
  if (!parsedQuery.success)
    return res
      .status(400)
      .json({ success: false, data: null, message: "Invalid factories query" });
  const search = parsedQuery.data.search?.trim() ?? "";
  const limit = parsedQuery.data.limit ?? 100;
  const filter = search
    ? {
        $or: [
          {
            name: new RegExp(
              search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              "iu",
            ),
          },
          {
            code: new RegExp(
              search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              "iu",
            ),
          },
          {
            status: new RegExp(
              search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
              "iu",
            ),
          },
        ],
      }
    : {};
  const factories = await FactoryModel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const rows = await Promise.all(
    factories.map(async (factory) => {
      const [members, payments, adminUser] = await Promise.all([
        UserModel.countDocuments({ factoryId: factory._id, active: true }),
        TransactionModel.countDocuments({ factoryId: factory._id }),
        UserModel.findOne({
          factoryId: factory._id,
          factoryRole: "admin",
          active: true,
        }).lean(),
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
    }),
  );
  ok(res, rows);
}
export async function handleAdminGetFactoryNotificationAudit(req, res) {
    const parsedQuery = factoryNotificationAuditQuerySchema.safeParse(
      req.query,
    );
    if (!parsedQuery.success) {
      return res.status(400).json({
        success: false,
        data: null,
        message: "Invalid notification audit query",
      });
    }
    const factoryId = req.params.factoryId;
    const [factory, settings] = await Promise.all([
      FactoryModel.findById(factoryId).lean(),
      getNotificationSettings(factoryId),
    ]);
    if (!factory) {
      return res
        .status(404)
        .json({ success: false, data: null, message: "Factory not found" });
    }
    const page = parsedQuery.data.page ?? 1;
    const limit = parsedQuery.data.limit ?? 10;
    const search = parsedQuery.data.search?.trim() ?? "";
    const status = parsedQuery.data.status ?? "all";
    const scheduleFilter = { factoryId };
    const dispatchFilter = { factoryId };
    if (status !== "all") {
      scheduleFilter.status = status;
      dispatchFilter.status = status;
    }
    if (search) {
      const regex = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "iu",
      );
      scheduleFilter.$or = [
        { eventKey: regex },
        { scheduleDate: regex },
        { scheduleDateKey: regex },
        { message: regex },
      ];
      dispatchFilter.$or = [
        { title: regex },
        { subject: regex },
        { message: regex },
        { "recipients.email": regex },
        { "recipients.name": regex },
        { "recipients.phone": regex },
        { "meta.date": regex },
      ];
    }
    const [scheduleTotal, dispatchTotal, scheduleRows, dispatchRows] =
      await Promise.all([
        NotificationScheduleRunModel.countDocuments(scheduleFilter),
        NotificationDispatchModel.countDocuments(dispatchFilter),
        NotificationScheduleRunModel.find(scheduleFilter)
          .sort({ sentAt: -1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
        NotificationDispatchModel.find(dispatchFilter)
          .sort({ sentAt: -1, createdAt: -1 })
          .limit(limit)
          .lean(),
      ]);
    ok(res, {
      factory: {
        id: String(factory._id),
        name: factory.name,
        code: factory.code,
        status: factory.status,
      },
      settings,
      scheduleRuns: scheduleRows,
      dispatchHistory: dispatchRows,
      pagination: {
        page,
        limit,
        total: scheduleTotal,
        totalPages: scheduleTotal ? Math.ceil(scheduleTotal / limit) : 0,
        hasNext: page * limit < scheduleTotal,
        hasPrev: page > 1,
      },
      historyPagination: {
        page: 1,
        limit,
        total: dispatchTotal,
        totalPages: dispatchTotal ? Math.ceil(dispatchTotal / limit) : 0,
        hasNext: dispatchTotal > limit,
        hasPrev: false,
      },
    });
}
export async function handleAdminListNotificationsHistory(req, res) {
  const parsedQuery = globalNotificationHistoryQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({
      success: false,
      data: null,
      message: "Invalid notification history query",
    });
  }

  const {
    view,
    status = "all",
    eventKey = "",
    channel = "all",
    search = "",
    factoryId = "",
  } = parsedQuery.data;
  const page = parsedQuery.data.page ?? 1;
  const limit = parsedQuery.data.limit ?? 20;
  let rows = [];

  if (view === "scheduled") {
    rows = await buildScheduledTodayOverview();
    if (factoryId) {
      rows = rows.filter((item) => item.factoryId?.id === factoryId);
    }
    if (eventKey) {
      rows = rows.filter((item) => item.eventKey === eventKey);
    }
    if (status !== "all") {
      rows = rows.filter((item) => item.status === status);
    }
    if (search) {
      rows = rows.filter((item) => matchesSearchTerm(item, search));
    }
    rows.sort((a, b) => {
      const left = `${a.scheduleDateKey || ""}${a.scheduleTime || ""}`;
      const right = `${b.scheduleDateKey || ""}${b.scheduleTime || ""}`;
      return left.localeCompare(right);
    });
  } else {
    const filter = {};
    if (factoryId) {
      filter.factoryId = factoryId;
    }
    if (eventKey) {
      filter.eventKey = eventKey;
    }
    if (status !== "all") {
      filter.status = status;
    }
    if (channel !== "all") {
      filter.channel = channel;
    }

    if (search) {
      const regex = new RegExp(
        search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        "iu",
      );
      filter.$or = [
        { title: regex },
        { subject: regex },
        { message: regex },
        { previewText: regex },
        { "recipients.email": regex },
        { "recipients.name": regex },
        { "recipients.phone": regex },
        { "meta.date": regex },
      ];
    }

    rows = await NotificationDispatchModel.find(filter)
      .sort({ sentAt: -1, createdAt: -1 })
      .populate("factoryId", "name code")
      .lean();
  }

  const total = rows.length;
  const totalPages = total ? Math.ceil(total / limit) : 0;
  const pagedRows = rows.slice((page - 1) * limit, page * limit);

  return ok(res, {
    view,
    items: pagedRows,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
  });
}
export async function handleAdminGetFactorySectionData(req, res) {
  const parsedQuery = factorySectionQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({
      success: false,
      data: null,
      message: "Invalid factory section query",
    });
  }
  const factoryId = req.params.factoryId;
  const factory = await FactoryModel.findById(factoryId).lean();
  if (!factory) {
    return res
      .status(404)
      .json({ success: false, data: null, message: "Factory not found" });
  }
  const page = parsedQuery.data.page ?? 1;
  const limit = parsedQuery.data.limit ?? 10;
  const search = parsedQuery.data.search?.trim() ?? "";
  const regex = search
    ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu")
    : null;
  const baseFactoryFilter = { factoryId: factory._id };
  const buildPagination = (total) => ({
    page,
    limit,
    total,
    totalPages: total ? Math.ceil(total / limit) : 0,
    hasNext: page * limit < total,
    hasPrev: page > 1,
  });
  if (parsedQuery.data.section === "notifications") {
    const [
      settings,
      scheduleTotal,
      dispatchTotal,
      scheduleRuns,
      dispatchHistory,
    ] = await Promise.all([
      getNotificationSettings(factoryId),
      NotificationScheduleRunModel.countDocuments(baseFactoryFilter),
      NotificationDispatchModel.countDocuments(baseFactoryFilter),
      NotificationScheduleRunModel.find(baseFactoryFilter)
        .sort({ sentAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      NotificationDispatchModel.find(baseFactoryFilter)
        .sort({ sentAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);
    return ok(res, {
      section: "notifications",
      factory: {
        id: String(factory._id),
        name: factory.name,
        code: factory.code,
        status: factory.status,
      },
      settings,
      scheduleRuns,
      dispatchHistory,
      schedulePagination: buildPagination(scheduleTotal),
      dispatchPagination: buildPagination(dispatchTotal),
    });
  }

  const sectionConfig = {
    staff: {
      model: UserModel,
      filter: { ...baseFactoryFilter, factoryRole: "staff" },
      select: {
        name: 1,
        email: 1,
        phone: 1,
        employeeRole: 1,
        active: 1,
        createdAt: 1,
      },
      map: (row) => ({
        id: String(row._id),
        name: row.name || "",
        email: row.email || "",
        phone: row.phone || "",
        employeeRole: row.employeeRole || "",
        active: row.active,
        createdAt: row.createdAt,
      }),
    },
    customers: {
      model: CustomerModel,
      filter: { ...baseFactoryFilter },
      select: {
        name: 1,
        companyName: 1,
        email: 1,
        countryCode: 1,
        phone: 1,
        city: 1,
        state: 1,
        active: 1,
        createdAt: 1,
      },
      map: (row) => ({
        id: String(row._id),
        name: row.name || "",
        companyName: row.companyName || "",
        email: row.email || "",
        phone: [row.countryCode || "", row.phone || ""]
          .filter(Boolean)
          .join(" ")
          .trim(),
        city: row.city || "",
        state: row.state || "",
        active: row.active,
        createdAt: row.createdAt,
      }),
    },
    vendors: {
      model: VendorModel,
      filter: { ...baseFactoryFilter },
      select: {
        name: 1,
        companyName: 1,
        email: 1,
        countryCode: 1,
        phone: 1,
        city: 1,
        state: 1,
        active: 1,
        createdAt: 1,
      },
      map: (row) => ({
        id: String(row._id),
        name: row.name || "",
        companyName: row.companyName || "",
        email: row.email || "",
        phone: [row.countryCode || "", row.phone || ""]
          .filter(Boolean)
          .join(" ")
          .trim(),
        city: row.city || "",
        state: row.state || "",
        active: row.active,
        createdAt: row.createdAt,
      }),
    },
    stocks: {
      model: StockModel,
      filter: { ...baseFactoryFilter },
      select: {
        code: 1,
        name: 1,
        material: 1,
        type: 1,
        thickness: 1,
        quantity: 1,
        unit: 1,
        reorderLevel: 1,
        active: 1,
        createdAt: 1,
      },
      map: (row) => ({
        id: String(row._id),
        code: row.code || "",
        name: row.name || "",
        material: row.material || "",
        type: row.type || "",
        thickness: row.thickness || "",
        quantity: Number(row.quantity ?? 0),
        unit: row.unit || "pcs",
        reorderLevel: Number(row.reorderLevel ?? 0),
        active: row.active,
        createdAt: row.createdAt,
      }),
    },
    services: {
      model: ServiceModel,
      filter: { ...baseFactoryFilter },
      select: {
        code: 1,
        name: 1,
        category: 1,
        price: 1,
        duration: 1,
        durationUnit: 1,
        employeeRole: 1,
        active: 1,
        createdAt: 1,
      },
      map: (row) => ({
        id: String(row._id),
        code: row.code || "",
        name: row.name || "",
        category: row.category || "",
        price: Number(row.price ?? 0),
        duration: row.duration ?? null,
        durationUnit: row.durationUnit || "",
        employeeRole: row.employeeRole || "",
        active: row.active,
        createdAt: row.createdAt,
      }),
    },
    projects: {
      model: ProjectModel,
      filter: { ...baseFactoryFilter },
      select: {
        code: 1,
        name: 1,
        customerName: 1,
        status: 1,
        progress: 1,
        grandTotal: 1,
        amount: 1,
        delivery: 1,
        createdAt: 1,
      },
      map: (row) => ({
        id: String(row._id),
        code: row.code || "",
        name: row.name || "",
        customerName: row.customerName || "",
        status: row.status || "",
        progress: Number(row.progress ?? 0),
        amount: Number(row.amount ?? row.grandTotal ?? 0),
        delivery: row.delivery,
        createdAt: row.createdAt,
      }),
    },
  };
  const config = sectionConfig[parsedQuery.data.section];
  if (!config) {
    return res
      .status(400)
      .json({ success: false, data: null, message: "Unsupported section" });
  }
  const searchFieldMap = {
    staff: ["name", "email", "phone", "employeeRole"],
    customers: ["name", "companyName", "email", "phone", "city", "state"],
    vendors: ["name", "companyName", "email", "phone", "city", "state"],
    stocks: ["code", "name", "material", "type", "thickness"],
    services: ["code", "name", "category", "employeeRole"],
    projects: ["code", "name", "customerName", "status"],
  };
  if (regex) {
    config.filter.$or = searchFieldMap[parsedQuery.data.section].map(
      (field) => ({ [field]: regex }),
    );
  }
  const total = await config.model.countDocuments(config.filter);
  const rows = await config.model
    .find(config.filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  ok(res, {
    section: parsedQuery.data.section,
    factory: {
      id: String(factory._id),
      name: factory.name,
      code: factory.code,
      status: factory.status,
    },
    items: rows.map(config.map),
    pagination: buildPagination(total),
  });
}
