import { Schema, model } from "mongoose";
const vendorSchema = new Schema({
    factoryId: { type: Schema.Types.ObjectId, ref: "Factory", required: true, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    countryCode: { type: String },
    phone: { type: String },
    alternativeCountryCode: { type: String },
    address: { type: String },
    city: { type: String },
    state: { type: String },
    zipCode: { type: String },
    country: { type: String },
    companyName: { type: String },
    taxId: { type: String },
    category: { type: String },
    active: { type: Boolean, default: true },
}, { timestamps: true });
vendorSchema.index({ factoryId: 1, email: 1 });
export const VendorModel = model("Vendor", vendorSchema);
