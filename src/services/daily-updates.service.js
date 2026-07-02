import { FactoryModel } from "../models/factory.model.js";
import { NotificationDispatchModel } from "../models/notification-dispatch.model.js";
import { ProjectModel } from "../models/project.model.js";
import { StaffUsageLogModel } from "../models/staff-usage-log.model.js";
import { randomUUID } from "crypto";
import { getNotificationSettings } from "./notification-settings.service.js";
import { buildBrevoDailyUpdateHtml, pickBrevoSender, sendBrevoEmail } from "./brevo-email.service.js";
import {
  buildWhatsAppTemplateMessage,
  buildWhatsAppTextMessage,
  gupshupSendMessage,
  getWhatsAppTemplate,
  resolveWhatsAppConfig,
} from "./whatsapp.service.js";

const MACHINE_LABELS = [
  {
    role: "Pressing Mechine",
    field: "pressingSheets",
  },
  {
    role: "Cutting Mechine",
    field: "cuttingSheets",
  },
  {
    role: "Edge Band Mechine",
    field: "edgebandingSheets",
  },
  {
    role: "Boring Mechine",
    field: "boringSheets",
  },
];

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function normalizeRole(value) {
  return String(value || "").trim().toLowerCase();
}

function countUniqueProjects(entries) {
  return new Set(entries.map((entry) => String(entry.projectId))).size;
}

async function createDispatchRecord(payload) {
  await NotificationDispatchModel.create(payload);
}

function createBatchId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function mergeMeta(baseMeta = {}, extraMeta = {}) {
  return {
    ...baseMeta,
    ...(extraMeta || {}),
  };
}

export async function buildDailyUpdateSummary(factoryId, date = new Date()) {
  const { start, end } = dayBounds(date);
  const [projectRows, usageRows] = await Promise.all([
    ProjectModel.find({
      factoryId,
      createdAt: { $gte: start, $lt: end },
    })
      .select({ _id: 1, status: 1, updatedAt: 1 })
      .lean(),
    StaffUsageLogModel.find({
      factoryId,
      activityAt: { $gte: start, $lt: end },
    }).lean(),
  ]);

  const machineBreakdown = MACHINE_LABELS.map((entry) => {
    const rows = usageRows.filter((row) => normalizeRole(row.staffRole) === normalizeRole(entry.role));
    const totalSheetsWorked = rows.reduce((sum, row) => sum + Number(row.totalQuantityUsed ?? 0), 0);
    return {
      label: entry.role.replace(" Mechine", "").replace("Edge Band", "Edgebanding"),
      entriesCount: rows.length,
      projectsWorked: countUniqueProjects(rows),
      totalSheetsWorked,
      field: entry.field,
    };
  });

  const projectsDeliveredToday = projectRows.filter((project) => {
    if (normalizeRole(project.status) !== "delivered" && normalizeRole(project.status) !== "completed") {
      return false;
    }
    const updatedAt = project.updatedAt ? new Date(project.updatedAt) : null;
    return Boolean(updatedAt && updatedAt >= start && updatedAt < end);
  }).length;

  return {
    reportDate: start.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }),
    projectsCreatedToday: projectRows.length,
    projectsDeliveredToday,
    projectsWorked: new Set(usageRows.map((row) => String(row.projectId))).size,
    totalUsageEntries: usageRows.length,
    totalSheetsWorked: usageRows.reduce((sum, row) => sum + Number(row.totalQuantityUsed ?? 0), 0),
    machineBreakdown,
    pressingSheets: machineBreakdown.find((row) => row.field === "pressingSheets")?.totalSheetsWorked ?? 0,
    cuttingSheets: machineBreakdown.find((row) => row.field === "cuttingSheets")?.totalSheetsWorked ?? 0,
    edgebandingSheets: machineBreakdown.find((row) => row.field === "edgebandingSheets")?.totalSheetsWorked ?? 0,
    boringSheets: machineBreakdown.find((row) => row.field === "boringSheets")?.totalSheetsWorked ?? 0,
  };
}

