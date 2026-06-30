import { fail } from "../utils/api-response.js";
import { decodeBearerToken } from "../services/auth.service.js";
export function requireAuth(req, res, next) {
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
            factoryId: payload.factoryId ?? null,
        };
    }
    catch {
        return fail(res, 401, "Unauthorized");
    }
    next();
}
export function attachFactoryScope(req, res, next) {
    const factoryId = req.header("X-Factory-Id");
    if (factoryId)
        req.factoryId = factoryId;
    next();
}
