import { Schema, model } from "mongoose";

const notificationScheduleRunSchema = new Schema(
  {
    factoryId: {
      type: Schema.Types.ObjectId,
      ref: "Factory",
      required: true,
      index: true,
    },
    batchId: { type: String, trim: true, default: "", index: true },
    eventKey: { type: String, trim: true, required: true, index: true },
    scheduleDateKey: { type: String, trim: true, required: true, index: true },
    scheduleDate: { type: String, trim: true, default: "" },
    scheduleTime: { type: String, trim: true, default: "09:00" },
    scheduleTimezone: { type: String, trim: true, default: "GMT+5:30" },
    workingDays: { type: [String], default: [] },
    status: {
      type: String,
      enum: ["scheduled", "sent", "cancelled", "skipped", "failed"],
      default: "scheduled",
      index: true,
    },
    channelResults: { type: Schema.Types.Mixed, default: {} },
    summary: { type: Schema.Types.Mixed, default: {} },
    message: { type: String, default: "" },
    previewText: { type: String, default: "" },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    error: { type: String, trim: true, default: "" },
    sentAt: { type: Date, default: Date.now, index: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

notificationScheduleRunSchema.index({
  factoryId: 1,
  eventKey: 1,
  scheduleDateKey: -1,
});

export const NotificationScheduleRunModel = model(
  "NotificationScheduleRun",
  notificationScheduleRunSchema,
);
