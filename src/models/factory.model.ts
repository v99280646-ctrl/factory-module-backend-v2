import { Schema, model } from "mongoose";

const factorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    status: { type: String, default: "active", enum: ["active", "inactive", "disabled"] },
    subscriptionStatus: {
      type: String,
      default: "trial",
      enum: ["trial", "active", "past_due", "cancelled"],
    },
    subscriptionPlan: { type: String, default: "trial" },
    adminProfile: { type: Schema.Types.Mixed, default: {} },
    companyProfile: { type: Schema.Types.Mixed, default: {} },
    integrations: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export const FactoryModel = model("Factory", factorySchema);
