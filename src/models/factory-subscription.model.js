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

const subscriptionSnapshotSchema = new Schema(
  {
    key: String,
    name: String,
    description: String,
    price: Number,
    currency: String,
    durationValue: Number,
    durationUnit: String,
    features: { type: [subscriptionFeatureSchema], default: [] },
  },
  { _id: false }
);

const factorySubscriptionSchema = new Schema(
  {
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, index: true },
    planId: { type: Schema.Types.ObjectId, ref: "SubscriptionPlan", required: true, index: true },
    status: {
      type: String,
      enum: ["trial", "active", "past_due", "cancelled", "expired", "superseded"],
      default: "trial",
    },
    billingCycle: { type: String, enum: ["days", "months", "years"], default: "days" },
    currentPeriodStart: { type: Date, default: null },
    currentPeriodEnd: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },
    featureOverrides: { type: [subscriptionFeatureSchema], default: [] },
    planSnapshot: { type: subscriptionSnapshotSchema, default: {} },
    notes: { type: String, default: "" },
    assignedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    isCurrent: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

factorySubscriptionSchema.index({ factoryId: 1, isCurrent: 1 });
factorySubscriptionSchema.index({ factoryId: 1, status: 1 });

export const FactorySubscriptionModel = model("FactorySubscription", factorySubscriptionSchema);
