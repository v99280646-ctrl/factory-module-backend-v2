import { NotificationSettingModel } from "../models/notification-setting.model.js";

export const DEFAULT_NOTIFICATION_DEFINITIONS = [
  {
    key: "dailyUpdates",
    title: "Daily updates",
    description: "Send a daily summary of projects, stock, and tasks.",
    builtIn: true,
    schedule: {
      enabled: true,
      time: "09:00",
      frequency: "daily",
      timezone: "GMT+5:30",
    },
  },
  {
    key: "stockAlerts",
    title: "Stock alerts",
    description: "Notify when stock reaches the insufficient level.",
    builtIn: true,
  },
  {
    key: "inventoryMessages",
    title: "Inventory messages",
    description: "Share stock usage, inventory changes, waste notes, and stock reminders.",
    builtIn: true,
    thresholds: [100, 50],
  },
  {
    key: "projectCreated",
    title: "Project created",
    description: "Send when a new project is created.",
    builtIn: true,
  },
  {
    key: "projectDelivered",
    title: "Project delivered",
    description: "Send when a project is completed or delivered.",
    builtIn: true,
  },
];

export const SCHEDULE_WORKING_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function uid() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createRecipient(type = "email") {
  return type === "whatsapp"
    ? { id: uid(), name: "", countryCode: "+91", phone: "", enabled: true }
    : { id: uid(), name: "", email: "", enabled: true };
}

function createEventSettings(definition) {
  const settings = {
    enabled: true,
    channels: {
      email: { enabled: true, recipients: [createRecipient("email")] },
      whatsapp: { enabled: false, recipients: [] },
    },
  };

  if (definition.key === "inventoryMessages") {
    settings.thresholds = Array.isArray(definition.thresholds) && definition.thresholds.length
      ? definition.thresholds.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0)
      : [100, 50];
  }

  if (definition.schedule) {
    settings.schedule = {
      enabled: definition.schedule.enabled !== undefined ? definition.schedule.enabled : true,
      time: definition.schedule.time || "09:00",
      frequency: definition.schedule.frequency || "daily",
      timezone: definition.schedule.timezone || "GMT+5:30",
      workingDays: Array.isArray(definition.schedule.workingDays) && definition.schedule.workingDays.length
        ? definition.schedule.workingDays.filter((day) => SCHEDULE_WORKING_DAYS.includes(day))
        : [...SCHEDULE_WORKING_DAYS],
    };
  }

  return settings;
}

function cloneDefinition(definition) {
  return {
    key: definition.key,
    title: definition.title,
    description: definition.description || "",
    builtIn: definition.builtIn !== false,
    ...(definition.schedule ? { schedule: { ...definition.schedule } } : {}),
  };
}

export function buildDefaultNotificationSettings() {
  const events = {};
  for (const definition of DEFAULT_NOTIFICATION_DEFINITIONS) {
    events[definition.key] = createEventSettings(definition);
  }
  return {
    channels: {
      email: { enabled: true },
      whatsapp: { enabled: false },
    },
    definitions: DEFAULT_NOTIFICATION_DEFINITIONS.map(cloneDefinition),
    events,
  };
}

function normalizeRecipient(type, recipient) {
  if (type === "whatsapp") {
    return {
      id: recipient?.id || uid(),
      name: recipient?.name || "",
      countryCode: recipient?.countryCode || "+91",
      phone: recipient?.phone || "",
      enabled: recipient?.enabled !== false,
    };
  }

  return {
    id: recipient?.id || uid(),
    name: recipient?.name || "",
    email: recipient?.email || "",
    enabled: recipient?.enabled !== false,
  };
}

