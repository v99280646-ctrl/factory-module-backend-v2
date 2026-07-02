import { z } from "zod";
import { randomUUID } from "crypto";
import { FactoryModel } from "../../models/factory.model.js";
import { NotificationDispatchModel } from "../../models/notification-dispatch.model.js";
import { ProjectModel } from "../../models/project.model.js";
import { fail, ok } from "../../utils/api-response.js";
import { getNotificationSettings, saveNotificationSettings } from "../../services/notification-settings.service.js";
import { buildBrevoDailyUpdateHtml, pickBrevoSender, sendBrevoEmail } from "../../services/brevo-email.service.js";
import { buildDailyUpdateSummary, sendDailyUpdateEmail } from "../../services/daily-updates.service.js";
import { sendCurrentInventoryMessages, sendCurrentStockAlerts } from "../../services/stock-alerts.service.js";
import {
  buildWhatsAppTemplateMessage,
  buildWhatsAppTextMessage,
  gupshupSendMessage,
  getWhatsAppTemplate,
  resolveWhatsAppConfig,
} from "../../services/whatsapp.service.js";

const SCHEDULE_WORKING_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const recipientSchema = z.object({
  id: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  countryCode: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  enabled: z.boolean().optional(),
});

const eventChannelSchema = z.object({
  enabled: z.boolean().optional(),
  recipients: z.array(recipientSchema).optional(),
});

const eventScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  time: z.string().optional().nullable(),
  frequency: z.string().optional().nullable(),
  timezone: z.string().optional().nullable(),
  workingDays: z.array(z.enum(SCHEDULE_WORKING_DAYS)).optional(),
});

const eventSchema = z.object({
  enabled: z.boolean().optional(),
  thresholds: z.array(z.coerce.number().min(0)).optional(),
  channels: z
    .object({
      email: eventChannelSchema.optional(),
      whatsapp: eventChannelSchema.optional(),
    })
    .optional(),
  schedule: eventScheduleSchema.optional(),
});

const notificationSettingsSchema = z.object({
  channels: z
    .object({
      email: z.object({ enabled: z.boolean().optional() }).optional(),
      whatsapp: z.object({ enabled: z.boolean().optional() }).optional(),
    })
    .optional(),
  definitions: z
    .array(
      z.object({
        key: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional().nullable(),
        builtIn: z.boolean().optional(),
        schedule: z
          .object({
            enabled: z.boolean().optional(),
            time: z.string().optional().nullable(),
            frequency: z.string().optional().nullable(),
            timezone: z.string().optional().nullable(),
            workingDays: z.array(z.enum(SCHEDULE_WORKING_DAYS)).optional(),
          })
          .optional(),
        thresholds: z.array(z.coerce.number().min(0)).optional(),
      }),
    )
    .optional(),
  events: z.record(eventSchema).optional(),
});

const dailyUpdateSendSchema = z.object({
  date: z.string().optional().nullable(),
});

const notificationSendNowSchema = z.object({
  channel: z.enum(["email", "whatsapp"]).optional(),
  channels: z.array(z.enum(["email", "whatsapp"])).optional(),
});

const historyQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  eventKey: z.string().trim().optional(),
  channel: z.string().trim().optional(),
  status: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

function requireFactoryScope(req, res) {
  const factoryId = req.factoryId ?? null;
  if (!factoryId) {
    fail(res, 400, "Factory scope is required");
    return null;
  }
  return factoryId;
}

