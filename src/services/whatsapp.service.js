import axios from "axios";
import { randomUUID } from "crypto";
import { env } from "../config/env.js";

const GUPSHUP_MESSAGE_URL = "https://api.gupshup.io/wa/api/v1/msg";
const GUPSHUP_TEMPLATE_MESSAGE_URL = "https://api.gupshup.io/wa/api/v1/template/msg";

export const DEFAULT_WHATSAPP_TEMPLATE_DEFINITIONS = [
  {
    key: "dailyUpdates",
    name: "Daily Updates",
    templateId: "64555811-489b-417a-9802-50f3d45682a1",
    language: "en",
    elementName: "factory_daily_updates_2",
    body: "DAILY WORK SUMMARY\nDate:   {{1}}\n\n✅ Projects Worked:  {{2}}\n✅ Projects Created:  {{3}}\n✅ Projects Delivered:   {{4}}\n\nProduction Summary:\nPressing:  {{5}} sheets\nCutting:  {{6}} sheets\nEdgebanding: {{7}} meters\nBoring:  {{8}} holes\n\nThank you.",
    variableMappings: [
      {
        position: 1,
        positionLabel: "1",
        schemaField: "reportDate",
        useDefault: false,
        defaultValue: "",
        fieldInfo: {
          key: "reportDate",
          label: "Date",
          type: "string",
          required: true,
        },
        isCustom: false,
      },
      {
        position: 2,
        positionLabel: "2",
        schemaField: "projectsWorked",
        useDefault: false,
        defaultValue: "",
        fieldInfo: {
          key: "projectsWorked",
          label: "Projects Worked",
          type: "number",
          required: true,
        },
        isCustom: false,
      },
      {
        position: 3,
        positionLabel: "3",
        schemaField: "projectsCreatedToday",
        useDefault: true,
        defaultValue: "0",
        fieldInfo: {
          key: "projectsCreatedToday",
          label: "Projects Created",
          type: "number",
          required: false,
        },
        isCustom: false,
      },
      {
        position: 4,
        positionLabel: "4",
        schemaField: "projectsDeliveredToday",
        useDefault: true,
        defaultValue: "0",
        fieldInfo: {
          key: "projectsDeliveredToday",
          label: "Projects Delivered",
          type: "number",
          required: false,
        },
        isCustom: false,
      },
      {
        position: 5,
        positionLabel: "5",
        schemaField: "pressingSheets",
        useDefault: true,
        defaultValue: "0",
        fieldInfo: {
          key: "pressingSheets",
          label: "Pressing",
          type: "number",
          required: false,
        },
        isCustom: false,
      },
      {
        position: 6,
        positionLabel: "6",
        schemaField: "cuttingSheets",
        useDefault: true,
        defaultValue: "0",
        fieldInfo: {
          key: "cuttingSheets",
          label: "Cutting",
          type: "number",
          required: false,
        },
        isCustom: false,
      },
      {
        position: 7,
        positionLabel: "7",
        schemaField: "edgebandingSheets",
        useDefault: true,
        defaultValue: "0",
        fieldInfo: {
          key: "edgebandingSheets",
          label: "Edgebanding",
          type: "number",
          required: false,
        },
        isCustom: false,
      },
      {
        position: 8,
        positionLabel: "8",
        schemaField: "boringSheets",
        useDefault: true,
        defaultValue: "0",
        fieldInfo: {
          key: "boringSheets",
          label: "Boring",
          type: "number",
          required: false,
        },
        isCustom: false,
      },
    ],
  },
  {
    key: "stockAlerts",
    name: "Stock Alerts",
    templateId: "46a2ad5d-c6ba-4c60-83d5-3f930bfef53b",
    language: "en",
    elementName: "factory_material_shortage_alert",
    body: "Material Shortage Alert\nThe following materials are currently insufficient for the project {{1}}\n\n {{2}}\n\nKindly arrange the required materials",
    variableMappings: [
      {
        position: 1,
        positionLabel: "1",
        schemaField: "projectName",
        useDefault: false,
        defaultValue: "",
        fieldInfo: {
          key: "projectName",
          label: "Project Name",
          type: "string",
          required: true,
        },
        isCustom: false,
      },
      {
        position: 2,
        positionLabel: "2",
        schemaField: "Materials",
        useDefault: true,
        defaultValue: "No insufficient materials",
        fieldInfo: {
          key: "Materials",
          label: "Materials",
          type: "string",
          required: false,
        },
        isCustom: false,
      },
    ],
  },
  {
    key: "inventoryMessages",
    name: "Inventory Messages",
    templateId: "7041cf60-325f-4b67-8f89-772d544c45f1",
    language: "en",
    elementName: "factory_stock_alerts",
    body: "Low Stock Alert\nMaterials are running low in inventory:\n\n {{1}}\n\nPlease arrange replenishment as soon as possible",
    variableMappings: [
      {
        position: 1,
        positionLabel: "1",
        schemaField: "materials",
        useDefault: true,
        defaultValue: "No low stock materials",
        fieldInfo: {
          key: "materials",
          label: "Materials",
          type: "string",
          required: false,
        },
        isCustom: false,
      },
    ],
  },
  {
    key: "projectCreated",
    name: "Project Created",
    templateId: "29f4d0a1-654e-44ba-b283-7225fe1e50ad",
    language: "en",
    elementName: "factory_project_created",
    body: "Project Created\nA new project has been successfully created.\n\nProject Name: {{1}}\n\nThank you",
    variableMappings: [
      {
        position: 1,
        positionLabel: "1",
        schemaField: "name",
        useDefault: false,
        defaultValue: "",
        fieldInfo: {
          key: "name",
          label: "Project Name",
          type: "string",
          required: true,
        },
        isCustom: false,
      },
    ],
  },
  {
    key: "projectDelivered",
    name: "Project Delivered",
    templateId: "34066f63-112b-43bf-b3ba-117bf92a04bc",
    language: "en",
    elementName: "factory_project_delivered",
    body: "Project Delivered\nThe following project has been successfully completed and delivered.\n\nProject Name: {{1}}\nStatus:  {{2}}\n\nThank you",
    variableMappings: [
      {
        position: 1,
        positionLabel: "1",
        schemaField: "name",
        useDefault: false,
        defaultValue: "",
        fieldInfo: {
          key: "name",
          label: "Project Name",
          type: "string",
          required: true,
        },
        isCustom: false,
      },
      {
        position: 2,
        positionLabel: "2",
        schemaField: "status",
        useDefault: false,
        defaultValue: "",
        fieldInfo: {
          key: "status",
          label: "Status",
          type: "string",
          required: false,
        },
        isCustom: false,
      },
    ],
  },
];

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizePhone(value) {
  return normalizeText(value).replace(/[^\d]/g, "");
}

