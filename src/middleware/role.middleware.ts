import type { NextFunction, Request, Response } from "express";
import { fail } from "../utils/api-response.js";

export function requireRole(...allowed: Array<"super_admin" | "admin" | "staff">) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return fail(res, 401, "Unauthorized");
    if (!allowed.includes(req.user.globalRole)) {
      return fail(res, 403, "Forbidden");
    }
    next();
  };
}