function buildGenericEventHtml({ factoryName, eventTitle, description, reportDate, recipientLabel, summary }) {
  const summaryRows = Object.entries(summary || {})
    .map(([label, value]) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${label}</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${value}</td></tr>`)
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:820px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.8;">Notification</div>
          <h1 style="margin:8px 0 0;font-size:28px;line-height:1.2;">${eventTitle}</h1>
          <p style="margin:8px 0 0;opacity:.9;">${factoryName} · ${reportDate}</p>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 12px;font-size:16px;">Hello ${recipientLabel || "team"}, this notification was sent from the event setup screen.</p>
          ${description ? `<p style="margin:0 0 20px;color:#475569;">${description}</p>` : ""}
          ${
            summaryRows
              ? `
                <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                  <tbody>${summaryRows}</tbody>
                </table>
              `
              : ""
          }
        </div>
      </div>
    </div>
  `;
}

function buildGenericEventText({ factoryName, eventTitle, description, reportDate, summary }) {
  const rows = Object.entries(summary || {}).map(([label, value]) => `${label}: ${value}`);
  return [
    eventTitle,
    factoryName,
    reportDate,
    description || "",
    ...rows,
  ].filter(Boolean).join("\n");
}

function buildEventContext({ factory, definition, eventKey, settings, reportDate, summary }) {
  const dailySummary = summary || {};
  return {
    factory: factory.name,
    factoryName: factory.name,
    eventKey,
    eventTitle: definition.title,
    description: definition.description || "",
    reportDate,
    projectsWorked: dailySummary.projectsWorked ?? 0,
    projectsCreatedToday: dailySummary.projectsCreatedToday ?? 0,
    projectsDeliveredToday: dailySummary.projectsDeliveredToday ?? 0,
    totalSheetsWorked: dailySummary.totalSheetsWorked ?? 0,
    totalUsageEntries: dailySummary.totalUsageEntries ?? 0,
    totalMaterialsUsed: dailySummary.totalMaterialsUsed ?? 0,
    totalProcessedUnits: dailySummary.totalProcessedUnits ?? 0,
    pressingSheets: dailySummary.pressingSheets ?? 0,
    cuttingSheets: dailySummary.cuttingSheets ?? 0,
    edgebandingSheets: dailySummary.edgebandingSheets ?? 0,
    boringSheets: dailySummary.boringSheets ?? 0,
    projectName: dailySummary.projectName ?? "",
    projectCode: dailySummary.projectCode ?? "",
    customerName: dailySummary.customerName ?? "",
    deliveryDate: dailySummary.deliveryDate ?? "",
    amount: dailySummary.amount ?? 0,
    statusLabel: dailySummary.statusLabel ?? "",
    name: dailySummary.projectName ?? "",
    status: dailySummary.statusLabel ?? "",
    eventStatus: settings?.events?.[eventKey]?.enabled ? "enabled" : "disabled",
    message: definition.description || definition.title,
  };
}

async function buildLatestProjectSummary(factoryId, eventKey) {
  const statusFilter = eventKey === "projectDelivered"
    ? { status: { $in: ["delivered", "completed"] } }
    : {};
  const project = await ProjectModel.findOne({
    factoryId,
    ...statusFilter,
  })
    .sort({ createdAt: -1, updatedAt: -1 })
    .lean();

  if (!project) {
    return null;
  }

  const deliveryDate = project.delivery
    ? new Date(project.delivery).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : "-";

  return {
    projectId: String(project._id),
    projectCode: String(project.code || ""),
    projectName: String(project.name || ""),
    customerName: String(project.customerName || ""),
    deliveryDate,
    amount: Number(project.grandTotal ?? project.amount ?? 0),
    statusLabel: String(project.status || ""),
    workType: String(project.workType || ""),
    createdAt: project.createdAt
      ? new Date(project.createdAt).toLocaleDateString("en-IN", {
          year: "numeric",
          month: "short",
          day: "2-digit",
        })
      : "-",
  };
}

function normalizeRequestedChannels(payload, event) {
  const enabledChannels = [];
  if (event?.channels?.email?.enabled) {
    enabledChannels.push("email");
  }
  if (event?.channels?.whatsapp?.enabled) {
    enabledChannels.push("whatsapp");
  }

  const requested = Array.isArray(payload?.channels) && payload.channels.length
    ? payload.channels
    : payload?.channel
      ? [payload.channel]
      : enabledChannels;

  return [...new Set(requested.filter((channel) => enabledChannels.includes(channel)))];
}

async function sendNotificationWhatsApp({
  factory,
  definition,
  eventKey,
  settings,
  reportDate,
  summary,
  recipients,
  req,
}) {
  const dispatchBase = {
    factoryId: req.factoryId,
    batchId: createBatchId(`${eventKey}_whatsapp`),
    eventKey,
    channel: "whatsapp",
    audience: "admin",
    subject: `${definition.title} - ${factory.name}`,
    title: `${definition.title} - ${factory.name}`,
    message: `${definition.title} sent to ${recipients.length} recipient(s).`,
    summary,
    actorId: req.user?.id,
    sentAt: new Date(),
    meta: {
      date: reportDate,
      manual: true,
      provider: "gupshup",
    },
  };

  const whatsappConfig = resolveWhatsAppConfig(factory);
  const template = getWhatsAppTemplate(whatsappConfig, eventKey);
  const hasTemplate = Boolean(template?.templateId);

  console.log(whatsappConfig, "whatsappConfig")

  if (!whatsappConfig.enabled || !whatsappConfig.apiKey || !whatsappConfig.source || !whatsappConfig.srcName) {
    const skipped = await NotificationDispatchModel.create({
      ...dispatchBase,
      recipientEmail: "",
      recipientName: "",
      status: "skipped",
      error: "WhatsApp configuration is missing",
      previewHtml: "",
      previewText: buildGenericEventText({
        factoryName: factory.name,
        eventTitle: definition.title,
        description: definition.description,
        reportDate,
        summary,
      }),
      recipients: [],
    });
    return { status: "skipped", deliveries: [{ status: "skipped", recordId: skipped._id }] };
  }

  if (!recipients.length) {
    const skipped = await NotificationDispatchModel.create({
      ...dispatchBase,
      recipientEmail: "",
      recipientName: "",
      status: "skipped",
      error: "No WhatsApp recipients configured",
      previewHtml: "",
      previewText: buildGenericEventText({
        factoryName: factory.name,
        eventTitle: definition.title,
        description: definition.description,
        reportDate,
        summary,
      }),
      recipients: [],
    });
    return { status: "skipped", deliveries: [{ status: "skipped", recordId: skipped._id }] };
  }

  const context = buildEventContext({
    factory,
    definition,
    eventKey,
    settings,
    reportDate,
    summary,
  });
  const message = hasTemplate
    ? buildWhatsAppTemplateMessage({ template, context })
    : {
        type: "text",
        message: buildWhatsAppTextMessage({
          template: {
            body: `${definition.title} for {{factory}}`,
            variableMappings: [
              { schemaField: "factory", useDefault: false },
            ],
          },
          context,
        }),
      };
  const previewText = hasTemplate
    ? buildWhatsAppTextMessage({ template, context })
    : message.message || JSON.stringify(message);

  const deliveries = [];
  for (const recipient of recipients) {
    const result = await gupshupSendMessage({
      message,
      destination: recipient.phone,
      source: whatsappConfig.source,
      srcName: whatsappConfig.srcName,
      apiKey: whatsappConfig.apiKey,
      countryCode: recipient.countryCode || whatsappConfig.countryCode || "+91",
    });

    deliveries.push({
      recipient: recipient.phone,
      ...result,
    });

    await NotificationDispatchModel.create({
      ...dispatchBase,
      recipientEmail: "",
      recipientName: recipient.name || "",
      status: result.success ? "sent" : "failed",
      error: result.success ? "" : (result.error?.message || result.error || "WhatsApp send failed"),
      previewHtml: "",
      previewText,
      recipients: [
        {
          name: recipient.name || "",
          status: result.success ? "sent" : "failed",
          error: result.success ? "" : (result.error?.message || result.error || "WhatsApp send failed"),
        },
      ],
        meta: {
          ...dispatchBase.meta,
          templateKey: template?.key || eventKey,
          provider: "gupshup",
        },
      });
    }

  const dispatchStatus = deliveries.some((item) => item.success === false)
    ? "failed"
    : deliveries.length
      ? "sent"
      : "skipped";

  return { status: dispatchStatus, deliveries };
}

async function sendNotificationEmail({
  factory,
  definition,
  eventKey,
  reportDate,
  summary,
  recipients,
  req,
}) {
  const dispatchBase = {
    factoryId: req.factoryId,
    batchId: createBatchId(`${eventKey}_email`),
    eventKey,
    channel: "email",
    audience: "admin",
    subject: `${definition.title} - ${factory.name}`,
    title: `${definition.title} - ${factory.name}`,
    message: `${definition.title} sent to ${recipients.length} recipient(s).`,
    summary,
    actorId: req.user?.id,
    sentAt: new Date(),
    meta: {
      date: reportDate,
      manual: true,
    },
  };

  const emailRecipients = recipients
    .map((recipient) => ({ email: recipient.email, name: recipient.name }))
    .filter((recipient) => recipient.email);

  if (!emailRecipients.length) {
    const record = await NotificationDispatchModel.create({
      ...dispatchBase,
      recipientEmail: "",
      recipientName: "",
      status: "skipped",
      error: "No email recipients configured",
      previewHtml: "",
      previewText: buildGenericEventText({
        factoryName: factory.name,
        eventTitle: definition.title,
        description: definition.description,
        reportDate,
        summary,
      }),
      recipients: [],
      message: "No email recipients configured.",
    });
    return { status: "skipped", deliveries: [{ status: "skipped", recordId: record._id }] };
  }

  const brevo = pickBrevoSender(factory);
  if (!brevo?.email || !brevo.apiKey) {
    const record = await NotificationDispatchModel.create({
      ...dispatchBase,
      status: "skipped",
      error: "Brevo sender configuration is missing",
      previewHtml: "",
      previewText: buildGenericEventText({
        factoryName: factory.name,
        eventTitle: definition.title,
        description: definition.description,
        reportDate,
        summary,
      }),
      recipients: emailRecipients,
      message: "Brevo sender configuration is missing.",
    });
    return { status: "skipped", deliveries: [{ status: "skipped", recordId: record._id }] };
  }

  const html = buildGenericEventHtml({
    factoryName: factory.name,
    eventTitle: definition.title,
    description: definition.description,
    reportDate,
    recipientLabel: "Admin",
    summary,
  });
  const text = buildGenericEventText({
    factoryName: factory.name,
    eventTitle: definition.title,
    description: definition.description,
    reportDate,
    summary,
  });

  const deliveries = [];
  for (const recipient of emailRecipients) {
    try {
      const result = await sendBrevoEmail({
        apiKey: brevo.apiKey,
        sender: brevo,
        to: recipient.email,
        subject: `${definition.title} - ${factory.name}`,
        html,
        text,
        replyTo: brevo.replyTo || undefined,
      });
      deliveries.push({ recipient: recipient.email, ...result });
      await NotificationDispatchModel.create({
        ...dispatchBase,
        recipientEmail: recipient.email,
        recipientName: recipient.name || "",
        status: "sent",
        error: "",
        previewHtml: html,
        previewText: text,
        recipients: [
          {
            email: recipient.email,
            name: recipient.name || "",
            status: "sent",
            error: "",
          },
        ],
      });
    }
    catch (error) {
      deliveries.push({
        recipient: recipient.email,
        status: "failed",
        reason: error instanceof Error ? error.message : "Brevo send failed",
      });
      await NotificationDispatchModel.create({
        ...dispatchBase,
        recipientEmail: recipient.email,
        recipientName: recipient.name || "",
        status: "failed",
        error: error instanceof Error ? error.message : "Brevo send failed",
        previewHtml: html,
        previewText: text,
        recipients: [
          {
            email: recipient.email,
            name: recipient.name || "",
            status: "failed",
            error: error instanceof Error ? error.message : "Brevo send failed",
          },
        ],
      });
    }
  }

  const dispatchStatus = deliveries.some((item) => item.status === "failed")
    ? "failed"
    : deliveries.some((item) => item.status === "sent")
      ? "sent"
      : "skipped";

  return { status: dispatchStatus, deliveries };
}

function createBatchId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export async function handleGetNotificationSettings(req, res) {
  const factoryId = requireFactoryScope(req, res);
  if (!factoryId) return;

  const settings = await getNotificationSettings(factoryId);
  ok(res, { settings }, "Notification settings loaded");
}

export async function handleUpdateNotificationSettings(req, res) {
  const parsed = notificationSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, "Invalid notification settings payload");
  }

  const factoryId = requireFactoryScope(req, res);
  if (!factoryId) return;

  const settings = await saveNotificationSettings(factoryId, req.user?.id, parsed.data);
  ok(res, { settings }, "Notification settings updated");
}

