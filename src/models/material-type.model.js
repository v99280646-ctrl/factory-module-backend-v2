import { Schema, model } from "mongoose";
const materialTypeSchema = new Schema({
    factoryId: {
        type: Schema.Types.ObjectId,
        ref: "Factory",
        required: true,
        index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    label: { type: String, required: true, trim: true },
    labelKey: { type: String, required: true, trim: true },
    active: { type: Boolean, default: true },
}, { timestamps: true });
materialTypeSchema.index({ factoryId: 1, labelKey: 1 }, { unique: true });
export const MaterialTypeModel = model("MaterialType", materialTypeSchema);
