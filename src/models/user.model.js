import { Schema, model } from "mongoose";
import { EMPLOYEE_ROLES, PAGE_ACTIONS, PAGE_NAMES, } from "./membership.model.js";
const pagePermissionSchema = new Schema(PAGE_NAMES.reduce((acc, page) => {
    acc[page] = {
        type: [String],
        enum: PAGE_ACTIONS,
        default: [],
    };
    return acc;
}, {}), { _id: false });
const userSchema = new Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String },
    googleId: { type: String, unique: true, sparse: true },
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", default: null, index: true },
    globalRole: {
        type: String,
        enum: ["super_admin", "admin", "staff"],
        default: "staff",
        required: true,
    },
    factoryRole: {
        type: String,
        enum: ["admin", "staff"],
        default: null,
    },
    employeeRole: {
        type: String,
        enum: EMPLOYEE_ROLES,
        default: null,
    },
    phone: { type: String, trim: true, default: "" },
    pagePermissions: { type: pagePermissionSchema, default: {} },
    active: { type: Boolean, default: true },
}, { timestamps: true });
userSchema.index({ factoryId: 1, factoryRole: 1, active: 1 });
export const UserModel = model("User", userSchema);
