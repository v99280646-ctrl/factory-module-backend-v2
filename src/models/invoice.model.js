import { Schema, model } from "mongoose";
const invoiceLineSchema = new Schema({
    description: String,
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    serviceId: { type: Schema.Types.ObjectId, ref: "Service" },
    stockId: { type: Schema.Types.ObjectId, ref: "Stock" },
});
const invoiceSchema = new Schema({
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    invoiceNumber: { type: String, required: true, unique: true, trim: true },
    customerId: { type: Schema.Types.ObjectId, ref: "Customer" },
    customerName: { type: String, required: true },
    customerEmail: { type: String },
    customerPhone: { type: String },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date },
    lines: [invoiceLineSchema],
    subtotal: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    taxRate: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    status: { type: String, enum: ["draft", "sent", "paid", "overdue", "cancelled"], default: "draft" },
    notes: { type: String },
    projectId: { type: Schema.Types.ObjectId, ref: "Project" },
}, { timestamps: true });
invoiceSchema.index({ factoryId: 1, invoiceNumber: 1 }, { unique: true });
export const InvoiceModel = model("Invoice", invoiceSchema);
