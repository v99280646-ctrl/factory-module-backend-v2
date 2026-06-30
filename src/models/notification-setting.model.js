import { Schema, model } from "mongoose";
const notificationSettingSchema = new Schema({
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", default: null, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    audience: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    enabled: { type: Boolean, required: true, default: true },
}, { timestamps: true });
notificationSettingSchema.index({ factoryId: 1, audience: 1, label: 1 }, { unique: true });
export const NotificationSettingModel = model("NotificationSetting", notificationSettingSchema);