export async function sendDailyUpdateEmail(factoryId, actorId = null, date = new Date(), options = {}) {
  const [factory, settings] = await Promise.all([
    FactoryModel.findById(factoryId).lean(),
    getNotificationSettings(factoryId),
  ]);
  if (!factory) {
    throw new Error("Factory not found");
  }

  const dailyEvent = settings.events?.dailyUpdates;
  if (!dailyEvent?.enabled) {
    const summary = await buildDailyUpdateSummary(factoryId, date);
    const batchId = createBatchId(options.batchIdPrefix || "dailyUpdates");
    await createDispatchRecord({
      factoryId,
      batchId,
      eventKey: "dailyUpdates",
      channel: "email",
      audience: "admin",
      recipientEmail: "",
      recipientName: "",
      subject: `Daily update - ${factory.name} - ${summary.reportDate}`,
      title: `Daily update - ${factory.name} - ${summary.reportDate}`,
      message: "Daily updates are disabled.",
      previewHtml: "",
      previewText: "",
      summary,
      actorId,
      status: "skipped",
      error: "",
      recipients: [],
      sentAt: new Date(),
      meta: {
        date: summary.reportDate,
        reason: "Daily updates event is disabled",
        ...mergeMeta({}, options.meta),
      },
    });
    return { status: "skipped", reason: "Daily updates event is disabled" };
  }

  const emailRecipients = (dailyEvent.channels?.email?.recipients ?? [])
    .filter((recipient) => recipient.enabled !== false && String(recipient.email || "").trim())
    .map((recipient) => ({
      email: String(recipient.email).trim().toLowerCase(),
      name: String(recipient.name || "").trim(),
    }));

  if (!emailRecipients.length) {
    const summary = await buildDailyUpdateSummary(factoryId, date);
    const batchId = createBatchId(options.batchIdPrefix || "dailyUpdates");
    await createDispatchRecord({
      factoryId,
      batchId,
      eventKey: "dailyUpdates",
      channel: "email",
      audience: "admin",
      recipientEmail: "",
      recipientName: "",
      subject: `Daily update - ${factory.name} - ${summary.reportDate}`,
      title: `Daily update - ${factory.name} - ${summary.reportDate}`,
      message: "No email recipients configured.",
      previewHtml: "",
      previewText: "",
      summary,
      actorId,
      status: "skipped",
      error: "",
      recipients: [],
      sentAt: new Date(),
      meta: {
        date: summary.reportDate,
        reason: "No email recipients configured",
        ...mergeMeta({}, options.meta),
      },
    });
    return { status: "skipped", reason: "No email recipients configured" };
  }

  const brevo = pickBrevoSender(factory);
  if (!brevo?.email || !brevo.apiKey) {
    return { status: "skipped", reason: "Brevo sender configuration is missing" };
  }

  const summary = await buildDailyUpdateSummary(factoryId, date);
  const html = buildBrevoDailyUpdateHtml({
    factoryName: factory.name,
    summary,
    reportDate: summary.reportDate,
    recipientLabel: "Admin",
  });
  const text = [
    `Daily update for ${factory.name}`,
    `Projects worked: ${summary.projectsWorked}`,
    `Projects created today: ${summary.projectsCreatedToday}`,
    `Sheets worked: ${summary.totalSheetsWorked}`,
    ...summary.machineBreakdown.map(
      (row) => `${row.label}: projects ${row.projectsWorked}, sheets ${row.totalSheetsWorked}`,
    ),
  ].join("\n");

  const deliveries = [];
  const batchId = createBatchId("dailyUpdates");
  for (const recipient of emailRecipients) {
    try {
      const result = await sendBrevoEmail({
        apiKey: brevo.apiKey,
        sender: brevo,
        to: recipient.email,
        subject: `Daily update - ${factory.name} - ${summary.reportDate}`,
        html,
        text,
        replyTo: brevo.replyTo || undefined,
      });
      deliveries.push({ recipient: recipient.email, ...result });
      await createDispatchRecord({
        factoryId,
        batchId,
        eventKey: "dailyUpdates",
        channel: "email",
        audience: "admin",
        recipientEmail: recipient.email,
        recipientName: recipient.name || "",
        subject: `Daily update - ${factory.name} - ${summary.reportDate}`,
        title: `Daily update - ${factory.name} - ${summary.reportDate}`,
        message: `Daily update sent to ${recipient.email}.`,
        previewHtml: html,
        previewText: text,
        summary,
        actorId,
        status: "sent",
        error: "",
        recipients: [
          {
            email: recipient.email,
            name: recipient.name || "",
            status: "sent",
            error: "",
          },
        ],
        sentAt: new Date(),
        meta: {
          date: summary.reportDate,
          brevoSender: {
            id: brevo.id || "",
            name: brevo.name || "",
            email: brevo.email || "",
          },
          ...mergeMeta({}, options.meta),
        },
      });
    }
    catch (error) {
      deliveries.push({
        recipient: recipient.email,
        status: "failed",
        reason: error instanceof Error ? error.message : "Brevo send failed",
      });
      await createDispatchRecord({
        factoryId,
        batchId,
        eventKey: "dailyUpdates",
        channel: "email",
        audience: "admin",
        recipientEmail: recipient.email,
        recipientName: recipient.name || "",
        subject: `Daily update - ${factory.name} - ${summary.reportDate}`,
        title: `Daily update - ${factory.name} - ${summary.reportDate}`,
        message: `Daily update failed for ${recipient.email}.`,
        previewHtml: html,
        previewText: text,
        summary,
        actorId,
        status: "failed",
        error: error instanceof Error ? error.message : "Brevo send failed",
        recipients: [
          {
            email: recipient.email,
            name: recipient.name || "",
            status: "failed",
            error: error instanceof Error ? error.message : "Brevo send failed",
          },
        ],
        sentAt: new Date(),
        meta: {
          date: summary.reportDate,
          brevoSender: {
            id: brevo.id || "",
            name: brevo.name || "",
            email: brevo.email || "",
          },
          ...mergeMeta({}, options.meta),
        },
      });
    }
  }

  return {
    status: deliveries.some((item) => item.status === "failed")
      ? "failed"
      : deliveries.some((item) => item.status === "sent")
        ? "sent"
        : "skipped",
    summary,
    deliveries,
    actorId,
  };
}

