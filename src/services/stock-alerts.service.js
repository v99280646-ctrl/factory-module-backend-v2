import { randomUUID } from "crypto";
import { FactoryModel } from "../models/factory.model.js";
import { NotificationDispatchModel } from "../models/notification-dispatch.model.js";
import { ProjectModel } from "../models/project.model.js";
import { StockModel } from "../models/stock.model.js";
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

function normalizeStockLabel(stock = {}) {
  return stock.material || stock.name || stock.type || "Stock item";
}

function normalizeThresholds(values = []) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 0)
  )].sort((a, b) => b - a);
}

function buildRecipients(channelSettings = {}, channel) {
  const recipients = Array.isArray(channelSettings?.recipients) ? channelSettings.recipients : [];
  if (channel === "whatsapp") {
    return recipients
      .filter((recipient) => recipient.enabled !== false && String(recipient.phone || "").trim())
      .map((recipient) => ({
        phone: String(recipient.phone || "").trim(),
        name: String(recipient.name || "").trim(),
        countryCode: String(recipient.countryCode || "+91").trim(),
      }));
  }

  return recipients
    .filter((recipient) => recipient.enabled !== false && String(recipient.email || "").trim())
    .map((recipient) => ({
      email: String(recipient.email || "").trim().toLowerCase(),
      name: String(recipient.name || "").trim(),
    }));
}

