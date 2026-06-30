import { fail } from "../utils/api-response.js";
export function requireRole(...allowed) {
    return (req, res, next) => {
        if (!req.user)
            return fail(res, 401, "Unauthorized");
        if (!allowed.includes(req.user.globalRole)) {
            return fail(res, 403, "Forbidden");
        }
        next();
    };
}