function cloneTemplate(template) {
  return {
    ...template,
    variableMappings: Array.isArray(template.variableMappings)
      ? template.variableMappings.map((mapping) => ({ ...mapping, fieldInfo: { ...(mapping.fieldInfo || {}) } }))
      : [],
  };
}

export function resolveWhatsAppConfig(factory) {
  const integration = factory?.integrations?.whatsapp ?? {};
  const gupshup = integration.gupshup ?? integration;
  const templates = Array.isArray(gupshup.templates) && gupshup.templates.length
    ? gupshup.templates
    : DEFAULT_WHATSAPP_TEMPLATE_DEFINITIONS;

  return {
    enabled: integration.enabled !== false,
    provider: gupshup.provider || "gupshup",
    apiKey: normalizeText(gupshup.apiKey || env.gupshupApiKey || ""),
    source: normalizeText(gupshup.source || env.gupshupSource || ""),
    srcName: normalizeText(gupshup.srcName || env.gupshupSrcName || ""),
    countryCode: normalizeText(gupshup.countryCode || env.gupshupCountryCode || "+91"),
    templates: templates.map(cloneTemplate),
  };
}

export function getWhatsAppTemplate(config, eventKey) {
  return (config?.templates || DEFAULT_WHATSAPP_TEMPLATE_DEFINITIONS).find((template) => template.key === eventKey) || null;
}

export function buildTemplateParams(template, context = {}) {
  return (template?.variableMappings || []).map((mapping) => {
    const rawValue = context?.[mapping.schemaField];
    if (rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== "") {
      return String(rawValue);
    }
    if (mapping.useDefault) {
      return String(mapping.defaultValue ?? "");
    }
    return "";
  });
}

