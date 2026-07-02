import { randomUUID } from "crypto";
import { FactoryModel } from "../models/factory.model.js";
import { NotificationScheduleRunModel } from "../models/notification-schedule-run.model.js";
import { NotificationSettingModel } from "../models/notification-setting.model.js";
import { getNotificationSettings } from "./notification-settings.service.js";
import {
  sendDailyUpdateEmail,
  sendDailyUpdateWhatsApp,
} from "./daily-updates.service.js";

let schedulerTimer = null;
let schedulerRunning = false;

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
  return {
    hour: Number(hourText),
    minute: Number(minuteText),
  };
}

function buildScheduleRunText({
  factoryName,
  reportDate,
  scheduleTime,
  timezone,
  workingDays,
  channelResults,
  summary,
  status,
}) {
  const enabledDays =
    Array.isArray(workingDays) && workingDays.length
      ? workingDays.join(", ")
      : "all days";
  const channelLines = Object.entries(channelResults || {}).map(
    ([channel, result]) =>
      `${channel}: ${result?.status || "skipped"}${result?.reason ? ` (${result.reason})` : ""}`,
  );
  const summaryLines = summary
    ? [
        `Projects worked: ${summary.projectsWorked ?? 0}`,
        `Sheets worked: ${summary.totalSheetsWorked ?? 0}`,
        `Usage entries: ${summary.totalUsageEntries ?? 0}`,
      ]
    : [];
  return [
    `Scheduled daily update for ${factoryName}`,
    `Status: ${status || "scheduled"}`,
    `Report date: ${reportDate}`,
    `Schedule time: ${scheduleTime} (${timezone})`,
    `Working days: ${enabledDays}`,
    ...channelLines,
    ...summaryLines,
  ]
    .filter(Boolean)
    .join("\n");
}

async function hasScheduleAlreadyRun(factoryId, dateKey) {
  return Boolean(
    await NotificationScheduleRunModel.exists({
      factoryId,
      eventKey: "dailyUpdates",
      scheduleDateKey: dateKey,
    }),
  );
}

async function createScheduleRunRecord({
  factoryId,
  factoryName,
  eventKey,
  dateKey,
  summary,
  schedule,
  channelResults = {},
  status = "scheduled",
  error = "",
  actorId = null,
}) {
  const scheduleDate =
    summary?.reportDate || new Date().toLocaleDateString("en-IN");
  return NotificationScheduleRunModel.create({
    factoryId,
    batchId: `schedule_${eventKey}_${dateKey || randomUUID()}`,
    eventKey,
    scheduleDateKey: dateKey || "",
    scheduleDate,
    scheduleTime: schedule?.time || "09:00",
    scheduleTimezone: schedule?.timezone || "GMT+5:30",
    workingDays: schedule?.workingDays || [],
    status,
    channelResults,
    message: buildScheduleRunText({
      factoryName,
      reportDate: scheduleDate,
      scheduleTime: schedule?.time || "09:00",
      timezone: schedule?.timezone || "GMT+5:30",
      workingDays: schedule?.workingDays || [],
      channelResults,
      summary,
      status,
    }),
    previewText: buildScheduleRunText({
      factoryName,
      reportDate: scheduleDate,
      scheduleTime: schedule?.time || "09:00",
      timezone: schedule?.timezone || "GMT+5:30",
      workingDays: schedule?.workingDays || [],
      channelResults,
      summary,
      status,
    }),
    summary: {
      ...(summary || {}),
      scheduleDate,
      scheduleDateKey: dateKey || "",
      factoryName,
    },
    actorId,
    error,
    sentAt: new Date(),
    meta: {
      trigger: "schedule",
      scheduleDateKey: dateKey || "",
      scheduleTime: schedule?.time || "09:00",
      scheduleTimezone: schedule?.timezone || "GMT+5:30",
      workingDays: schedule?.workingDays || [],
      channelResults,
      status,
    },
  });
}

