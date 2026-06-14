import type { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import { fail } from "../utils/api-response.js";

export function requireFactoryScope(req: Request, res: Response, next: NextFunction) {
  console.log("requireFactoryScope - method:", req.method, "path:", req.path);
  console.log("requireFactoryScope - X-Factory-Id header:", req.header("X-Factory-Id"));
  console.log("requireFactoryScope - params:", req.params);
  console.log("requireFactoryScope - user:", req.user);

  // Accept factory id from header or URL param
  const factoryId = req.header("X-Factory-Id") ?? (req.params as any)?.factoryId;

  if (req.user?.globalRole === "super_admin") {
    // Super admin can optionally specify a scope
    if (factoryId && Types.ObjectId.isValid(factoryId)) {
      req.factoryId = factoryId;
    }
    return next();
  }

  if (!factoryId || !Types.ObjectId.isValid(factoryId)) {
    console.log("requireFactoryScope - missing factoryId -> failing with 400");
    return fail(res, 400, "A valid Factory ID is required in the headers (X-Factory-Id)");
  }

  req.factoryId = factoryId;
  console.log("requireFactoryScope - attached req.factoryId:", req.factoryId);
  next();
}
