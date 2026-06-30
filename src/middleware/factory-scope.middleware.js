import { Types } from "mongoose";
import { fail } from "../utils/api-response.js";
export function requireFactoryScope(req, res, next) {
    if (req.user?.globalRole === "super_admin") {
        const factoryId = req.header("X-Factory-Id") ?? req.params?.factoryId;
        if (factoryId && Types.ObjectId.isValid(factoryId)) {
            req.factoryId = factoryId;
        }
        else if (factoryId) {
            return fail(res, 400, "Factory scope is invalid");
        }
        return next();
    }
    const headerFactoryId = req.header("X-Factory-Id");
    const routeFactoryId = req.params?.factoryId;
    const requestedFactoryId = headerFactoryId ?? routeFactoryId ?? req.user?.factoryId ?? null;
    const userFactoryId = req.user?.factoryId ?? null;
    if (!userFactoryId) {
        return fail(res, 400, "User is not assigned to a factory");
    }
    if (!Types.ObjectId.isValid(userFactoryId)) {
        return fail(res, 400, "User factory scope is invalid");
    }
    if (requestedFactoryId && !Types.ObjectId.isValid(requestedFactoryId)) {
        return fail(res, 400, "Factory scope is invalid");
    }
    if (requestedFactoryId && String(requestedFactoryId) !== String(userFactoryId)) {
        return fail(res, 403, "You cannot access another factory");
    }
    req.factoryId = String(userFactoryId);
    return next();
}
export function resolveRequestFactoryId(req) {
    return req.factoryId ?? req.header("X-Factory-Id") ?? req.params?.factoryId ?? req.user?.factoryId ?? null;
}
export function requireRequestFactoryId(req, res) {
    const factoryId = resolveRequestFactoryId(req);
    if (!factoryId) {
        return fail(res, 400, "Factory scope is required");
    }
    return String(factoryId);
}
