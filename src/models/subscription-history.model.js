import { Schema, model } from "mongoose";

const subscriptionHistorySchema = new Schema(
  {
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, index: true },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "FactorySubscription", default: null },
    planId: { type: Schema.Types.ObjectId, ref: "SubscriptionPlan", default: null },
    action: {
      type: String,
      enum: ["created", "assigned", "renewed", "upgraded", "downgraded", "cancelled", "expired", "updated"],
      required: true,
    },
    fromStatus: { type: String, default: "" },
    toStatus: { type: String, default: "" },
    note: { type: String, default: "" },
    snapshot: { type: Schema.Types.Mixed, default: {} },
    changedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true }
);

subscriptionHistorySchema.index({ factoryId: 1, createdAt: -1 });

export const SubscriptionHistoryModel = model("SubscriptionHistory", subscriptionHistorySchema);
