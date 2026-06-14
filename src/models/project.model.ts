import { Schema, model } from "mongoose";

const projectSchema = new Schema(
  {
    factoryId: {
      type: Schema.Types.ObjectId,
      ref: "Factory",
      required: true,
      index: true,
    },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    customerName: { type: String, required: true, trim: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
    status: {
      type: String,
      default: "ongoing",
      enum: ["ongoing", "hold", "completed", "cancelled"],
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    delivery: { type: Date },
    amount: { type: Number, default: 0 },
    notes: { type: String },
    workType: { type: String, default: "own" },
    assignedStaffIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    materials: [
      {
        id: { type: String },
        source: { type: String, enum: ["inventory", "new-stock"] },
        stockItemId: { type: Schema.Types.ObjectId, ref: "Stock" },
        materialName: { type: String },
        materialType: { type: String },
        thickness: { type: String },
        quantity: { type: Number },
        unit: { type: String },
      },
    ],
    services: [
      {
        id: { type: String },
        serviceId: { type: Schema.Types.ObjectId, ref: "Service" },
        serviceName: { type: String },
        unit: { type: String },
      },
    ],
    workflowStages: { type: [Schema.Types.Mixed], default: [] },
  },
  { timestamps: true },
);

projectSchema.index({ factoryId: 1, code: 1 }, { unique: true });

export const ProjectModel = model("Project", projectSchema);
