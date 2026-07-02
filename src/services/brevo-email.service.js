import { env } from "../config/env.js";

const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function resolveBrevoSender(brevoConfig = {}) {
  const senders = Array.isArray(brevoConfig.senders) ? brevoConfig.senders : [];
  const defaultSenderId = brevoConfig.defaultSenderId != null ? String(brevoConfig.defaultSenderId) : "";

  const matchedByDefault = senders.find((sender) => String(sender.id) === defaultSenderId && sender.active !== false);
  if (matchedByDefault) {
    return matchedByDefault;
  }

  const firstActive = senders.find((sender) => sender.active !== false);
  if (firstActive) {
    return firstActive;
  }

  const fallbackEmail = normalizeEmail(brevoConfig.senderEmail || brevoConfig.email || "");
  const fallbackName = normalizeText(brevoConfig.senderName || brevoConfig.name || "Factrova");
  if (fallbackEmail) {
    return {
      id: defaultSenderId || "fallback",
      name: fallbackName,
      email: fallbackEmail,
      active: true,
    };
  }

  return null;
}

export function buildBrevoDailyUpdateHtml({ factoryName, summary, reportDate, recipientLabel }) {
  const machineRows = summary.machineBreakdown
    .map(
      (row) => `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">${row.label}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${row.projectsWorked}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${row.totalSheetsWorked}</td>
        </tr>`,
    )
    .join("");

  const lowWorkText = summary.machineBreakdown.length
    ? summary.machineBreakdown.map((row) => `${row.label}: ${row.totalSheetsWorked} sheets`).join(" | ")
    : "No machine usage recorded today";

  return `
    <div style="font-family:Arial,sans-serif;background:#f8fafc;padding:24px;color:#0f172a;">
      <div style="max-width:820px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
        <div style="padding:24px 28px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#fff;">
          <div style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;opacity:.8;">Daily Update</div>
          <h1 style="margin:8px 0 0;font-size:28px;line-height:1.2;">${factoryName}</h1>
          <p style="margin:8px 0 0;opacity:.9;">${reportDate}</p>
        </div>

        <div style="padding:28px;">
          <p style="margin:0 0 16px;font-size:16px;">Hello ${recipientLabel || "team"}, here is your daily work summary.</p>

          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:24px;">
            <div style="border:1px solid #e2e8f0;border-radius:14px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;color:#64748b;">Projects worked</div>
              <div style="margin-top:8px;font-size:30px;font-weight:700;">${summary.projectsWorked}</div>
            </div>
            <div style="border:1px solid #e2e8f0;border-radius:14px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;color:#64748b;">Sheets worked</div>
              <div style="margin-top:8px;font-size:30px;font-weight:700;">${summary.totalSheetsWorked}</div>
            </div>
            <div style="border:1px solid #e2e8f0;border-radius:14px;padding:16px;">
              <div style="font-size:12px;text-transform:uppercase;color:#64748b;">Projects created</div>
              <div style="margin-top:8px;font-size:30px;font-weight:700;">${summary.projectsCreatedToday}</div>
            </div>
          </div>

          <h2 style="margin:0 0 12px;font-size:18px;">Machine summary</h2>
          <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <thead>
              <tr style="background:#f8fafc;">
                <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e2e8f0;">Machine</th>
                <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #e2e8f0;">Projects</th>
                <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #e2e8f0;">Sheets</th>
              </tr>
            </thead>
            <tbody>
              ${machineRows || `<tr><td colspan="3" style="padding:12px;color:#64748b;">No machine usage recorded today.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

export async function sendBrevoEmail({
  apiKey,
  sender,
  to,
  subject,
  html,
  text,
  replyTo,
}) {
  if (!apiKey) {
    return { status: "skipped", reason: "Brevo apiKey is missing" };
  }
  if (!sender?.email) {
    return { status: "skipped", reason: "Brevo sender email is missing" };
  }
  const recipients = Array.isArray(to) ? to : [to];
  const response = await fetch(BREVO_API_URL, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: sender.name || "Factrova",
        email: sender.email,
      },
      to: recipients.map((email) => ({ email: normalizeEmail(email) })).filter((item) => item.email),
      subject,
      htmlContent: html,
      textContent: text,
      ...(replyTo ? { replyTo: { email: normalizeEmail(replyTo) } } : {}),
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || `Brevo returned ${response.status}`);
  }
  return { status: "sent", data: payload };
}

export function resolveBrevoConfig(factory) {
  const brevo = factory?.integrations?.brevo ?? {};
  return {
    apiKey: normalizeText(brevo.apiKey || env.brevoApiKey || ""),
    defaultSenderId: brevo.defaultSenderId ?? env.brevoDefaultSenderId ?? "",
    senders: Array.isArray(brevo.senders) ? brevo.senders : [],
    senderEmail: normalizeText(brevo.senderEmail || env.brevoSenderEmail || ""),
    senderName: normalizeText(brevo.senderName || env.brevoSenderName || ""),
  };
}

export function pickBrevoSender(factory) {
  const config = resolveBrevoConfig(factory);
  const sender = resolveBrevoSender(config);
  if (!sender) {
    return null;
  }
  return {
    ...sender,
    apiKey: config.apiKey,
    replyTo: config.senderEmail || sender.email || "",
  };
}
