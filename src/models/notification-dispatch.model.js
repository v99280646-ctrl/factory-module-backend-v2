import { Schema, model } from "mongoose";

const notificationDispatchRecipientSchema = new Schema(
  {
    email: { type: String, trim: true, lowercase: true, default: "" },
    name: { type: String, trim: true, default: "" },
    status: { type: String, enum: ["sent", "skipped", "failed"], default: "sent" },
    error: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const notificationDispatchSchema = new Schema(
  {
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, index: true },
    batchId: { type: String, trim: true, default: "", index: true },
    eventKey: { type: String, trim: true, required: true, index: true },
    channel: { type: String, enum: ["email", "whatsapp"], required: true, index: true },
    audience: { type: String, trim: true, default: "admin" },
    recipientEmail: { type: String, trim: true, lowercase: true, default: "", index: true },
    recipientName: { type: String, trim: true, default: "" },
    subject: { type: String, trim: true, default: "" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    previewHtml: { type: String, default: "" },
    previewText: { type: String, default: "" },
    summary: { type: Schema.Types.Mixed, default: {} },
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: ["sent", "skipped", "failed"], default: "sent", index: true },
    error: { type: String, trim: true, default: "" },
    recipients: { type: [notificationDispatchRecipientSchema], default: [] },
    sentAt: { type: Date, default: Date.now, index: true },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

notificationDispatchSchema.index({ factoryId: 1, eventKey: 1, sentAt: -1 });

export const NotificationDispatchModel = model("NotificationDispatch", notificationDispatchSchema);
