import { fail } from "../utils/api-response.js";
import { UserModel } from "../models/user.model.js";
export async function requireFactoryAdmin(req, res, next) {
    if (!req.user)
        return fail(res, 401, "Unauthorized");
    // Super admin bypasses factory membership checks
    if (req.user.globalRole === "super_admin")
        return next();
    const factoryId = req.factoryId ?? req.header("X-Factory-Id") ?? req.params?.factoryId ?? req.user.factoryId;
    if (!factoryId)
        return fail(res, 400, "Factory scope is required");
    if (req.user.factoryId && String(req.user.factoryId) !== String(factoryId)) {
        return fail(res, 403, "You cannot access another factory");
    }
    const user = await UserModel.findOne({
        _id: req.user.id,
        factoryId,
        active: true,
    }).lean();
    if (!user || (user.factoryRole !== "admin" && user.globalRole !== "admin")) {
        return fail(res, 403, "Forbidden");
    }
    next();
}
export default requireFactoryAdmin;
