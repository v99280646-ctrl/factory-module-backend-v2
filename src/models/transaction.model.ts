import { Schema, model } from "mongoose";

const transactionSchema = new Schema(
  {
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, index: true },
    type: { type: String, enum: ["income", "expense"], required: true },
    category: { type: String, required: true },
    description: { type: String },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    referenceId: { type: String },
    relatedModel: { type: String },
    relatedId: { type: Schema.Types.ObjectId },
    date: { type: Date, default: Date.now },
    paymentMethod: { type: String },
    status: { type: String, enum: ["pending", "completed", "cancelled"], default: "completed" },
    notes: { type: String },
  },
  { timestamps: true },
);

transactionSchema.index({ factoryId: 1, date: -1 });

export const TransactionModel = model("Transaction", transactionSchema);
