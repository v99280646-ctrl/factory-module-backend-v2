import { fail } from "../utils/api-response.js";
import { decodeBearerToken } from "../services/auth.service.js";
import { UserModel } from "../models/user.model.js";
export async function requireAuth(req, res, next) {
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
        const user = await UserModel.findById(payload.userId).select("_id email globalRole factoryId active").lean();
        if (!user || user.active !== true) {
            return fail(res, 403, "Account is inactive");
        }
        req.user = {
            id: String(user._id),
            email: user.email || "",
            globalRole: user.globalRole,
            factoryId: user.factoryId ? String(user.factoryId) : null,
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