function normalizeEvent(event = {}, definition = {}) {
  const emailRecipients = Array.isArray(event?.channels?.email?.recipients) && event.channels.email.recipients.length
    ? event.channels.email.recipients.map((recipient) => normalizeRecipient("email", recipient))
    : [createRecipient("email")];
  const whatsappRecipients = Array.isArray(event?.channels?.whatsapp?.recipients)
    ? event.channels.whatsapp.recipients.map((recipient) => normalizeRecipient("whatsapp", recipient))
    : [];

  const normalized = {
    enabled: event.enabled !== false,
    channels: {
      email: {
        enabled: event?.channels?.email?.enabled !== false,
        recipients: emailRecipients,
      },
      whatsapp: {
        enabled: event?.channels?.whatsapp?.enabled === true,
        recipients: whatsappRecipients,
      },
    },
  };

  if (definition.key === "inventoryMessages" || event?.thresholds !== undefined) {
    const nextThresholds = Array.isArray(event?.thresholds) && event.thresholds.length
      ? event.thresholds
      : Array.isArray(definition.thresholds) && definition.thresholds.length
        ? definition.thresholds
        : [100, 50];
    normalized.thresholds = [...new Set(
      nextThresholds
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value >= 0)
    )].sort((a, b) => b - a);
  }

  if (definition.schedule || event.schedule) {
    const fallbackSchedule = definition.schedule || {
      enabled: true,
      time: "09:00",
      frequency: "daily",
      timezone: "GMT+5:30",
      workingDays: [...SCHEDULE_WORKING_DAYS],
    };
    normalized.schedule = {
      enabled: event?.schedule?.enabled !== undefined ? event.schedule.enabled : fallbackSchedule.enabled !== false,
      time: event?.schedule?.time || fallbackSchedule.time || "09:00",
      frequency: event?.schedule?.frequency || fallbackSchedule.frequency || "daily",
      timezone: event?.schedule?.timezone || fallbackSchedule.timezone || "GMT+5:30",
      workingDays: Array.isArray(event?.schedule?.workingDays) && event.schedule.workingDays.length
        ? event.schedule.workingDays.filter((day) => SCHEDULE_WORKING_DAYS.includes(day))
        : [...(fallbackSchedule.workingDays || SCHEDULE_WORKING_DAYS)],
    };
  }

  return normalized;
}

function normalizeDefinitions(definitions = []) {
  const map = new Map();
  for (const definition of [...DEFAULT_NOTIFICATION_DEFINITIONS, ...(definitions || [])]) {
    if (!definition?.key) continue;
    map.set(definition.key, cloneDefinition(definition));
  }
  return [...map.values()];
}

export function normalizeNotificationSettings(input = {}) {
  const defaultSettings = buildDefaultNotificationSettings();
  const definitions = normalizeDefinitions(input.definitions ?? defaultSettings.definitions);
  const eventMap = {};

  for (const definition of definitions) {
    const currentEvent = input?.events?.[definition.key];
    eventMap[definition.key] = normalizeEvent(currentEvent ?? defaultSettings.events[definition.key], definition);
  }

  if (input?.events) {
    for (const [eventKey, eventValue] of Object.entries(input.events)) {
      if (eventMap[eventKey]) continue;
      eventMap[eventKey] = normalizeEvent(eventValue, {});
      if (!definitions.some((definition) => definition.key === eventKey)) {
        definitions.push({
          key: eventKey,
          title: eventKey,
          description: "",
          builtIn: false,
        });
      }
    }
  }

  return {
    channels: {
      email: {
        enabled: input?.channels?.email?.enabled !== undefined ? input.channels.email.enabled : true,
      },
      whatsapp: {
        enabled: input?.channels?.whatsapp?.enabled === true,
      },
    },
    definitions,
    events: eventMap,
  };
}

export async function getNotificationSettings(factoryId) {
  const document = await NotificationSettingModel.findOne({ factoryId }).lean();
  if (!document) {
    return buildDefaultNotificationSettings();
  }
  return normalizeNotificationSettings(document);
}

export async function saveNotificationSettings(factoryId, actorId, input) {
  const settings = normalizeNotificationSettings(input);
  const updated = await NotificationSettingModel.findOneAndUpdate(
    { factoryId },
    {
      $set: {
        ...settings,
        updatedBy: actorId,
      },
      $setOnInsert: {
        factoryId,
        createdBy: actorId,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();

  return normalizeNotificationSettings(updated ?? settings);
}
