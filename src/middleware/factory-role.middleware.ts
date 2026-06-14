import type { NextFunction, Request, Response } from "express";
import { fail } from "../utils/api-response.js";
import { MembershipModel } from "../models/membership.model.js";

export async function requireFactoryAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return fail(res, 401, "Unauthorized");

  console.log("requireFactoryAdmin: req.user", req.user);
  console.log("requireFactoryAdmin: req.factoryId", req.factoryId);
  console.log("requireFactoryAdmin: req.params", req.params);
  console.log("requireFactoryAdmin: req.header", req.header("X-Factory-Id"));

  // Super admin bypasses factory membership checks
  if (req.user.globalRole === "super_admin") return next();

  // Accept factory id from attached request, header, or URL param
  const factoryId = req.factoryId ?? req.header("X-Factory-Id") ?? (req.params as any)?.factoryId;
  if (!factoryId) return fail(res, 400, "Factory scope is required");

  const membership = await MembershipModel.findOne({ userId: req.user.id, factoryId, active: true }).lean();
  console.log("requireFactoryAdmin - membership query result:", membership);
  if (!membership || membership.role !== "admin") {
    console.log("requireFactoryAdmin - membership missing or not admin, failing with 403");
    return fail(res, 403, "Forbidden");
  }

  console.log("requireFactoryAdmin - membership valid, proceeding");

  next();
}

export default requireFactoryAdmin;
