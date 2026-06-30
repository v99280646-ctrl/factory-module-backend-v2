import { Schema, model } from "mongoose";
import { EMPLOYEE_ROLES } from "./membership.model.js";
const serviceSchema = new Schema({
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String },
    category: { type: String },
    price: { type: Number, default: 0, min: 0 },
    duration: { type: Number },
    durationUnit: { type: String, enum: ["hours", "days", "weeks"] },
    employeeRole: { type: String, enum: [...EMPLOYEE_ROLES, null], default: null },
    active: { type: Boolean, default: true },
}, { timestamps: true });
serviceSchema.index({ factoryId: 1, code: 1 }, { unique: true });
export const ServiceModel = model("Service", serviceSchema);
