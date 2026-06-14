import { Schema, model, Types } from "mongoose";

export const PAGE_ACTIONS = ["view", "add", "edit", "delete", "update"] as const;
export const PAGE_NAMES = [
  "overview",
  "customers",
  "vendors",
  "projects",
  "services",
  "staff",
  "stock",
  "finance",
  "notifications",
  "settings",
] as const;

export const DEFAULT_PAGE_PERMISSIONS = Object.fromEntries(
  PAGE_NAMES.map((page) => [page, ["view"]]),
) as Record<(typeof PAGE_NAMES)[number], (typeof PAGE_ACTIONS)[number][]>;

export const FULL_PAGE_PERMISSIONS = Object.fromEntries(
  PAGE_NAMES.map((page) => [page, [...PAGE_ACTIONS]]),
) as unknown as Record<(typeof PAGE_NAMES)[number], (typeof PAGE_ACTIONS)[number][]>;

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

const membershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true },
    role: { type: String, enum: ["admin", "staff"], required: true },
    accessLevel: {
      type: String,
      enum: ["view", "edit", "finance", "full"],
      default: "view",
      required: true,
    },
    pagePermissions: { type: pagePermissionSchema, default: {} },
    employeeRole: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

membershipSchema.index({ userId: 1, factoryId: 1 }, { unique: true });

export type PageAction = (typeof PAGE_ACTIONS)[number];
export type PageName = (typeof PAGE_NAMES)[number];
export type PagePermissions = Partial<Record<PageName, PageAction[]>>;

export const MembershipModel = model("Membership", membershipSchema);
export type MembershipDoc = {
  userId: Types.ObjectId;
  factoryId: Types.ObjectId;
  role: "admin" | "staff";
  accessLevel: "view" | "edit" | "finance" | "full";
  pagePermissions: PagePermissions;
  employeeRole?: string;
  active: boolean;
};
