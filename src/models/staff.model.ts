import { Schema, model } from "mongoose";
import { PAGE_ACTIONS, PAGE_NAMES } from "./membership.model.js";

const pagePermissionSchema = new Schema(
  PAGE_NAMES.reduce((acc, page) => {
    acc[page] = {
      type: [String],
      enum: PAGE_ACTIONS,
      default: [],
    };
    return acc;
  }, {} as Record<string, any>),
  { _id: false },
);

const staffSchema = new Schema(
  {
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    phone: { type: String },
    role: { type: String, required: true, trim: true },
    pagePermissions: { type: pagePermissionSchema, default: {} },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

staffSchema.index({ factoryId: 1, email: 1 }, { unique: true });

export const StaffModel = model("Staff", staffSchema);
