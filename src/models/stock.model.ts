import { Schema, model } from "mongoose";

const stockSchema = new Schema(
  {
    factoryId: {
      type: Schema.Types.ObjectId,
      ref: "Factory",
      required: true,
      index: true,
    },
    code: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    material: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    thickness: { type: String, required: true, trim: true },
    typeKey: { type: String, required: true, trim: true },
    thicknessKey: { type: String, required: true, trim: true },
    description: { type: String },
    quantity: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: "pcs" },
    unitPrice: { type: Number, default: 0, min: 0 },
    reorderLevel: { type: Number, default: 0, min: 0 },
    category: { type: String },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor" },
    location: { type: String },
    expiryDate: { type: Date },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

stockSchema.index({ factoryId: 1, code: 1 }, { unique: true });
stockSchema.index(
  { factoryId: 1, typeKey: 1, thicknessKey: 1 },
  {
    unique: true,
    name: "unique_stock_type_thickness_per_factory",
    partialFilterExpression: {
      typeKey: { $type: "string" },
      thicknessKey: { $type: "string" },
    },
  },
);

export const StockModel = model("Stock", stockSchema);
