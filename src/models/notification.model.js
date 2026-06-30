import { Schema, model } from "mongoose";
const notificationSchema = new Schema({
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    type: { type: String, enum: ["info", "warning", "error", "success"], default: "info" },
    read: { type: Boolean, default: false },
    readAt: { type: Date },
    actionUrl: { type: String },
    relatedModel: { type: String },
    relatedId: { type: Schema.Types.ObjectId },
}, { timestamps: true });
notificationSchema.index({ factoryId: 1, userId: 1, read: 1 });
export const NotificationModel = model("Notification", notificationSchema);
