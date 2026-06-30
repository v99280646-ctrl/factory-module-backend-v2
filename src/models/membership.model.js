import { Schema, model } from "mongoose";
export const PAGE_ACTIONS = ["view", "add", "edit", "delete", "update"];
export const PAGE_NAMES = [
    "overview",
    "customers",
    "vendors",
    "projects",
    "services",
    "subscriptions",
    "staff",
    "stock",
    "finance",
    "notifications",
    "settings",
];
export const EMPLOYEE_ROLES = [
    "Superviser",
    "Manager",
    "Pressing Mechine",
    "Cutting Mechine",
    "Edge Band Mechine",
    "Boring Mechine",
    "Packing & Delivery",
];
export const DEFAULT_PAGE_PERMISSIONS = Object.fromEntries(PAGE_NAMES.map((page) => [page, ["view"]]));
export const FULL_PAGE_PERMISSIONS = Object.fromEntries(PAGE_NAMES.map((page) => [page, [...PAGE_ACTIONS]]));
const pagePermissionSchema = new Schema(PAGE_NAMES.reduce((acc, page) => {
    acc[page] = {
        type: [String],
        enum: PAGE_ACTIONS,
        default: [],
    };
    return acc;
}, {}), { _id: false });
const membershipSchema = new Schema({
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true },
    role: { type: String, enum: ["admin", "staff"], required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    employeeName: { type: String, trim: true },
    phone: { type: String, trim: true },
    accessLevel: {
        type: String,
        enum: ["view", "edit", "finance", "full"],
        default: "view",
        required: true,
    },
    pagePermissions: { type: pagePermissionSchema, default: {} },
    employeeRole: { type: String, enum: EMPLOYEE_ROLES },
    active: { type: Boolean, default: true },
}, { timestamps: true });
membershipSchema.index({ userId: 1, factoryId: 1 }, { unique: true });
export const MembershipModel = model("Membership", membershipSchema);
