import { Schema, model } from "mongoose";

const subscriptionFeatureSchema = new Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    mode: { type: String, enum: ["enabled", "limited", "unlimited", "disabled"], default: "enabled" },
    limit: { type: Number, default: null },
    unit: { type: String, default: "" },
    description: { type: String, default: "" },
  },
  { _id: false }
);

const subscriptionPlanSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
    isDefault: { type: Boolean, default: false },
    price: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    durationValue: { type: Number, default: 3, min: 1 },
    durationUnit: { type: String, enum: ["days", "months", "years"], default: "days" },
    features: { type: [subscriptionFeatureSchema], default: [] },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });

export const SubscriptionPlanModel = model("SubscriptionPlan", subscriptionPlanSchema);

export const DEFAULT_SUBSCRIPTION_PLANS = [
  {
    key: "trial",
    name: "Trial",
    description: "Short trial access for new factories.",
    isDefault: true,
    price: 0,
    durationValue: 3,
    durationUnit: "days",
    features: [
      { key: "projects", label: "Projects", mode: "limited", limit: 3, unit: "projects", enabled: true },
      { key: "customers", label: "Customers", mode: "limited", limit: 10, unit: "customers", enabled: true },
      { key: "vendors", label: "Vendors", mode: "limited", limit: 5, unit: "vendors", enabled: true },
      { key: "services", label: "Services", mode: "limited", limit: 5, unit: "services", enabled: true },
      { key: "staff", label: "Staff members", mode: "limited", limit: 3, unit: "users", enabled: true },
      { key: "stock", label: "Stock", mode: "limited", limit: 20, unit: "items", enabled: true },
      { key: "finance", label: "Finance", mode: "disabled", limit: 0, unit: "", enabled: false },
    ],
    sortOrder: 10,
  },
  {
    key: "starter",
    name: "Starter",
    description: "Basic daily operations for small factories.",
    price: 999,
    durationValue: 1,
    durationUnit: "months",
    features: [
      { key: "projects", label: "Projects", mode: "limited", limit: 25, unit: "projects", enabled: true },
      { key: "customers", label: "Customers", mode: "limited", limit: 100, unit: "customers", enabled: true },
      { key: "vendors", label: "Vendors", mode: "limited", limit: 50, unit: "vendors", enabled: true },
      { key: "services", label: "Services", mode: "limited", limit: 25, unit: "services", enabled: true },
      { key: "staff", label: "Staff members", mode: "limited", limit: 10, unit: "users", enabled: true },
      { key: "stock", label: "Stock", mode: "limited", limit: 100, unit: "items", enabled: true },
      { key: "finance", label: "Finance", mode: "enabled", limit: null, unit: "", enabled: true },
    ],
    sortOrder: 20,
  },
  {
    key: "growth",
    name: "Growth",
    description: "For expanding factories with more automation.",
    price: 2499,
    durationValue: 1,
    durationUnit: "months",
    features: [
      { key: "projects", label: "Projects", mode: "limited", limit: 250, unit: "projects", enabled: true },
      { key: "customers", label: "Customers", mode: "limited", limit: 500, unit: "customers", enabled: true },
      { key: "vendors", label: "Vendors", mode: "limited", limit: 200, unit: "vendors", enabled: true },
      { key: "services", label: "Services", mode: "limited", limit: 100, unit: "services", enabled: true },
      { key: "staff", label: "Staff members", mode: "limited", limit: 50, unit: "users", enabled: true },
      { key: "stock", label: "Stock", mode: "unlimited", limit: null, unit: "items", enabled: true },
      { key: "finance", label: "Finance", mode: "enabled", limit: null, unit: "", enabled: true },
      { key: "notifications", label: "Notifications", mode: "enabled", limit: null, unit: "", enabled: true },
    ],
    sortOrder: 30,
  },
  {
    key: "enterprise",
    name: "Enterprise",
    description: "Unlimited factory operations and premium controls.",
    price: 6999,
    durationValue: 1,
    durationUnit: "years",
    features: [
      { key: "projects", label: "Projects", mode: "unlimited", limit: null, unit: "projects", enabled: true },
      { key: "customers", label: "Customers", mode: "unlimited", limit: null, unit: "customers", enabled: true },
      { key: "vendors", label: "Vendors", mode: "unlimited", limit: null, unit: "vendors", enabled: true },
      { key: "services", label: "Services", mode: "unlimited", limit: null, unit: "services", enabled: true },
      { key: "staff", label: "Staff members", mode: "unlimited", limit: null, unit: "users", enabled: true },
      { key: "stock", label: "Stock", mode: "unlimited", limit: null, unit: "items", enabled: true },
      { key: "finance", label: "Finance", mode: "enabled", limit: null, unit: "", enabled: true },
      { key: "notifications", label: "Notifications", mode: "enabled", limit: null, unit: "", enabled: true },
      { key: "integrations", label: "Integrations", mode: "enabled", limit: null, unit: "", enabled: true },
    ],
    sortOrder: 40,
  },
];