export async function handleSendDailyUpdate(req, res) {
  const parsed = dailyUpdateSendSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return fail(res, 400, "Invalid daily update payload");
  }

  const factoryId = requireFactoryScope(req, res);
  if (!factoryId) return;

  const date = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(date.getTime())) {
    return fail(res, 400, "Invalid date");
  }

  const result = await sendDailyUpdateEmail(factoryId, req.user?.id, date);
  ok(res, result, "Daily update email processed");
}

export async function handleSendNotificationNow(req, res) {
  const parsed = notificationSendNowSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return fail(res, 400, "Invalid notification send payload");
  }

  const factoryId = requireFactoryScope(req, res);
  if (!factoryId) return;

  const eventKey = String(req.params.eventKey || "").trim();
  if (!eventKey) {
    return fail(res, 400, "Event key is required");
  }

  const [factory, settings] = await Promise.all([
    FactoryModel.findById(factoryId).lean(),
    getNotificationSettings(factoryId),
  ]);

  if (!factory) {
    return fail(res, 404, "Factory not found");
  }

  const definition = settings.definitions.find((item) => item.key === eventKey);
  const event = settings.events?.[eventKey];
  if (!definition || !event) {
    return fail(res, 404, "Notification event not found");
  }

  const requestedChannels = normalizeRequestedChannels(parsed.data, event);
  if (!requestedChannels.length) {
    return fail(res, 400, "No enabled channels selected");
  }

  if (eventKey === "stockAlerts") {
    const result = await sendCurrentStockAlerts({
      factoryId,
      actorId: req.user?.id,
      source: "manual_send_now",
      channelFilter: requestedChannels,
    });
    return ok(res, { channels: requestedChannels, ...result }, "Stock alerts processed");
  }

  if (eventKey === "inventoryMessages") {
    const result = await sendCurrentInventoryMessages({
      factoryId,
      actorId: req.user?.id,
      source: "manual_send_now",
      channelFilter: requestedChannels,
    });
    return ok(res, { channels: requestedChannels, ...result }, "Inventory messages processed");
  }

  if (eventKey === "projectCreated" || eventKey === "projectDelivered") {
    const projectSummary = await buildLatestProjectSummary(factoryId, eventKey);
    if (!projectSummary) {
      return ok(
        res,
        {
          channels: requestedChannels,
          status: "skipped",
          reason: eventKey === "projectDelivered"
            ? "No delivered projects found"
            : "No projects found",
        },
        eventKey === "projectDelivered" ? "Project delivered notification skipped" : "Project created notification skipped",
      );
    }

    const isProjectDelivered = eventKey === "projectDelivered";
    const reportDate = new Date().toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    });
    const summary = {
      "Project code": projectSummary.projectCode || "-",
      "Project name": projectSummary.projectName || "-",
      Customer: projectSummary.customerName || "-",
      Delivery: projectSummary.deliveryDate || "-",
      Amount: projectSummary.amount || 0,
      Status: projectSummary.statusLabel || "-",
      "Created at": projectSummary.createdAt || "-",
    };
    const deliveries = [];

    if (requestedChannels.includes("whatsapp")) {
      const whatsappRecipients = (event.channels?.whatsapp?.recipients ?? [])
        .filter((recipient) => recipient.enabled !== false && String(recipient.phone || "").trim())
        .map((recipient) => ({
          phone: String(recipient.phone || "").trim(),
          name: String(recipient.name || "").trim(),
          countryCode: String(recipient.countryCode || "+91").trim(),
        }));
      const result = await sendNotificationWhatsApp({
        factory,
        definition,
        eventKey,
        settings,
        reportDate,
        summary: projectSummary,
        recipients: whatsappRecipients,
        req,
      });
      deliveries.push({ channel: "whatsapp", ...result });
    }

    if (requestedChannels.includes("email")) {
      const emailRecipients = (event.channels?.email?.recipients ?? [])
        .filter((recipient) => recipient.enabled !== false && String(recipient.email || "").trim())
        .map((recipient) => ({
          email: String(recipient.email || "").trim().toLowerCase(),
          name: String(recipient.name || "").trim(),
        }));
      const result = await sendNotificationEmail({
        factory,
        definition,
        eventKey,
        reportDate,
        summary,
        recipients: emailRecipients,
        req,
      });
      deliveries.push({ channel: "email", ...result });
    }

    const status = deliveries.some((item) => item.status === "failed")
      ? "failed"
      : deliveries.some((item) => item.status === "sent")
        ? "sent"
        : "skipped";

    return ok(
      res,
      { status, channels: requestedChannels, deliveries, project: projectSummary },
      isProjectDelivered ? "Project delivered notification processed" : "Project created notification processed",
    );
  }

  const channel = parsed.data.channel || requestedChannels[0] || "email";
  const reportDate = new Date().toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const channelSummary = {
    "Email enabled": event.channels?.email?.enabled ? "Yes" : "No",
    "WhatsApp enabled": event.channels?.whatsapp?.enabled ? "Yes" : "No",
    "Email recipients": event.channels?.email?.recipients?.length || 0,
    "WhatsApp recipients": event.channels?.whatsapp?.recipients?.length || 0,
  };

  if (requestedChannels.length > 1) {
    const deliveries = [];

    if (eventKey === "dailyUpdates") {
      const dailySummary = await buildDailyUpdateSummary(factoryId, new Date());
      if (requestedChannels.includes("email")) {
        const result = await sendDailyUpdateEmail(factoryId, req.user?.id, new Date());
        deliveries.push({ channel: "email", ...result });
      }
      if (requestedChannels.includes("whatsapp")) {
        const whatsappRecipients = (event.channels?.whatsapp?.recipients ?? [])
          .filter((recipient) => recipient.enabled !== false && String(recipient.phone || "").trim())
          .map((recipient) => ({
            phone: String(recipient.phone || "").trim(),
            name: String(recipient.name || "").trim(),
            countryCode: String(recipient.countryCode || "+91").trim(),
          }));
        const result = await sendNotificationWhatsApp({
          factory,
          definition,
          eventKey,
          settings,
          reportDate,
          summary: dailySummary,
          recipients: whatsappRecipients,
          req,
        });
        deliveries.push({ channel: "whatsapp", ...result });
      }

      const status = deliveries.some((item) => item.status === "failed")
        ? "failed"
        : deliveries.some((item) => item.status === "sent")
          ? "sent"
          : "skipped";
      return ok(res, { status, channels: requestedChannels, deliveries }, "Daily update processed");
    }

    for (const channelName of requestedChannels) {
      if (channelName === "whatsapp") {
        const whatsappRecipients = (event.channels?.whatsapp?.recipients ?? [])
          .filter((recipient) => recipient.enabled !== false && String(recipient.phone || "").trim())
          .map((recipient) => ({
            phone: String(recipient.phone || "").trim(),
            name: String(recipient.name || "").trim(),
            countryCode: String(recipient.countryCode || "+91").trim(),
          }));
        const result = await sendNotificationWhatsApp({
          factory,
          definition,
          eventKey,
          settings,
          reportDate,
          summary: channelSummary,
          recipients: whatsappRecipients,
          req,
        });
        deliveries.push({ channel: "whatsapp", ...result });
      }

      if (channelName === "email") {
        const emailRecipients = (event.channels?.email?.recipients ?? [])
          .filter((recipient) => recipient.enabled !== false && String(recipient.email || "").trim())
          .map((recipient) => ({
            email: String(recipient.email || "").trim().toLowerCase(),
            name: String(recipient.name || "").trim(),
          }));
        const result = await sendNotificationEmail({
          factory,
          definition,
          eventKey,
          reportDate,
          summary: channelSummary,
          recipients: emailRecipients,
          req,
        });
        deliveries.push({ channel: "email", ...result });
      }
    }

    const status = deliveries.some((item) => item.status === "failed")
      ? "failed"
      : deliveries.some((item) => item.status === "sent")
        ? "sent"
        : "skipped";
    return ok(res, { status, channels: requestedChannels, deliveries }, "Notification sent");
  }

  if (eventKey === "dailyUpdates") {
    if (channel === "whatsapp") {
      const whatsappConfig = resolveWhatsAppConfig(factory);
      const template = getWhatsAppTemplate(whatsappConfig, eventKey);
      const recipients = (event.channels?.whatsapp?.recipients ?? [])
        .filter((recipient) => recipient.enabled !== false && String(recipient.phone || "").trim())
        .map((recipient) => ({
          phone: String(recipient.phone || "").trim(),
          name: String(recipient.name || "").trim(),
          countryCode: String(recipient.countryCode || whatsappConfig.countryCode || "+91").trim(),
        }));

      console.log("recipients", recipients);
      console.log("template", template);
      console.log("whatsappConfig", whatsappConfig);

      if (!whatsappConfig.enabled || !whatsappConfig.apiKey || !whatsappConfig.source || !whatsappConfig.srcName) {
        await NotificationDispatchModel.create({
          factoryId,
          batchId: createBatchId(eventKey),
          eventKey,
          channel,
          audience: "admin",
          recipientEmail: "",
          recipientName: "",
          subject: `${definition.title} - ${factory.name}`,
          title: `${definition.title} - ${factory.name}`,
          message: "WhatsApp configuration is missing.",
          previewHtml: "",
          previewText: "",
          summary: {},
          actorId: req.user?.id,
          status: "skipped",
          error: "WhatsApp configuration is missing.",
          recipients: [],
          sentAt: new Date(),
          meta: {
            date: reportDate,
            reason: "WhatsApp configuration is missing",
          },
        });
        return ok(res, { status: "skipped", reason: "WhatsApp configuration is missing" }, "Daily update WhatsApp send skipped");
      }

      const summary = await buildDailyUpdateSummary(factoryId, new Date());
      const context = buildEventContext({
        factory,
        definition,
        eventKey,
        settings,
        reportDate,
        summary,
      });
      const message = template
        ? buildWhatsAppTemplateMessage({ template, context })
        : {
            type: "text",
            message: buildWhatsAppTextMessage({
              template: {
                body: "DAILY WORK SUMMARY\nDate: {{1}}\n\n✅ Projects Worked:  {{2}}\n✅ Projects Created:  {{3}}\n✅ Projects Delivered:  {{4}}\n\nProduction Summary:\nPressing: {{5}} sheets\nCutting: {{6}} sheets\nEdgebanding: {{7}} meters\nBoring: {{8}} holes\n\nThank you.",
                variableMappings: [
                  { schemaField: "reportDate", useDefault: false },
                  { schemaField: "projectsWorked", useDefault: false },
                  { schemaField: "projectsCreatedToday", useDefault: false },
                  { schemaField: "projectsDeliveredToday", useDefault: false },
                  { schemaField: "pressingSheets", useDefault: false },
                  { schemaField: "cuttingSheets", useDefault: false },
                  { schemaField: "edgebandingSheets", useDefault: false },
                  { schemaField: "boringSheets", useDefault: false },
                ],
              },
              context,
            }),
          };
      const previewText = template
        ? buildWhatsAppTextMessage({ template, context })
        : message.message || "";

      const deliveries = [];
      for (const recipient of recipients) {
        const result = await gupshupSendMessage({
          message,
          destination: recipient.phone,
          source: whatsappConfig.source,
          srcName: whatsappConfig.srcName,
          apiKey: whatsappConfig.apiKey,
          countryCode: recipient.countryCode || whatsappConfig.countryCode || "+91",
        });

        deliveries.push({
          recipient: recipient.phone,
          ...result,
        });

        await NotificationDispatchModel.create({
          factoryId,
          batchId: createBatchId(`${eventKey}_whatsapp`),
          eventKey,
          channel,
          audience: "admin",
          recipientEmail: "",
          recipientName: recipient.name || "",
          subject: `${definition.title} - ${factory.name}`,
          title: `${definition.title} - ${factory.name}`,
          message: result.success
            ? `WhatsApp sent to ${recipient.phone}.`
            : `WhatsApp failed for ${recipient.phone}.`,
          previewHtml: "",
          previewText,
          summary,
          actorId: req.user?.id,
          status: result.success ? "sent" : "failed",
          error: result.success ? "" : (result.error?.message || result.error || "WhatsApp send failed"),
          recipients: [
            {
              name: recipient.name || "",
              status: result.success ? "sent" : "failed",
              error: result.success ? "" : (result.error?.message || result.error || "WhatsApp send failed"),
            },
          ],
          sentAt: new Date(),
          meta: {
            date: reportDate,
            templateKey: template?.key || eventKey,
            provider: "gupshup",
          },
        });
      }

      const dispatchStatus = deliveries.some((item) => item.success === false)
        ? "failed"
        : deliveries.length
          ? "sent"
          : "skipped";

      return ok(res, { status: dispatchStatus, deliveries }, "Daily update WhatsApp processed");
    }

    const result = await sendDailyUpdateEmail(factoryId, req.user?.id, new Date());
    return ok(res, result, "Daily update email processed");
  }

  const summary = {
    "Email enabled": event.channels?.email?.enabled ? "Yes" : "No",
    "WhatsApp enabled": event.channels?.whatsapp?.enabled ? "Yes" : "No",
    "Email recipients": event.channels?.email?.recipients?.length || 0,
    "WhatsApp recipients": event.channels?.whatsapp?.recipients?.length || 0,
  };

  const recipients =
    channel === "whatsapp"
      ? (event.channels?.whatsapp?.recipients ?? [])
          .filter((recipient) => recipient.enabled !== false && String(recipient.phone || "").trim())
          .map((recipient) => ({
            name: String(recipient.name || "").trim(),
            phone: String(recipient.phone || "").trim(),
            countryCode: String(recipient.countryCode || "+91").trim(),
          }))
      : (event.channels?.email?.recipients ?? [])
          .filter((recipient) => recipient.enabled !== false && String(recipient.email || "").trim())
          .map((recipient) => ({ name: String(recipient.name || "").trim(), email: String(recipient.email || "").trim().toLowerCase(), status: "sent", error: "" }));

  const dispatchBase = {
    factoryId,
    batchId: createBatchId(eventKey),
    eventKey,
    channel,
    audience: "admin",
    subject: `${definition.title} - ${factory.name}`,
    title: `${definition.title} - ${factory.name}`,
    message: `${definition.title} sent to ${recipients.length} recipient(s).`,
    summary,
    actorId: req.user?.id,
    sentAt: new Date(),
    meta: {
      date: reportDate,
      manual: true,
    },
  };

  if (channel === "whatsapp") {
    const whatsappConfig = resolveWhatsAppConfig(factory);
    const template = getWhatsAppTemplate(whatsappConfig, eventKey);

    console.log("whatsappConfig", whatsappConfig);
    console.log("template", template);

    if (!whatsappConfig.enabled || !whatsappConfig.apiKey || !whatsappConfig.source || !whatsappConfig.srcName) {
      const skipped = await NotificationDispatchModel.create({
        ...dispatchBase,
        recipientEmail: "",
        recipientName: "",
        status: "skipped",
        error: "WhatsApp configuration is missing",
        previewHtml: "",
        previewText: buildGenericEventText({
          factoryName: factory.name,
          eventTitle: definition.title,
          description: definition.description,
          reportDate,
          summary,
        }),
        recipients: [],
      });
      return ok(res, { status: "skipped", recordId: skipped._id }, "WhatsApp configuration is missing");
    }

    if (!recipients.length) {
      const skipped = await NotificationDispatchModel.create({
        ...dispatchBase,
        recipientEmail: "",
        recipientName: "",
        status: "skipped",
        error: "No WhatsApp recipients configured",
        previewHtml: "",
        previewText: buildGenericEventText({
          factoryName: factory.name,
          eventTitle: definition.title,
          description: definition.description,
          reportDate,
          summary,
        }),
        recipients: [],
      });
      return ok(res, { status: "skipped", recordId: skipped._id }, "No WhatsApp recipients configured");
    }

    const context = buildEventContext({
      factory,
      definition,
      eventKey,
      settings,
      reportDate,
      summary,
    });
    const message = template
      ? buildWhatsAppTemplateMessage({ template, context })
      : {
          type: "text",
          message: buildWhatsAppTextMessage({
            template: {
              body: `${definition.title} for {{factory}}`,
              variableMappings: [
                { schemaField: "factory", useDefault: false },
              ],
            },
            context,
          }),
        };
    const previewText = template
      ? buildWhatsAppTextMessage({ template, context })
      : message.message || "";

    const deliveries = [];
    for (const recipient of recipients) {
      const result = await gupshupSendMessage({
        message,
        destination: recipient.phone,
        source: whatsappConfig.source,
        srcName: whatsappConfig.srcName,
        apiKey: whatsappConfig.apiKey,
        countryCode: recipient.countryCode || whatsappConfig.countryCode || "+91",
      });

      deliveries.push({
        recipient: recipient.phone,
        ...result,
      });

      await NotificationDispatchModel.create({
        ...dispatchBase,
        recipientEmail: "",
        recipientName: recipient.name || "",
        status: result.success ? "sent" : "failed",
        error: result.success ? "" : (result.error?.message || result.error || "WhatsApp send failed"),
        previewHtml: "",
        previewText,
        recipients: [
          {
            name: recipient.name || "",
            status: result.success ? "sent" : "failed",
            error: result.success ? "" : (result.error?.message || result.error || "WhatsApp send failed"),
          },
        ],
        meta: {
          ...dispatchBase.meta,
          templateKey: template?.key || eventKey,
          provider: "gupshup",
        },
      });
    }

    const dispatchStatus = deliveries.some((item) => item.success === false)
      ? "failed"
      : deliveries.length
        ? "sent"
        : "skipped";

    return ok(res, { status: dispatchStatus, deliveries }, "WhatsApp notification processed");
  }

  const emailRecipients = recipients
    .map((recipient) => ({ email: recipient.email, name: recipient.name }))
    .filter((recipient) => recipient.email);

  if (!emailRecipients.length) {
    await NotificationDispatchModel.create({
      ...dispatchBase,
      recipientEmail: "",
      recipientName: "",
      status: "skipped",
      error: "No email recipients configured",
      previewHtml: "",
      previewText: buildGenericEventText({
        factoryName: factory.name,
        eventTitle: definition.title,
        description: definition.description,
        reportDate,
        summary,
      }),
      recipients: [],
      message: "No email recipients configured.",
    });
    return ok(res, { status: "skipped" }, "No email recipients configured");
  }

  const brevo = pickBrevoSender(factory);
  console.log("brevo", brevo);
  if (!brevo?.email || !brevo.apiKey) {
    await NotificationDispatchModel.create({
      ...dispatchBase,
      status: "skipped",
      error: "Brevo sender configuration is missing",
      previewHtml: "",
      previewText: buildGenericEventText({
        factoryName: factory.name,
        eventTitle: definition.title,
        description: definition.description,
        reportDate,
        summary,
      }),
      recipients: emailRecipients,
      message: "Brevo sender configuration is missing.",
    });
    return ok(res, { status: "skipped" }, "Brevo sender configuration is missing");
  }

  const html = buildGenericEventHtml({
    factoryName: factory.name,
    eventTitle: definition.title,
    description: definition.description,
    reportDate,
    recipientLabel: "Admin",
    summary,
  });
  const text = buildGenericEventText({
    factoryName: factory.name,
    eventTitle: definition.title,
    description: definition.description,
    reportDate,
    summary,
  });

  const deliveries = [];
  for (const recipient of emailRecipients) {
    try {
      const result = await sendBrevoEmail({
        apiKey: brevo.apiKey,
        sender: brevo,
        to: recipient.email,
        subject: `${definition.title} - ${factory.name}`,
        html,
        text,
        replyTo: brevo.replyTo || undefined,
      });
      deliveries.push({ recipient: recipient.email, ...result });
      await NotificationDispatchModel.create({
        ...dispatchBase,
        recipientEmail: recipient.email,
        recipientName: recipient.name || "",
        status: "sent",
        error: "",
        previewHtml: html,
        previewText: text,
        recipients: [
          {
            email: recipient.email,
            name: recipient.name || "",
            status: "sent",
            error: "",
          },
        ],
      });
    }
    catch (error) {
      deliveries.push({
        recipient: recipient.email,
        status: "failed",
        reason: error instanceof Error ? error.message : "Brevo send failed",
      });
      await NotificationDispatchModel.create({
        ...dispatchBase,
        recipientEmail: recipient.email,
        recipientName: recipient.name || "",
        status: "failed",
        error: error instanceof Error ? error.message : "Brevo send failed",
        previewHtml: html,
        previewText: text,
        recipients: [
          {
            email: recipient.email,
            name: recipient.name || "",
            status: "failed",
            error: error instanceof Error ? error.message : "Brevo send failed",
          },
        ],
      });
    }
  }

  const dispatchStatus = deliveries.some((item) => item.status === "failed")
    ? "failed"
    : deliveries.some((item) => item.status === "sent")
      ? "sent"
      : "skipped";

  return ok(res, { status: dispatchStatus, deliveries }, "Notification sent");
}

export async function handleListNotificationHistory(req, res) {
  const factoryId = requireFactoryScope(req, res);
  if (!factoryId) return;

  const parsed = historyQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return fail(res, 400, "Invalid history query");
  }

  const page = parsed.data.page ?? 1;
  const limit = parsed.data.limit ?? 20;
  const eventKey = parsed.data.eventKey || "";
  const channel = parsed.data.channel || "";
  const status = parsed.data.status || "";
  const search = parsed.data.search || "";

  const filter = { factoryId };
  if (eventKey) filter.eventKey = eventKey;
  if (channel) filter.channel = channel;
  if (status) filter.status = status;
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
    filter.$or = [
      { title: regex },
      { subject: regex },
      { message: regex },
      { "recipients.email": regex },
      { "recipients.name": regex },
      { "recipients.phone": regex },
      { "meta.date": regex },
    ];
  }

  const total = await NotificationDispatchModel.countDocuments(filter);
  const totalPages = total ? Math.ceil(total / limit) : 0;
  const rows = await NotificationDispatchModel.find(filter)
    .sort({ sentAt: -1, createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  ok(res, {
    items: rows,
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