function buildEmailHtml({ title, accent, intro, rows, statusLabel = "", statusTone = "#0f172a" }) {
  const renderedRows = rows
    .map(({ label, value, last = false }) =>
      `<tr><td style="padding:10px 12px;${last ? "" : "border-bottom:1px solid #e5e7eb;"}">${label}</td><td style="padding:10px 12px;${last ? "" : "border-bottom:1px solid #e5e7eb;"}text-align:right;">${value}</td></tr>`)
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:720px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <div style="padding:24px 28px;background:${accent};color:#fff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.85;">Inventory Notification</div>
          <h1 style="margin:8px 0 0;font-size:28px;">${title}</h1>
        </div>
        <div style="padding:28px;">
          ${statusLabel ? `<div style="display:inline-block;margin:0 0 16px;padding:8px 12px;border-radius:999px;background:${statusTone};color:#fff;font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">${statusLabel}</div>` : ""}
          <p style="margin:0 0 16px;font-size:16px;">${intro}</p>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <tbody>${renderedRows}</tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function buildEmailText({ title, intro, rows }) {
  return [
    title,
    intro,
    ...rows.map(({ label, value }) => `${label}: ${value}`),
  ].join("\n");
}

function resolveStockStatusLabel({ quantity = 0, minimumRequired = 0, forceStatus = "" }) {
  if (forceStatus) {
    return forceStatus;
  }
  if (quantity < minimumRequired) {
    return "Insufficient";
  }
  return "Low Stock";
}

function resolveStockStatusTone(status) {
  if (status === "Insufficient") {
    return {
      badge: "#b91c1c",
      chipBg: "#fee2e2",
      chipText: "#991b1b",
      icon: "🔴",
    };
  }
  return {
    badge: "#b45309",
    chipBg: "#fef3c7",
    chipText: "#92400e",
    icon: "🟡",
  };
}

function buildStockAlertEmailHtml({ recipientName, factoryName, items = [] }) {
  const safeItems = Array.isArray(items) ? items : [];
  const renderedRows = safeItems.map((item, index) => {
    const status = resolveStockStatusLabel({
      quantity: Number(item.currentStock ?? 0),
      minimumRequired: Number(item.minimumRequired ?? 0),
      forceStatus: item.status || "",
    });
    const tone = resolveStockStatusTone(status);
    return `
      <tr>
        <td style="padding:12px 14px;border-bottom:${index === safeItems.length - 1 ? "0" : "1px solid #e5e7eb"};">${item.materialName || "Material"}</td>
        <td style="padding:12px 14px;text-align:right;border-bottom:${index === safeItems.length - 1 ? "0" : "1px solid #e5e7eb"};">${item.currentStock} ${item.unit || "units"}</td>
        <td style="padding:12px 14px;text-align:right;border-bottom:${index === safeItems.length - 1 ? "0" : "1px solid #e5e7eb"};">${item.minimumRequired} ${item.unit || "units"}</td>
        <td style="padding:12px 14px;border-bottom:${index === safeItems.length - 1 ? "0" : "1px solid #e5e7eb"};">
          <span style="display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:${tone.chipBg};color:${tone.chipText};font-size:12px;font-weight:700;">
            ${tone.icon} ${status}
          </span>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:840px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#7f1d1d,#991b1b);color:#fff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.85;">Stock Alerts</div>
          <h1 style="margin:8px 0 0;font-size:28px;">Immediate stock attention needed</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 16px;font-size:16px;">Dear ${recipientName || "Team"},</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#334155;">
            This is an automated stock alert for <strong>${factoryName}</strong>. The following items have dropped below the minimum required quantity and require immediate attention.
          </p>
          <div style="overflow:hidden;border:1px solid #e2e8f0;border-radius:14px;">
            <table style="width:100%;border-collapse:collapse;">
              <thead style="background:#f8fafc;">
                <tr>
                  <th style="padding:12px 14px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;">Material Name</th>
                  <th style="padding:12px 14px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;">Current Stock</th>
                  <th style="padding:12px 14px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;">Min. Required</th>
                  <th style="padding:12px 14px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;">Status</th>
                </tr>
              </thead>
              <tbody>${renderedRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildStockAlertEmailText({ recipientName, factoryName, items = [] }) {
  const lines = [
    `Dear ${recipientName || "Team"},`,
    "",
    `This is an automated stock alert for ${factoryName}. The following items have dropped below the minimum required quantity and require immediate attention.`,
    "",
    "Material Name | Current Stock | Min. Required | Status",
  ];

  for (const item of items) {
    const status = resolveStockStatusLabel({
      quantity: Number(item.currentStock ?? 0),
      minimumRequired: Number(item.minimumRequired ?? 0),
      forceStatus: item.status || "",
    });
    lines.push(
      `${item.materialName || "Material"} | ${item.currentStock} ${item.unit || "units"} | ${item.minimumRequired} ${item.unit || "units"} | ${status}`,
    );
  }

  return lines.join("\n");
}

function buildInventoryReminderEmailHtml({ recipientName, factoryName, items = [] }) {
  const safeItems = Array.isArray(items) ? items : [];
  const renderedRows = safeItems.map((item, index) => `
      <tr>
        <td style="padding:12px 14px;border-bottom:${index === safeItems.length - 1 ? "0" : "1px solid #e5e7eb"};">${item.materialName || "Material"}</td>
        <td style="padding:12px 14px;text-align:right;border-bottom:${index === safeItems.length - 1 ? "0" : "1px solid #e5e7eb"};">${item.currentStock} ${item.unit || "units"}</td>
        <td style="padding:12px 14px;text-align:right;border-bottom:${index === safeItems.length - 1 ? "0" : "1px solid #e5e7eb"};">${item.thresholdsLabel || "-"}</td>
        <td style="padding:12px 14px;border-bottom:${index === safeItems.length - 1 ? "0" : "1px solid #e5e7eb"};">Inventory reminder</td>
      </tr>
    `).join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:840px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#0f766e,#115e59);color:#fff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.85;">Inventory Messages</div>
          <h1 style="margin:8px 0 0;font-size:28px;">Stock reminder threshold reached</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 16px;font-size:16px;">Dear ${recipientName || "Team"},</p>
          <p style="margin:0 0 18px;font-size:15px;line-height:1.7;color:#334155;">
            This is an inventory reminder for <strong>${factoryName}</strong>. The following materials have reached one or more configured reminder thresholds.
          </p>
          <div style="overflow:hidden;border:1px solid #e2e8f0;border-radius:14px;">
            <table style="width:100%;border-collapse:collapse;">
              <thead style="background:#f8fafc;">
                <tr>
                  <th style="padding:12px 14px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;">Material Name</th>
                  <th style="padding:12px 14px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;">Current Stock</th>
                  <th style="padding:12px 14px;text-align:right;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;">Triggered Thresholds</th>
                  <th style="padding:12px 14px;text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;">Status</th>
                </tr>
              </thead>
              <tbody>${renderedRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function buildInventoryReminderEmailText({ recipientName, factoryName, items = [] }) {
  const lines = [
    `Dear ${recipientName || "Team"},`,
    "",
    `This is an inventory reminder for ${factoryName}. The following materials have reached one or more configured reminder thresholds.`,
    "",
    "Material Name | Current Stock | Triggered Thresholds | Status",
  ];

  for (const item of items) {
    lines.push(
      `${item.materialName || "Material"} | ${item.currentStock} ${item.unit || "units"} | ${item.thresholdsLabel || "-"} | Inventory reminder`,
    );
  }

  return lines.join("\n");
}

async function writeDispatch(payload) {
  return NotificationDispatchModel.create(payload);
}

function buildMaterialsSummary(items = []) {
  return items
    .map((item) => {
      const materialName = item.materialName || "Material";
      const shortageValue = Number(item.remainingRequired ?? item.minimumRequired ?? 0);
      return `${materialName}: ${shortageValue}`;
    })
    .join(", ");
}

async function dispatchEventNotification({
  factoryId,
  stock,
  actorId,
  source,
  eventKey,
  eventSettings,
  title,
  subject,
  html,
  text,
  previewText,
  emailContentFactory,
  summary,
  context,
  templateKey = eventKey,
  channelFilter = null,
}) {
  const [factory] = await Promise.all([
    FactoryModel.findById(factoryId).lean(),
  ]);

  if (!factory) {
    return { status: "skipped", reason: "Factory not found" };
  }

  if (!eventSettings?.enabled) {
    return { status: "skipped", reason: `${eventKey} is disabled` };
  }

  const allowedChannels = Array.isArray(channelFilter) && channelFilter.length
    ? new Set(channelFilter)
    : null;
  const emailRecipients = allowedChannels && !allowedChannels.has("email")
    ? []
    : buildRecipients(eventSettings.channels?.email, "email");
  const whatsappRecipients = allowedChannels && !allowedChannels.has("whatsapp")
    ? []
    : buildRecipients(eventSettings.channels?.whatsapp, "whatsapp");

  if (!emailRecipients.length && !whatsappRecipients.length) {
    return { status: "skipped", reason: "No recipients configured" };
  }

  const deliveries = [];
  const batchId = createBatchId(eventKey);
  const stockId = String(stock?._id || stock?.id || "");
  const quantity = Number(stock?.quantity ?? 0);

  const brevo = pickBrevoSender(factory);
  if (emailRecipients.length) {
    const previewRecipient = emailRecipients[0] || { name: "Team", email: "" };
    const previewContent = emailContentFactory
      ? emailContentFactory(previewRecipient)
      : { html, text };
    if (!brevo?.email || !brevo.apiKey) {
      await writeDispatch({
        factoryId,
        batchId,
        eventKey,
        channel: "email",
        audience: "admin",
        recipientEmail: "",
        recipientName: "",
        subject,
        title,
        message: "Brevo sender configuration is missing.",
        previewHtml: "",
        previewText: previewContent.text,
        summary,
        actorId,
        status: "skipped",
        error: "Brevo sender configuration is missing",
        recipients: emailRecipients,
        sentAt: new Date(),
        meta: {
          source,
          stockId,
          quantity,
        },
      });
      deliveries.push({ channel: "email", status: "skipped", reason: "Brevo sender configuration is missing" });
    } else {
      for (const recipient of emailRecipients) {
        const emailContent = emailContentFactory
          ? emailContentFactory(recipient)
          : { html, text };
        try {
          const result = await sendBrevoEmail({
            apiKey: brevo.apiKey,
            sender: brevo,
            to: recipient.email,
            subject,
            html: emailContent.html,
            text: emailContent.text,
            replyTo: brevo.replyTo || undefined,
          });
          deliveries.push({ channel: "email", recipient: recipient.email, ...result });
          await writeDispatch({
            factoryId,
            batchId,
            eventKey,
            channel: "email",
            audience: "admin",
            recipientEmail: recipient.email,
            recipientName: recipient.name || "",
            subject,
            title,
            message: emailContent.text,
            previewHtml: emailContent.html,
            previewText: emailContent.text,
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
              source,
              stockId,
              quantity,
            },
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Brevo send failed";
          deliveries.push({ channel: "email", recipient: recipient.email, status: "failed", reason });
          await writeDispatch({
            factoryId,
            batchId,
            eventKey,
            channel: "email",
            audience: "admin",
            recipientEmail: recipient.email,
            recipientName: recipient.name || "",
            subject,
            title,
            message: emailContent.text,
            previewHtml: emailContent.html,
            previewText: emailContent.text,
            summary,
            actorId,
            status: "failed",
            error: reason,
            recipients: [
              {
                email: recipient.email,
                name: recipient.name || "",
                status: "failed",
                error: reason,
              },
            ],
            sentAt: new Date(),
            meta: {
              source,
              stockId,
              quantity,
            },
          });
        }
      }
    }
  }

  if (whatsappRecipients.length) {
    const whatsappConfig = resolveWhatsAppConfig(factory);
    const template = getWhatsAppTemplate(whatsappConfig, templateKey);
    const hasTemplate = Boolean(template?.templateId);
    const message = hasTemplate
      ? buildWhatsAppTemplateMessage({ template, context })
      : {
          type: "text",
          message: previewText,
        };
    const fallbackPreviewText = hasTemplate ? buildWhatsAppTextMessage({ template, context }) : previewText;

    if (!whatsappConfig.enabled || !whatsappConfig.apiKey || !whatsappConfig.source || !whatsappConfig.srcName) {
      await writeDispatch({
        factoryId,
        batchId,
        eventKey,
        channel: "whatsapp",
        audience: "admin",
        recipientEmail: "",
        recipientName: "",
        subject,
        title,
        message: "WhatsApp configuration is missing.",
        previewHtml: "",
        previewText: fallbackPreviewText,
        summary,
        actorId,
        status: "skipped",
        error: "WhatsApp configuration is missing",
        recipients: whatsappRecipients,
        sentAt: new Date(),
        meta: {
          source,
          stockId,
          quantity,
          templateKey: template?.key || templateKey,
        },
      });
      deliveries.push({ channel: "whatsapp", status: "skipped", reason: "WhatsApp configuration is missing" });
    } else {
      for (const recipient of whatsappRecipients) {
        const result = await gupshupSendMessage({
          message,
          destination: recipient.phone,
          source: whatsappConfig.source,
          srcName: whatsappConfig.srcName,
          apiKey: whatsappConfig.apiKey,
          countryCode: recipient.countryCode || whatsappConfig.countryCode || "+91",
        });

        deliveries.push({ channel: "whatsapp", recipient: recipient.phone, ...result });
        await writeDispatch({
          factoryId,
          batchId,
          eventKey,
          channel: "whatsapp",
          audience: "admin",
          recipientEmail: "",
          recipientName: recipient.name || "",
          subject,
          title,
          message: fallbackPreviewText,
          previewHtml: "",
          previewText: fallbackPreviewText,
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
            source,
            stockId,
            quantity,
            templateKey: template?.key || templateKey,
          },
        });
      }
    }
  }

  const status = deliveries.some((item) => item.status === "failed" || item.success === false)
    ? "failed"
    : deliveries.some((item) => item.status === "sent" || item.success === true)
      ? "sent"
      : "skipped";

  return { status, deliveries };
}

export async function maybeSendStockAlert({
  factoryId,
  stock,
  previousQuantity = null,
  actorId = null,
  source = "stock_update",
  channelFilter = null,
}) {
  const [factory, settings] = await Promise.all([
    FactoryModel.findById(factoryId).lean(),
    getNotificationSettings(factoryId),
  ]);

  if (!factory) {
    return { status: "skipped", reason: "Factory not found" };
  }

  const event = settings?.events?.stockAlerts;
  if (!event?.enabled) {
    return { status: "skipped", reason: "Stock alerts are disabled" };
  }

  const quantity = Number(stock?.quantity ?? 0);
  const previous = previousQuantity === null || previousQuantity === undefined
    ? null
    : Number(previousQuantity);
  const insufficientLevel = Math.max(0, Number(stock?.reorderLevel ?? 0));
  const crossedInsufficientLevel = previous === null
    ? quantity <= insufficientLevel
    : previous > insufficientLevel && quantity <= insufficientLevel;

  if (!crossedInsufficientLevel) {
    return { status: "skipped", reason: "Insufficient level not reached" };
  }

  const stockLabel = normalizeStockLabel(stock);
  const title = `Insufficient stock - ${factory.name}`;
  const intro = `${stockLabel} has reached the insufficient stock level in ${factory.name}.`;
  const rows = [
    { label: "Factory", value: factory.name },
    { label: "Material name", value: stockLabel },
    { label: "Current stock", value: `${quantity} ${stock.unit || "units"}` },
    { label: "Status", value: resolveStockStatusLabel({ quantity, minimumRequired: insufficientLevel }) },
    { label: "Insufficient level", value: `${insufficientLevel} ${stock.unit || "units"}`, last: true },
  ];
  const stockItems = [
    {
      materialName: stockLabel,
      currentStock: quantity,
      minimumRequired: insufficientLevel,
      unit: stock.unit || "units",
      status: resolveStockStatusLabel({ quantity, minimumRequired: insufficientLevel }),
    },
  ];
  const summary = {
    factoryName: factory.name,
    stockLabel,
    quantity,
    insufficientLevel,
    alertType: "insufficient",
  };
  const materialsSummary = buildMaterialsSummary([
    {
      materialName: stockLabel,
      remainingRequired: insufficientLevel,
    },
  ]);
  const context = {
    factory: factory.name,
    factoryName: factory.name,
    projectName: "Current planning",
    Materials: materialsSummary,
  };

  return dispatchEventNotification({
    factoryId,
    stock,
    actorId,
    source,
    eventKey: "stockAlerts",
    eventSettings: event,
    title,
    subject: title,
    html: buildEmailHtml({
      title: "Insufficient Stock Alert",
      accent: "linear-gradient(135deg,#7f1d1d,#991b1b)",
      intro,
      rows,
      statusLabel: "Insufficient",
      statusTone: "#b91c1c",
    }),
    text: buildEmailText({ title, intro, rows }),
    emailContentFactory: (recipient) => ({
      html: buildStockAlertEmailHtml({
        recipientName: recipient.name || "Team",
        factoryName: factory.name,
        items: stockItems,
      }),
      text: buildStockAlertEmailText({
        recipientName: recipient.name || "Team",
        factoryName: factory.name,
        items: stockItems,
      }),
    }),
    previewText: buildWhatsAppTextMessage({
      template: {
        body: "INSUFFICIENT STOCK\nFactory: {{1}}\nMaterial: {{2}}\nCurrent Stock: {{3}}\nInsufficient Level: {{4}}\nAlert: {{5}}",
        variableMappings: [
          { schemaField: "factory", useDefault: false },
          { schemaField: "material", useDefault: false },
          { schemaField: "quantity", useDefault: false },
          { schemaField: "reorderLevel", useDefault: false },
          { schemaField: "alertType", useDefault: false },
        ],
      },
      context,
    }),
    summary,
    context,
    templateKey: "stockAlerts",
    channelFilter,
  });
}

function resolveMaterialStockKeyFromValues(materialType, thickness) {
  const typeKey = String(materialType || "").trim().toLowerCase();
  const thicknessKey = String(thickness || "").trim().toLowerCase();
  if (!typeKey) {
    return "";
  }
  return `${typeKey}::${thicknessKey}`;
}

function resolveMaterialStockKeyFromStock(stock) {
  return resolveMaterialStockKeyFromValues(stock?.type || stock?.material || "", stock?.thickness || "");
}

function resolveMaterialStockKeyFromProjectMaterial(material, stockById = new Map()) {
  if (material?.stockItemId && stockById.has(String(material.stockItemId))) {
    return resolveMaterialStockKeyFromStock(stockById.get(String(material.stockItemId)));
  }
  return resolveMaterialStockKeyFromValues(material?.materialType || material?.materialName || "", material?.thickness || "");
}

export async function sendProjectInsufficientStockAlert({
  factoryId,
  stock,
  actorId = null,
  source = "project_create",
  shortage = {},
  channelFilter = null,
}) {
  const [factory, settings] = await Promise.all([
    FactoryModel.findById(factoryId).lean(),
    getNotificationSettings(factoryId),
  ]);

  if (!factory) {
    return { status: "skipped", reason: "Factory not found" };
  }

  const event = settings?.events?.stockAlerts;
  if (!event?.enabled) {
    return { status: "skipped", reason: "Stock alerts are disabled" };
  }

  const stockLabel = shortage.materialName || normalizeStockLabel(stock);
  const currentStock = Number(shortage.currentStock ?? stock?.quantity ?? 0);
  const remainingRequired = Number(shortage.remainingRequired ?? 0);
  const projectRequired = Number(shortage.projectRequired ?? 0);
  const totalRequired = Number(shortage.totalRequired ?? 0);
  const totalUsed = Number(shortage.totalUsed ?? 0);
  const title = `Insufficient stock - ${factory.name}`;
  const intro = `${stockLabel} is insufficient for the current project planning in ${factory.name}.`;
  const rows = [
    { label: "Factory", value: factory.name },
    { label: "Material name", value: stockLabel },
    { label: "Current stock", value: `${currentStock} ${stock?.unit || shortage.unit || "units"}` },
    { label: "Project requirement", value: `${projectRequired} ${stock?.unit || shortage.unit || "units"}` },
    { label: "Remaining required", value: `${remainingRequired} ${stock?.unit || shortage.unit || "units"}` },
    { label: "Status", value: "Insufficient" },
    { label: "Total required", value: `${totalRequired} ${stock?.unit || shortage.unit || "units"}` },
    { label: "Already used", value: `${totalUsed} ${stock?.unit || shortage.unit || "units"}`, last: true },
  ];
  const stockItems = [
    {
      materialName: stockLabel,
      currentStock,
      minimumRequired: remainingRequired,
      unit: stock?.unit || shortage.unit || "units",
      status: "Insufficient",
    },
  ];
  const summary = {
    factoryName: factory.name,
    stockLabel,
    quantity: currentStock,
    projectRequired,
    remainingRequired,
    totalRequired,
    totalUsed,
    alertType: "project_insufficient",
    projectId: shortage.projectId || "",
    projectName: shortage.projectName || "",
  };
  const materialsSummary = buildMaterialsSummary([
    {
      materialName: stockLabel,
      remainingRequired,
    },
  ]);
  const context = {
    factory: factory.name,
    factoryName: factory.name,
    projectName: shortage.projectName || "Current planning",
    Materials: materialsSummary,
  };

  return dispatchEventNotification({
    factoryId,
    stock,
    actorId,
    source,
    eventKey: "stockAlerts",
    eventSettings: event,
    title,
    subject: `${title} - ${stockLabel}`,
    html: buildEmailHtml({
      title: "Insufficient Stock Alert",
      accent: "linear-gradient(135deg,#7f1d1d,#991b1b)",
      intro,
      rows,
      statusLabel: "Insufficient",
      statusTone: "#b91c1c",
    }),
    text: buildEmailText({ title, intro, rows }),
    emailContentFactory: (recipient) => ({
      html: buildStockAlertEmailHtml({
        recipientName: recipient.name || "Team",
        factoryName: factory.name,
        items: stockItems,
      }),
      text: buildStockAlertEmailText({
        recipientName: recipient.name || "Team",
        factoryName: factory.name,
        items: stockItems,
      }),
    }),
    previewText: buildWhatsAppTextMessage({
      template: {
        body: "INSUFFICIENT STOCK\nFactory: {{1}}\nMaterial: {{2}}\nCurrent Stock: {{3}}\nRequired: {{4}}\nAlert: {{5}}",
        variableMappings: [
          { schemaField: "factory", useDefault: false },
          { schemaField: "material", useDefault: false },
          { schemaField: "quantity", useDefault: false },
          { schemaField: "reorderLevel", useDefault: false },
          { schemaField: "alertType", useDefault: false },
        ],
      },
      context,
    }),
    summary,
    context,
    templateKey: "stockAlerts",
    channelFilter,
  });
}

export async function maybeSendInventoryMessages({
  factoryId,
  stock,
  previousQuantity = null,
  actorId = null,
  source = "stock_update",
  channelFilter = null,
}) {
  const [factory, settings] = await Promise.all([
    FactoryModel.findById(factoryId).lean(),
    getNotificationSettings(factoryId),
  ]);

  if (!factory) {
    return { status: "skipped", reason: "Factory not found" };
  }

  const event = settings?.events?.inventoryMessages;
  if (!event?.enabled) {
    return { status: "skipped", reason: "Inventory messages are disabled" };
  }

  const thresholds = normalizeThresholds(event.thresholds);
  if (!thresholds.length) {
    return { status: "skipped", reason: "No inventory reminder thresholds configured" };
  }

  const quantity = Number(stock?.quantity ?? 0);
  const previous = previousQuantity === null || previousQuantity === undefined
    ? null
    : Number(previousQuantity);
  const crossedThresholds = thresholds.filter((threshold) =>
    previous === null
      ? quantity <= threshold
      : quantity <= threshold && previous !== quantity
  );

  if (!crossedThresholds.length) {
    return { status: "skipped", reason: "No reminder threshold reached" };
  }

  const results = [];
  for (const threshold of crossedThresholds) {
    const stockLabel = normalizeStockLabel(stock);
    const title = `Inventory reminder - ${factory.name}`;
    const intro = `A stock reminder threshold was reached for ${stockLabel} in ${factory.name}.`;
    const rows = [
      { label: "Factory", value: factory.name },
      { label: "Material", value: stockLabel },
      { label: "Current stock", value: quantity },
      { label: "Triggered threshold", value: threshold, last: true },
    ];
    const summary = {
      factoryName: factory.name,
      stockLabel,
      quantity,
      threshold,
      alertType: "inventory_reminder",
    };
    const context = {
      factory: factory.name,
      factoryName: factory.name,
      materials: `${stockLabel}: ${quantity}`,
    };

    results.push(await dispatchEventNotification({
      factoryId,
      stock,
      actorId,
      source,
      eventKey: "inventoryMessages",
      eventSettings: event,
      title,
      subject: `${title} - ${stockLabel}`,
      html: buildEmailHtml({
        title: "Inventory Reminder",
        accent: "linear-gradient(135deg,#0f766e,#0f766e)",
        intro,
        rows,
      }),
      text: buildEmailText({ title, intro, rows }),
      previewText: buildWhatsAppTextMessage({
        template: {
          body: "INVENTORY REMINDER\nFactory: {{1}}\nMaterial: {{2}}\nCurrent Stock: {{3}}\nThreshold: {{4}}\nNote: {{5}}",
          variableMappings: [
            { schemaField: "factory", useDefault: false },
            { schemaField: "material", useDefault: false },
            { schemaField: "quantity", useDefault: false },
            { schemaField: "threshold", useDefault: false },
            { schemaField: "message", useDefault: false },
          ],
        },
        context,
      }),
      summary,
      context,
      templateKey: "inventoryMessages",
      channelFilter,
    }));
  }

  const status = results.some((result) => result.status === "failed")
    ? "failed"
    : results.some((result) => result.status === "sent")
      ? "sent"
      : "skipped";

  return { status, deliveries: results.flatMap((result) => result.deliveries || []) };
}

export async function maybeSendStockNotifications(options) {
  console.log("maybeSendStockNotifications", options);
  const [stockAlertResult, inventoryResult] = await Promise.all([
    maybeSendStockAlert(options),
    maybeSendInventoryMessages(options),
  ]);

  console.log("maybeSendStockNotifications", stockAlertResult, inventoryResult);

  const status = [stockAlertResult, inventoryResult].some((result) => result.status === "failed")
    ? "failed"
    : [stockAlertResult, inventoryResult].some((result) => result.status === "sent")
      ? "sent"
      : "skipped";

  return {
    status,
    results: {
      stockAlerts: stockAlertResult,
      inventoryMessages: inventoryResult,
    },
  };
}

export async function sendCurrentStockAlerts({
  factoryId,
  actorId = null,
  source = "manual_send_now",
  channelFilter = null,
}) {
  if (!factoryId) {
    return { status: "skipped", reason: "Factory not found" };
  }

  const [stockRows, allProjects] = await Promise.all([
    StockModel.find({ factoryId }).lean(),
    ProjectModel.find({ factoryId }, { name: 1, materials: 1, workflowStages: 1 }).lean(),
  ]);

  if (!stockRows.length) {
    return { status: "skipped", reason: "No stock items found" };
  }

  const stockById = new Map(stockRows.map((stock) => [String(stock._id), stock]));
  const currentStockByKey = new Map();
  const requiredTotals = new Map();
  const usedTotals = new Map();
  const materialSamplesByKey = new Map();

  for (const stock of stockRows) {
    const key = resolveMaterialStockKeyFromStock(stock);
    if (!key) {
      continue;
    }
    currentStockByKey.set(key, (currentStockByKey.get(key) ?? 0) + Number(stock.quantity ?? 0));
    if (!materialSamplesByKey.has(key)) {
      materialSamplesByKey.set(key, {
        stock,
        materialName: stock.material || stock.type || stock.name || "Material",
        unit: stock.unit || "units",
      });
    }
  }

  for (const project of allProjects) {
    for (const material of project?.materials ?? []) {
      const key = resolveMaterialStockKeyFromProjectMaterial(material, stockById);
      if (!key) {
        continue;
      }
      requiredTotals.set(key, (requiredTotals.get(key) ?? 0) + Number(material.quantity ?? 0));
      if (!materialSamplesByKey.has(key)) {
        materialSamplesByKey.set(key, {
          stock: material?.stockItemId ? stockById.get(String(material.stockItemId)) : null,
          materialName: material.materialName || material.materialType || "Material",
          unit: material.unit || "units",
        });
      }
    }

    for (const stage of project?.workflowStages ?? []) {
      for (const stageMaterial of stage?.materials ?? []) {
        const key = resolveMaterialStockKeyFromProjectMaterial(stageMaterial, stockById);
        if (!key) {
          continue;
        }
        usedTotals.set(key, (usedTotals.get(key) ?? 0) + Number(stageMaterial.completedQuantity ?? 0));
      }
    }
  }

  const shortages = [];
  const notifiedKeys = new Set();

  for (const [key, totalRequired] of requiredTotals.entries()) {
    if (!key || notifiedKeys.has(key)) {
      continue;
    }
    notifiedKeys.add(key);

    const currentStock = Number(currentStockByKey.get(key) ?? 0);
    const totalUsed = Number(usedTotals.get(key) ?? 0);
    const requiredQuantity = Number(totalRequired ?? 0);
    if (currentStock >= requiredQuantity) {
      continue;
    }

    const sample = materialSamplesByKey.get(key) || {};
    const stock = sample.stock || stockRows.find((row) => resolveMaterialStockKeyFromStock(row) === key) || null;

    shortages.push({
      stock,
      materialName: sample.materialName || normalizeStockLabel(stock),
      unit: sample.unit || stock?.unit || "units",
      currentStock,
      projectRequired: requiredQuantity,
      remainingRequired: requiredQuantity,
      totalRequired: requiredQuantity,
      totalUsed,
      projectId: "",
      projectName: "",
    });
  }

  if (!shortages.length) {
    return { status: "skipped", reason: "No insufficient stock items found", deliveries: [] };
  }

  const [settings, factory] = await Promise.all([
    getNotificationSettings(factoryId),
    FactoryModel.findById(factoryId).lean(),
  ]);
  const event = settings?.events?.stockAlerts;
  const factoryName = factory?.name || "Factory";
  const firstShortage = shortages[0];
  const representativeStock = firstShortage?.stock || null;
  const summary = {
    factoryName,
    insufficientItemCount: shortages.length,
    totalRequired: shortages.reduce((sum, item) => sum + Number(item.totalRequired ?? 0), 0),
    totalUsed: shortages.reduce((sum, item) => sum + Number(item.totalUsed ?? 0), 0),
    items: shortages.map((item) => ({
      materialName: item.materialName,
      currentStock: item.currentStock,
      remainingRequired: item.remainingRequired,
      totalRequired: item.totalRequired,
      totalUsed: item.totalUsed,
      unit: item.unit,
      status: "Insufficient",
    })),
  };
  const rows = [
    { label: "Insufficient materials", value: shortages.length },
    {
      label: "Materials",
      value: shortages.map((item) => item.materialName).join(", "),
      last: true,
    },
  ];
  const items = shortages.map((item) => ({
    materialName: item.materialName,
    currentStock: item.currentStock,
    minimumRequired: item.remainingRequired,
    unit: item.unit,
    status: "Insufficient",
  }));
  const previewText = [
    "INSUFFICIENT STOCK",
    ...shortages.map((item) =>
      `${item.materialName}: Stock ${item.currentStock} ${item.unit} | Required ${item.totalRequired} ${item.unit}`
    ),
  ].join("\n");

  const result = await dispatchEventNotification({
    factoryId,
    stock: representativeStock,
    actorId,
    source,
    eventKey: "stockAlerts",
    eventSettings: event,
    title: `Insufficient stock alert - ${factoryName}`,
    subject: `Insufficient stock alert - ${factoryName} - ${shortages.length} material(s)`,
    html: buildEmailHtml({
      title: "Insufficient Stock Alert",
      accent: "linear-gradient(135deg,#7f1d1d,#991b1b)",
      intro: "Multiple materials are currently insufficient for the planned project workload.",
      rows,
      statusLabel: "Insufficient",
      statusTone: "#b91c1c",
    }),
    text: previewText,
    emailContentFactory: (recipient) => ({
      html: buildStockAlertEmailHtml({
        recipientName: recipient.name || "Team",
        factoryName,
        items,
      }),
      text: buildStockAlertEmailText({
        recipientName: recipient.name || "Team",
        factoryName,
        items,
      }),
    }),
    previewText,
    summary,
    context: {
      factory: factoryName,
      factoryName,
      projectName: "Current planning",
      Materials: buildMaterialsSummary(shortages),
    },
    templateKey: "stockAlerts",
    channelFilter,
  });

  return {
    ...result,
    shortages: summary.items,
  };
}

export async function sendCurrentInventoryMessages({
  factoryId,
  actorId = null,
  source = "manual_send_now",
  channelFilter = null,
}) {
  if (!factoryId) {
    return { status: "skipped", reason: "Factory not found" };
  }

  const [stockRows, settings, factory] = await Promise.all([
    StockModel.find({ factoryId }).lean(),
    getNotificationSettings(factoryId),
    FactoryModel.findById(factoryId).lean(),
  ]);

  if (!stockRows.length) {
    return { status: "skipped", reason: "No stock items found", deliveries: [] };
  }

  const event = settings?.events?.inventoryMessages;
  if (!event?.enabled) {
    return { status: "skipped", reason: "Inventory messages are disabled", deliveries: [] };
  }

  const thresholds = normalizeThresholds(event.thresholds);
  if (!thresholds.length) {
    return { status: "skipped", reason: "No inventory reminder thresholds configured", deliveries: [] };
  }

  const factoryName = factory?.name || "Factory";
  const matchedItems = stockRows
    .map((stock) => {
      const quantity = Number(stock?.quantity ?? 0);
      const crossedThresholds = thresholds.filter((threshold) => quantity <= threshold);
      if (!crossedThresholds.length) {
        return null;
      }
      return {
        stock,
        materialName: normalizeStockLabel(stock),
        currentStock: quantity,
        unit: stock.unit || "units",
        thresholds: crossedThresholds,
        thresholdsLabel: crossedThresholds.join(", "),
      };
    })
    .filter(Boolean);

  if (!matchedItems.length) {
    return { status: "skipped", reason: "No inventory reminder threshold reached", deliveries: [] };
  }

  const representativeStock = matchedItems[0]?.stock || null;
  const rows = [
    { label: "Reminder materials", value: matchedItems.length },
    {
      label: "Materials",
      value: matchedItems.map((item) => item.materialName).join(", "),
      last: true,
    },
  ];
  const summary = {
    factoryName,
    reminderItemCount: matchedItems.length,
    thresholds,
    items: matchedItems.map((item) => ({
      materialName: item.materialName,
      currentStock: item.currentStock,
      thresholds: item.thresholds,
      thresholdsLabel: item.thresholdsLabel,
      unit: item.unit,
      status: "Inventory reminder",
    })),
  };
  const previewText = [
    "INVENTORY REMINDER",
    ...matchedItems.map((item) =>
      `${item.materialName}: Stock ${item.currentStock} ${item.unit} | Thresholds ${item.thresholdsLabel}`
    ),
  ].join("\n");

  const result = await dispatchEventNotification({
    factoryId,
    stock: representativeStock,
    actorId,
    source,
    eventKey: "inventoryMessages",
    eventSettings: event,
    title: `Inventory reminder - ${factoryName}`,
    subject: `Inventory reminder - ${factoryName} - ${matchedItems.length} material(s)`,
    html: buildEmailHtml({
      title: "Inventory Reminder",
      accent: "linear-gradient(135deg,#0f766e,#115e59)",
      intro: "Multiple materials have reached configured reminder thresholds.",
      rows,
    }),
    text: previewText,
    emailContentFactory: (recipient) => ({
      html: buildInventoryReminderEmailHtml({
        recipientName: recipient.name || "Team",
        factoryName,
        items: matchedItems,
      }),
      text: buildInventoryReminderEmailText({
        recipientName: recipient.name || "Team",
        factoryName,
        items: matchedItems,
      }),
    }),
    previewText,
    summary,
    context: {
      factory: factoryName,
      factoryName,
      materials: matchedItems
        .map((item) => `${item.materialName}: ${item.currentStock}`)
        .join(", "),
    },
    templateKey: "inventoryMessages",
    channelFilter,
  });

  return {
    ...result,
    reminders: summary.items,
  };
}
