import { Schema, model } from "mongoose";
const wasteMaterialSchema = new Schema({
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    code: { type: String, required: true, trim: true, uppercase: true },
    material: { type: String, required: true, trim: true },
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
    projectName: { type: String },
    usedForProjectId: { type: Schema.Types.ObjectId, ref: "Project" },
    usedForProjectName: { type: String },
    size: { type: String },
    note: { type: String },
}, { timestamps: true });
wasteMaterialSchema.index({ factoryId: 1, code: 1 }, { unique: true });
export const WasteMaterialModel = model("WasteMaterial", wasteMaterialSchema);
