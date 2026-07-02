import { randomUUID } from "crypto";
import { FactoryModel } from "../models/factory.model.js";
import { NotificationDispatchModel } from "../models/notification-dispatch.model.js";
import { getNotificationSettings } from "./notification-settings.service.js";
import { pickBrevoSender, sendBrevoEmail } from "./brevo-email.service.js";
import {
  buildWhatsAppTemplateMessage,
  buildWhatsAppTextMessage,
  gupshupSendMessage,
  getWhatsAppTemplate,
  resolveWhatsAppConfig,
} from "./whatsapp.service.js";

function createBatchId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

function buildProjectSummary(project = {}) {
  const deliveryDate = project.delivery
    ? new Date(project.delivery).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : "-";

  return {
    projectId: String(project._id || project.id || ""),
    projectCode: String(project.code || ""),
    projectName: String(project.name || ""),
    customerName: String(project.customerName || ""),
    deliveryDate,
    amount: Number(project.grandTotal ?? project.amount ?? 0),
    statusLabel: String(project.status || ""),
    createdAt: project.createdAt
      ? new Date(project.createdAt).toLocaleDateString("en-IN", {
          year: "numeric",
          month: "short",
          day: "2-digit",
        })
      : "-",
  };
}

function buildEventContext({ factory, definition, eventKey, summary }) {
  return {
    factory: factory.name,
    factoryName: factory.name,
    eventKey,
    eventTitle: definition.title,
    description: definition.description || "",
    projectName: summary.projectName ?? "",
    projectCode: summary.projectCode ?? "",
    customerName: summary.customerName ?? "",
    deliveryDate: summary.deliveryDate ?? "",
    amount: summary.amount ?? 0,
    statusLabel: summary.statusLabel ?? "",
    name: summary.projectName ?? "",
    status: summary.statusLabel ?? "",
    message: definition.description || definition.title,
  };
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
          <p style="margin:0 0 12px;font-size:16px;">Hello ${recipientLabel || "team"},</p>
          ${description ? `<p style="margin:0 0 20px;color:#475569;">${description}</p>` : ""}
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <tbody>${summaryRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function buildGenericEventText({ factoryName, eventTitle, description, reportDate, summary }) {
  const rows = Object.entries(summary || {}).map(([label, value]) => `${label}: ${value}`);
  return [eventTitle, factoryName, reportDate, description || "", ...rows].filter(Boolean).join("\n");
}

export async function sendProjectLifecycleNotification({
  factoryId,
  actorId = null,
  eventKey,
  project,
}) {
  if (!factoryId || !eventKey || !project) {
    return { status: "skipped", reason: "Missing notification payload" };
  }

  const [factory, settings] = await Promise.all([
    FactoryModel.findById(factoryId).lean(),
    getNotificationSettings(factoryId),
  ]);

  if (!factory) {
    return { status: "skipped", reason: "Factory not found" };
  }

  const definition = settings?.definitions?.find((item) => item.key === eventKey);
  const event = settings?.events?.[eventKey];
  if (!definition || !event?.enabled) {
    return { status: "skipped", reason: "Notification event is disabled" };
  }

  const reportDate = new Date().toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
  const summary = buildProjectSummary(project);
  const displaySummary = {
    "Project code": summary.projectCode || "-",
    "Project name": summary.projectName || "-",
    Customer: summary.customerName || "-",
    Delivery: summary.deliveryDate || "-",
    Amount: summary.amount || 0,
    Status: summary.statusLabel || "-",
    "Created at": summary.createdAt || "-",
  };

  const deliveries = [];
  const emailRecipients = (event.channels?.email?.recipients ?? [])
    .filter((recipient) => recipient.enabled !== false && String(recipient.email || "").trim())
    .map((recipient) => ({
      email: String(recipient.email || "").trim().toLowerCase(),
      name: String(recipient.name || "").trim(),
    }));
  const whatsappRecipients = (event.channels?.whatsapp?.recipients ?? [])
    .filter((recipient) => recipient.enabled !== false && String(recipient.phone || "").trim())
    .map((recipient) => ({
      phone: String(recipient.phone || "").trim(),
      name: String(recipient.name || "").trim(),
      countryCode: String(recipient.countryCode || "+91").trim(),
    }));

  if (emailRecipients.length) {
    const brevo = pickBrevoSender(factory);
    const subject = `${definition.title} - ${factory.name}`;
    const html = buildGenericEventHtml({
      factoryName: factory.name,
      eventTitle: definition.title,
      description: definition.description,
      reportDate,
      recipientLabel: "Admin",
      summary: displaySummary,
    });
    const text = buildGenericEventText({
      factoryName: factory.name,
      eventTitle: definition.title,
      description: definition.description,
      reportDate,
      summary: displaySummary,
    });

    for (const recipient of emailRecipients) {
      const batchId = createBatchId(`${eventKey}_email`);
      if (!brevo?.email || !brevo.apiKey) {
        await NotificationDispatchModel.create({
          factoryId,
          batchId,
          eventKey,
          channel: "email",
          audience: "admin",
          recipientEmail: recipient.email,
          recipientName: recipient.name || "",
          subject,
          title: subject,
          message: "Brevo sender configuration is missing.",
          previewHtml: html,
          previewText: text,
          summary: displaySummary,
          actorId,
          status: "skipped",
          error: "Brevo sender configuration is missing",
          recipients: [{ email: recipient.email, name: recipient.name || "", status: "skipped", error: "Brevo sender configuration is missing" }],
          sentAt: new Date(),
          meta: {
            date: reportDate,
            automatic: true,
            projectId: summary.projectId,
          },
        });
        deliveries.push({ channel: "email", recipient: recipient.email, status: "skipped", reason: "Brevo sender configuration is missing" });
        continue;
      }

      try {
        const result = await sendBrevoEmail({
          apiKey: brevo.apiKey,
          sender: brevo,
          to: recipient.email,
          subject,
          html,
          text,
          replyTo: brevo.replyTo || undefined,
        });
        deliveries.push({ channel: "email", recipient: recipient.email, ...result });
        await NotificationDispatchModel.create({
          factoryId,
          batchId,
          eventKey,
          channel: "email",
          audience: "admin",
          recipientEmail: recipient.email,
          recipientName: recipient.name || "",
          subject,
          title: subject,
          message: text,
          previewHtml: html,
          previewText: text,
          summary: displaySummary,
          actorId,
          status: "sent",
          error: "",
          recipients: [{ email: recipient.email, name: recipient.name || "", status: "sent", error: "" }],
          sentAt: new Date(),
          meta: {
            date: reportDate,
            automatic: true,
            projectId: summary.projectId,
          },
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Brevo send failed";
        deliveries.push({ channel: "email", recipient: recipient.email, status: "failed", reason });
        await NotificationDispatchModel.create({
          factoryId,
          batchId,
          eventKey,
          channel: "email",
          audience: "admin",
          recipientEmail: recipient.email,
          recipientName: recipient.name || "",
          subject,
          title: subject,
          message: text,
          previewHtml: html,
          previewText: text,
          summary: displaySummary,
          actorId,
          status: "failed",
          error: reason,
          recipients: [{ email: recipient.email, name: recipient.name || "", status: "failed", error: reason }],
          sentAt: new Date(),
          meta: {
            date: reportDate,
            automatic: true,
            projectId: summary.projectId,
          },
        });
      }
    }
  }

  if (whatsappRecipients.length) {
    const whatsappConfig = resolveWhatsAppConfig(factory);
    const template = getWhatsAppTemplate(whatsappConfig, eventKey);
    const context = buildEventContext({ factory, definition, eventKey, summary });
    const message = template?.templateId
      ? buildWhatsAppTemplateMessage({ template, context })
      : {
          type: "text",
          message: buildWhatsAppTextMessage({
            template: {
              body: `${definition.title}: {{projectName}}`,
              variableMappings: [{ schemaField: "projectName", useDefault: false }],
            },
            context,
          }),
        };
    const previewText = template?.templateId
      ? buildWhatsAppTextMessage({ template, context })
      : message.message || "";

    for (const recipient of whatsappRecipients) {
      const batchId = createBatchId(`${eventKey}_whatsapp`);
      if (!whatsappConfig.enabled || !whatsappConfig.apiKey || !whatsappConfig.source || !whatsappConfig.srcName) {
        await NotificationDispatchModel.create({
          factoryId,
          batchId,
          eventKey,
          channel: "whatsapp",
          audience: "admin",
          recipientEmail: "",
          recipientName: recipient.name || "",
          subject: `${definition.title} - ${factory.name}`,
          title: `${definition.title} - ${factory.name}`,
          message: "WhatsApp configuration is missing.",
          previewHtml: "",
          previewText,
          summary: displaySummary,
          actorId,
          status: "skipped",
          error: "WhatsApp configuration is missing",
          recipients: [{ name: recipient.name || "", status: "skipped", error: "WhatsApp configuration is missing" }],
          sentAt: new Date(),
          meta: {
            date: reportDate,
            automatic: true,
            projectId: summary.projectId,
            templateKey: template?.key || eventKey,
            provider: "gupshup",
          },
        });
        deliveries.push({ channel: "whatsapp", recipient: recipient.phone, status: "skipped", reason: "WhatsApp configuration is missing" });
        continue;
      }

      const result = await gupshupSendMessage({
        message,
        destination: recipient.phone,
        source: whatsappConfig.source,
        srcName: whatsappConfig.srcName,
        apiKey: whatsappConfig.apiKey,
        countryCode: recipient.countryCode || whatsappConfig.countryCode || "+91",
      });
      deliveries.push({ channel: "whatsapp", recipient: recipient.phone, ...result });
      await NotificationDispatchModel.create({
        factoryId,
        batchId,
        eventKey,
        channel: "whatsapp",
        audience: "admin",
        recipientEmail: "",
        recipientName: recipient.name || "",
        subject: `${definition.title} - ${factory.name}`,
        title: `${definition.title} - ${factory.name}`,
        message: result.success ? `WhatsApp sent to ${recipient.phone}.` : `WhatsApp failed for ${recipient.phone}.`,
        previewHtml: "",
        previewText,
        summary: displaySummary,
        actorId,
        status: result.success ? "sent" : "failed",
        error: result.success ? "" : (result.error?.message || result.error || "WhatsApp send failed"),
        recipients: [{ name: recipient.name || "", status: result.success ? "sent" : "failed", error: result.success ? "" : (result.error?.message || result.error || "WhatsApp send failed") }],
        sentAt: new Date(),
        meta: {
          date: reportDate,
          automatic: true,
          projectId: summary.projectId,
          templateKey: template?.key || eventKey,
          provider: "gupshup",
        },
      });
    }
  }

  const status = deliveries.some((item) => item.status === "failed" || item.success === false)
    ? "failed"
    : deliveries.some((item) => item.status === "sent" || item.success === true)
      ? "sent"
      : "skipped";

  return { status, deliveries, project: summary };
}
