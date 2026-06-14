import { Schema, model } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String },
    googleId: { type: String, unique: true, sparse: true },
    globalRole: {
      type: String,
      enum: ["super_admin", "admin", "staff"],
      default: "staff",
      required: true,
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const UserModel = model("User", userSchema);
