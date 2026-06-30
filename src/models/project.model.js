import { Schema, model } from "mongoose";
const projectSchema = new Schema({
    factoryId: {
        type: Schema.Types.ObjectId,
        ref: "Factory",
        required: true,
        index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
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
    subtotal: { type: Number, default: 0, min: 0 },
    taxType: { type: String, default: "percent" },
    taxValue: { type: Number, default: 0, min: 0 },
    taxAmount: { type: Number, default: 0, min: 0 },
    discountType: { type: String, default: "amount" },
    discountValue: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },
    amount: { type: Number, default: 0 },
    notes: { type: String },
    workType: { type: String, default: "own" },
    assignedStaffIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
    assignedStaff: [
        {
            userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
            status: {
                type: String,
                default: "Not started",
                enum: ["Not started", "In progress", "On hold", "Completed"],
            },
            updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
            updatedAt: { type: Date },
            assignedAt: { type: Date, default: Date.now },
        },
    ],
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
            employeeRole: { type: String },
            unit: { type: String },
            quantity: { type: Number },
            rate: { type: Number, default: 0, min: 0 },
            total: { type: Number, default: 0, min: 0 },
        },
    ],
    workflowStages: { type: [Schema.Types.Mixed], default: [] },
}, { timestamps: true });
projectSchema.index({ factoryId: 1, code: 1 }, { unique: true });
export const ProjectModel = model("Project", projectSchema);
