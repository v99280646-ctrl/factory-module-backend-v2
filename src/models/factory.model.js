import { Schema, model } from "mongoose";
const factorySchema = new Schema({
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    status: { type: String, default: "active", enum: ["active", "inactive", "disabled"] },
    subscriptionStatus: {
        type: String,
        default: "trial",
        enum: ["trial", "active", "past_due", "cancelled", "expired", "superseded"],
    },
    subscriptionPlan: { type: String, default: "trial" },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "FactorySubscription", default: null },
    subscriptionStartedAt: { type: Date, default: null },
    subscriptionEndsAt: { type: Date, default: null },
    subscriptionTrialEndsAt: { type: Date, default: null },
    subscriptionCycle: { type: String, default: "days" },
    adminProfile: { type: Schema.Types.Mixed, default: {} },
    companyProfile: { type: Schema.Types.Mixed, default: {} },
    integrations: { type: Schema.Types.Mixed, default: {} },
}, { timestamps: true });
export const FactoryModel = model("Factory", factorySchema);
