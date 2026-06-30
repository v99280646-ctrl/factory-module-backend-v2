import { Schema, model } from "mongoose";
const staffUsageLogSchema = new Schema({
    factoryId: {
        type: Schema.Types.ObjectId,
        ref: "Factory",
        required: true,
        index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    staffName: { type: String, required: true, trim: true },
    staffEmail: { type: String, trim: true, lowercase: true },
    staffRole: { type: String, trim: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project", required: true },
    projectCode: { type: String, required: true, trim: true, uppercase: true },
    projectName: { type: String, required: true, trim: true },
    stageName: { type: String, trim: true },
    note: { type: String, trim: true },
    totalQuantityUsed: { type: Number, default: 0 },
    sourceRecordId: { type: String, required: true, trim: true },
    activityAt: { type: Date, required: true, default: Date.now },
    materials: [
        {
            projectMaterialId: { type: String, trim: true },
            materialName: { type: String, trim: true },
            materialType: { type: String, trim: true },
            thickness: { type: String, trim: true },
            quantityUsed: { type: Number, default: 0 },
            unit: { type: String, trim: true },
        },
    ],
}, { timestamps: true });
staffUsageLogSchema.index({ factoryId: 1, userId: 1, activityAt: -1 });
staffUsageLogSchema.index({ factoryId: 1, sourceRecordId: 1 }, { unique: true });
export const StaffUsageLogModel = model("StaffUsageLog", staffUsageLogSchema);
