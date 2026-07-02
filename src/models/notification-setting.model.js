import { Schema, model } from "mongoose";

const notificationRecipientSchema = new Schema(
  {
    id: { type: String, trim: true, default: "" },
    name: { type: String, trim: true, default: "" },
    email: { type: String, trim: true, lowercase: true, default: "" },
    countryCode: { type: String, trim: true, default: "+91" },
    phone: { type: String, trim: true, default: "" },
    enabled: { type: Boolean, default: true },
  },
  { _id: false }
);

const notificationChannelSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    recipients: { type: [notificationRecipientSchema], default: [] },
  },
  { _id: false }
);

const notificationEventScheduleSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    time: { type: String, trim: true, default: "09:00" },
    frequency: { type: String, trim: true, default: "daily" },
    timezone: { type: String, trim: true, default: "GMT+5:30" },
    workingDays: {
      type: [String],
      default: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    },
  },
  { _id: false }
);

const notificationEventSchema = new Schema(
  {
    enabled: { type: Boolean, default: true },
    channels: {
      email: { type: notificationChannelSchema, default: () => ({ enabled: true, recipients: [] }) },
      whatsapp: { type: notificationChannelSchema, default: () => ({ enabled: false, recipients: [] }) },
    },
    schedule: { type: notificationEventScheduleSchema, default: undefined },
  },
  { _id: false }
);

const notificationDefinitionSchema = new Schema(
  {
    key: { type: String, trim: true, required: true },
    title: { type: String, trim: true, required: true },
    description: { type: String, trim: true, default: "" },
    builtIn: { type: Boolean, default: true },
    schedule: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false }
);

const notificationSettingSchema = new Schema(
  {
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, unique: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    channels: {
      email: {
        type: notificationChannelSchema,
        default: () => ({ enabled: true, recipients: [] }),
      },
      whatsapp: {
        type: notificationChannelSchema,
        default: () => ({ enabled: false, recipients: [] }),
      },
    },
    definitions: {
      type: [notificationDefinitionSchema],
      default: [],
    },
    events: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

export const NotificationSettingModel = model("NotificationSetting", notificationSettingSchema);
