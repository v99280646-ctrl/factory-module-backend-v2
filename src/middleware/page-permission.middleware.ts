import type { NextFunction, Request, Response } from "express";
import { MembershipModel, type PageAction, type PageName } from "../models/membership.model.js";
import { fail } from "../utils/api-response.js";

export function requirePagePermission(page: PageName, action: PageAction) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return fail(res, 401, "Unauthorized");
    if (req.user.globalRole === "super_admin") return next();
    const routeFactoryId = req.params.factoryId;
    const factoryId = req.factoryId ?? req.header("X-Factory-Id") ??
      (Array.isArray(routeFactoryId) ? routeFactoryId[0] : routeFactoryId);
    if (!factoryId) return fail(res, 400, "Factory scope is required");
    req.factoryId = factoryId;

    const membership = await MembershipModel.findOne({
      userId: req.user.id,
      factoryId,
      active: true,
    }).lean();

    if (membership?.role === "admin") return next();

    const actions = membership?.pagePermissions?.[page] ?? [];
    if (!actions.includes(action)) {
      return fail(res, 403, `You do not have ${action} permission for ${page}`);
    }

    next();
  };
}
