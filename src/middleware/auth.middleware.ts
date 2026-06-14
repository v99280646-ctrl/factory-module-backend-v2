import type { NextFunction, Request, Response } from "express";
import { fail } from "../utils/api-response.js";
import { decodeBearerToken } from "../services/auth.service.js";

export type RequestUser = {
  id: string;
  globalRole: "super_admin" | "admin" | "staff";
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
      factoryId?: string;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return fail(res, 401, "Unauthorized");
  }
  try {
    const payload = decodeBearerToken(header.slice(7));
    req.user = {
      id: payload.userId,
      email: "",
      globalRole: payload.globalRole,
    };
  } catch {
    return fail(res, 401, "Unauthorized");
  }

  next();
}

export function attachFactoryScope(req: Request, res: Response, next: NextFunction) {
  const factoryId = req.header("X-Factory-Id");
  if (factoryId) req.factoryId = factoryId;
  next();
}