export async function sendDailyUpdateWhatsApp(factoryId, actorId = null, date = new Date(), options = {}) {
  const [factory, settings] = await Promise.all([
    FactoryModel.findById(factoryId).lean(),
    getNotificationSettings(factoryId),
  ]);
  if (!factory) {
    throw new Error("Factory not found");
  }

  const dailyEvent = settings.events?.dailyUpdates;
  if (!dailyEvent?.enabled) {
    const summary = await buildDailyUpdateSummary(factoryId, date);
    const batchId = createBatchId(options.batchIdPrefix || "dailyUpdates");
    await createDispatchRecord({
      factoryId,
      batchId,
      eventKey: "dailyUpdates",
      channel: "whatsapp",
      audience: "admin",
      recipientEmail: "",
      recipientName: "",
      subject: `Daily update - ${factory.name} - ${summary.reportDate}`,
      title: `Daily update - ${factory.name} - ${summary.reportDate}`,
      message: "Daily updates are disabled.",
      previewHtml: "",
      previewText: "",
      summary,
      actorId,
      status: "skipped",
      error: "",
      recipients: [],
      sentAt: new Date(),
      meta: {
        date: summary.reportDate,
        reason: "Daily updates event is disabled",
        ...mergeMeta({}, options.meta),
      },
    });
    return { status: "skipped", reason: "Daily updates event is disabled" };
  }

  const whatsappConfig = resolveWhatsAppConfig(factory);
  const recipients = (dailyEvent.channels?.whatsapp?.recipients ?? [])
    .filter((recipient) => recipient.enabled !== false && String(recipient.phone || "").trim())
    .map((recipient) => ({
      phone: String(recipient.phone || "").trim(),
      name: String(recipient.name || "").trim(),
      countryCode: String(recipient.countryCode || whatsappConfig.countryCode || "+91").trim(),
    }));

  if (!whatsappConfig.enabled || !whatsappConfig.apiKey || !whatsappConfig.source || !whatsappConfig.srcName) {
    const summary = await buildDailyUpdateSummary(factoryId, date);
    const batchId = createBatchId(options.batchIdPrefix || "dailyUpdates");
    await createDispatchRecord({
      factoryId,
      batchId,
      eventKey: "dailyUpdates",
      channel: "whatsapp",
      audience: "admin",
      recipientEmail: "",
      recipientName: "",
      subject: `Daily update - ${factory.name} - ${summary.reportDate}`,
      title: `Daily update - ${factory.name} - ${summary.reportDate}`,
      message: "WhatsApp configuration is missing.",
      previewHtml: "",
      previewText: "",
      summary,
      actorId,
      status: "skipped",
      error: "WhatsApp configuration is missing.",
      recipients: [],
      sentAt: new Date(),
      meta: {
        date: summary.reportDate,
        reason: "WhatsApp configuration is missing",
        ...mergeMeta({}, options.meta),
      },
    });
    return { status: "skipped", reason: "WhatsApp configuration is missing" };
  }

  const summary = await buildDailyUpdateSummary(factoryId, date);
  const reportDate = summary.reportDate;
  const template = getWhatsAppTemplate(whatsappConfig, "dailyUpdates");
  const context = {
    factory: factory.name,
    factoryName: factory.name,
    reportDate,
    projectsWorked: summary.projectsWorked ?? 0,
    projectsCreatedToday: summary.projectsCreatedToday ?? 0,
    projectsDeliveredToday: summary.projectsDeliveredToday ?? 0,
    totalSheetsWorked: summary.totalSheetsWorked ?? 0,
    pressingSheets: summary.pressingSheets ?? 0,
    cuttingSheets: summary.cuttingSheets ?? 0,
    edgebandingSheets: summary.edgebandingSheets ?? 0,
    boringSheets: summary.boringSheets ?? 0,
  };
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

  if (!recipients.length) {
    const batchId = createBatchId(options.batchIdPrefix || "dailyUpdates");
    await createDispatchRecord({
      factoryId,
      batchId,
      eventKey: "dailyUpdates",
      channel: "whatsapp",
      audience: "admin",
      recipientEmail: "",
      recipientName: "",
      subject: `Daily update - ${factory.name} - ${summary.reportDate}`,
      title: `Daily update - ${factory.name} - ${summary.reportDate}`,
      message: "No WhatsApp recipients configured.",
      previewHtml: "",
      previewText,
      summary,
      actorId,
      status: "skipped",
      error: "",
      recipients: [],
      sentAt: new Date(),
      meta: {
        date: summary.reportDate,
        reason: "No WhatsApp recipients configured",
        ...mergeMeta({}, options.meta),
      },
    });
    return { status: "skipped", reason: "No WhatsApp recipients configured" };
  }

  const deliveries = [];
  const batchId = createBatchId(options.batchIdPrefix || "dailyUpdates");
  for (const recipient of recipients) {
    const result = await gupshupSendMessage({
      message,
      destination: recipient.phone,
      source: whatsappConfig.source,
      srcName: whatsappConfig.srcName,
      apiKey: whatsappConfig.apiKey,
      countryCode: recipient.countryCode || whatsappConfig.countryCode || "+91",
    });

    deliveries.push({ recipient: recipient.phone, ...result });

    await createDispatchRecord({
      factoryId,
      batchId,
      eventKey: "dailyUpdates",
      channel: "whatsapp",
      audience: "admin",
      recipientEmail: "",
      recipientName: recipient.name || "",
      subject: `Daily update - ${factory.name} - ${summary.reportDate}`,
      title: `Daily update - ${factory.name} - ${summary.reportDate}`,
      message: result.success
        ? `WhatsApp sent to ${recipient.phone}.`
        : `WhatsApp failed for ${recipient.phone}.`,
      previewHtml: "",
      previewText,
      summary,
      actorId,
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
        date: summary.reportDate,
        templateKey: template?.key || "dailyUpdates",
        provider: "gupshup",
        ...mergeMeta({}, options.meta),
      },
    });
  }

  const dispatchStatus = deliveries.some((item) => item.success === false)
    ? "failed"
    : deliveries.length
      ? "sent"
      : "skipped";

  return { status: dispatchStatus, summary, deliveries, actorId };
}