export function buildWhatsAppTemplateMessage({ template, context = {} }) {
  const params = buildTemplateParams(template, context);
  return {
    type: "template",
    templateId: template?.templateId || "",
    elementName: template?.elementName || template?.name || "",
    language: template?.language || "en",
    params,
    variableMappings: template?.variableMappings || [],
    body: template?.body || "",
  };
}

export function buildWhatsAppTextMessage({ template, context = {} }) {
  const params = buildTemplateParams(template, context);
  let text = template?.body || "";
  params.forEach((value, index) => {
    text = text.replaceAll(`{{${index + 1}}}`, value);
  });
  return text || params.filter(Boolean).join(" ");
}

export async function gupshupSendMessage({
  message,
  destination,
  source,
  srcName,
  apiKey,
  countryCode = "+91",
}) {
  try {
    console.log(`Sending WhatsApp message: ${JSON.stringify(message)}`);
    if (!message || !message.type) {
      throw new Error("Invalid message data: type is required.");
    }

    if (!destination) {
      throw new Error("Destination phone number is required.");
    }

    const rawDestination = String(destination || "").trim();
    if (rawDestination.startsWith("+") && !rawDestination.startsWith("+91")) {
      throw new Error("WhatsApp sending is allowed only for India numbers (+91).");
    }

    const cleanCode = normalizePhone(countryCode).replace(/^0+/, "") || "91";
    if (cleanCode !== "91") {
      throw new Error("WhatsApp sending is allowed only for India numbers (+91).");
    }

    const cleanNumber = normalizePhone(destination).replace(/^0+/, "");
    const phoneNumber = `${cleanCode}${cleanNumber}`;

    if (message.type === "template") {
      if (!message.templateId) {
        throw new Error("Template message requires a templateId.");
      }

      const encodedParams = new URLSearchParams();
      encodedParams.set("source", source);
      encodedParams.set("destination", phoneNumber);
      encodedParams.set("src.name", srcName);
      encodedParams.set("template", JSON.stringify({
        id: message.templateId,
        params: Array.isArray(message.params) ? message.params : [],
      }));

      if (message.messagePayload && typeof message.messagePayload === "object") {
        encodedParams.set("message", JSON.stringify(message.messagePayload));
      }

      const response = await axios.request({
        method: "POST",
        url: GUPSHUP_TEMPLATE_MESSAGE_URL,
        headers: {
          accept: "application/json",
          apikey: apiKey,
          "content-type": "application/x-www-form-urlencoded",
        },
        data: encodedParams,
      });

      return { success: true, data: response.data, status: response.status };
    }

    let messageData = null;
    switch (message.type) {
      case "text":
        messageData = {
          type: "text",
          text: message.message,
        };
        break;
      case "audio":
        messageData = {
          type: "audio",
          url: message.url,
        };
        break;
      case "image": {
        const mediaUrl = normalizeText(message.url || message.originalUrl || message.previewUrl);
        if (!mediaUrl) {
          throw new Error("Image message requires a valid media URL.");
        }
        messageData = {
          type: "image",
          originalUrl: mediaUrl,
          previewUrl: mediaUrl,
          caption: message.caption,
        };
        break;
      }
      case "video": {
        const mediaUrl = normalizeText(message.url || message.originalUrl || message.previewUrl);
        if (!mediaUrl) {
          throw new Error("Video message requires a valid media URL.");
        }
        messageData = {
          type: "video",
          url: mediaUrl,
          caption: message.caption,
        };
        break;
      }
      case "file":
      case "document": {
        const fileUrl = normalizeText(message?.url);
        if (!fileUrl) {
          throw new Error("Document message requires a valid file URL.");
        }
        messageData = {
          type: "file",
          url: fileUrl,
          filename: message.filename || "",
          caption: message.caption,
        };
        break;
      }
      default:
        throw new Error(`Unsupported message type: ${message.type}`);
    }

    const encodedParams = new URLSearchParams();
    encodedParams.set("message", JSON.stringify(messageData));
    encodedParams.set("source", source);
    encodedParams.set("destination", phoneNumber);
    encodedParams.set("src.name", srcName);

    const response = await axios.request({
      method: "POST",
      url: GUPSHUP_MESSAGE_URL,
      headers: {
        accept: "application/json",
        apikey: apiKey,
        "content-type": "application/x-www-form-urlencoded",
      },
      data: encodedParams,
    });

    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status || 500,
    };
  }
}