async function finalizeScheduleRunRecord(
  recordId,
  { factoryName, schedule, summary, channelResults, status, error = "" },
) {
  if (!recordId) return null;
  const scheduleDate =
    summary?.reportDate || new Date().toLocaleDateString("en-IN");
  const payload = {
    status,
    channelResults,
    error,
    message: buildScheduleRunText({
      factoryName,
      reportDate: scheduleDate,
      scheduleTime: schedule?.time || "09:00",
      timezone: schedule?.timezone || "GMT+5:30",
      workingDays: schedule?.workingDays || [],
      channelResults,
      summary,
      status,
    }),
    previewText: buildScheduleRunText({
      factoryName,
      reportDate: scheduleDate,
      scheduleTime: schedule?.time || "09:00",
      timezone: schedule?.timezone || "GMT+5:30",
      workingDays: schedule?.workingDays || [],
      channelResults,
      summary,
      status,
    }),
    summary: {
      ...(summary || {}),
      scheduleDate,
      factoryName,
    },
    meta: {
      trigger: "schedule",
      scheduleDateKey: summary?.scheduleDateKey || "",
      scheduleTime: schedule?.time || "09:00",
      scheduleTimezone: schedule?.timezone || "GMT+5:30",
      workingDays: schedule?.workingDays || [],
      channelResults,
      status,
    },
  };
  return NotificationScheduleRunModel.findByIdAndUpdate(recordId, payload, {
    new: true,
  });
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

async function buildDailyUpdateSummary(factoryId, date) {
  // This function should be imported or defined here
  const { buildDailyUpdateSummary } = await import('./daily-updates.service.js');
  return buildDailyUpdateSummary(factoryId, date);
}

async function runDailyUpdateScheduleTick(now = new Date()) {
  const settingsRows = await NotificationSettingModel.find({
    "events.dailyUpdates.enabled": true,
    "events.dailyUpdates.schedule.enabled": true,
  })
    .select({ factoryId: 1 })
    .lean();

  for (const row of settingsRows) {
    const factoryId = row.factoryId;
    const [factory, settings] = await Promise.all([
      FactoryModel.findById(factoryId).lean(),
      getNotificationSettings(factoryId),
    ]);

    if (!factory || !settings?.events?.dailyUpdates?.enabled) {
      continue;
    }

    const event = settings.events.dailyUpdates;
    if (!event.schedule?.enabled || !isScheduleDue(event.schedule, now)) {
      continue;
    }

    const dateKey = formatDateKey(
      getZonedParts(now, event.schedule.timezone || "GMT+5:30"),
    );
    
    if (await hasScheduleAlreadyRun(factoryId, dateKey)) {
      continue;
    }

    const scheduleMeta = {
      trigger: "schedule",
      scheduleDateKey: dateKey,
      scheduleTime: event.schedule.time || "09:00",
      scheduleTimezone: event.schedule.timezone || "GMT+5:30",
    };

    let summary;
    let runRecord = null;
    try {
      summary = await buildDailyUpdateSummary(factoryId, now);
      
      const channels = [];
      if (event.channels?.email?.enabled) channels.push("email");
      if (event.channels?.whatsapp?.enabled) channels.push("whatsapp");

      runRecord = await createScheduleRunRecord({
        factoryId,
        factoryName: factory.name,
        eventKey: "dailyUpdates",
        dateKey,
        summary,
        schedule: event.schedule,
        channelResults: {},
        status: channels.length ? "scheduled" : "cancelled",
        error: channels.length ? "" : "No channels enabled for this schedule",
        actorId: null,
      });

      if (!channels.length) {
        continue;
      }

      const channelResults = {};
      
      // SEND EMAIL
      if (channels.includes("email")) {
        const startTime = Date.now();
        try {
          const result = await sendDailyUpdateEmail(factoryId, null, now, {
            batchIdPrefix: "dailyUpdates_schedule",
            meta: scheduleMeta,
          });
          channelResults.email = result;
          
          // Log successful send
          console.log(`[${new Date().toISOString()}] ✅ Daily update EMAIL sent successfully for ${factory.name} (${factoryId}) | Time: ${Date.now() - startTime}ms`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Email send failed";
          channelResults.email = {
            status: "failed",
            reason: errorMessage,
          };
          
          // Log failure
          console.error(`[${new Date().toISOString()}] ❌ Daily update EMAIL failed for ${factory.name} (${factoryId}) | Error: ${errorMessage} | Time: ${Date.now() - startTime}ms`);
        }
      }

      // SEND WHATSAPP
      if (event.channels?.whatsapp?.enabled) {
        const startTime = Date.now();
        try {
          const result = await sendDailyUpdateWhatsApp(factoryId, null, now, {
            batchIdPrefix: "dailyUpdates_schedule",
            meta: scheduleMeta,
          });
          channelResults.whatsapp = result;
          
          // Log successful send
          console.log(`[${new Date().toISOString()}] ✅ Daily update WHATSAPP sent successfully for ${factory.name} (${factoryId}) | Time: ${Date.now() - startTime}ms`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "WhatsApp send failed";
          channelResults.whatsapp = {
            status: "failed",
            reason: errorMessage,
          };
          
          // Log failure
          console.error(`[${new Date().toISOString()}] ❌ Daily update WHATSAPP failed for ${factory.name} (${factoryId}) | Error: ${errorMessage} | Time: ${Date.now() - startTime}ms`);
        }
      }

      const status = Object.values(channelResults).some(
        (item) => item?.status === "failed",
      )
        ? "failed"
        : Object.values(channelResults).some((item) => item?.status === "sent")
          ? "sent"
          : "skipped";

      await finalizeScheduleRunRecord(runRecord?._id, {
        factoryName: factory.name,
        schedule: event.schedule,
        summary: {
          ...summary,
          scheduleDateKey: dateKey,
        },
        channelResults,
        status,
        error: status === "failed" ? "One or more channels failed" : "",
      });
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Schedule processing failed";
      
      // Log processing failure
      console.error(`[${new Date().toISOString()}] ❌ Daily update processing failed for ${factory.name} (${factoryId}) | Error: ${errorMessage}`);
      
      await finalizeScheduleRunRecord(runRecord?._id, {
        factoryName: factory.name,
        schedule: event.schedule,
        summary: {
          ...(summary || {}),
          scheduleDateKey: dateKey,
        },
        channelResults: {
          error: {
            status: "failed",
            reason: errorMessage,
          },
        },
        status: "failed",
        error: errorMessage,
      });
    }
  }
}

export function startNotificationScheduler() {
  if (schedulerTimer) {
    return schedulerTimer;
  }

  const tick = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      await runDailyUpdateScheduleTick();
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Notification scheduler tick failed:`, error);
    } finally {
      schedulerRunning = false;
    }
  };

  void tick();
  schedulerTimer = setInterval(() => {
    void tick();
  }, 60_000);

  return schedulerTimer;
}

export function stopNotificationScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}

export async function runNotificationSchedulerOnce(now = new Date()) {
  if (schedulerRunning) return;
  schedulerRunning = true;
  try {
    await runDailyUpdateScheduleTick(now);
  } finally {
    schedulerRunning = false;
  }
}
