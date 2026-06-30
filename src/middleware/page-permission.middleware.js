import { UserModel } from "../models/user.model.js";
import { ensureFactoryDefaultSubscription, getFactorySubscriptionContext } from "../services/subscription.service.js";
import { fail } from "../utils/api-response.js";
export function requirePagePermission(page, action) {
    return async (req, res, next) => {
        if (!req.user)
            return fail(res, 401, "Unauthorized");
        if (req.user.globalRole === "super_admin")
            return next();
        const routeFactoryId = req.params.factoryId;
        const factoryId = req.factoryId ??
            req.header("X-Factory-Id") ??
            (Array.isArray(routeFactoryId) ? routeFactoryId[0] : routeFactoryId) ??
            req.user.factoryId ??
            null;
        if (!factoryId)
            return fail(res, 400, "Factory scope is required");
        if (req.user.factoryId && String(req.user.factoryId) !== String(factoryId)) {
            return fail(res, 403, "You cannot access another factory");
        }
        req.factoryId = String(factoryId);
        let subscriptionContext = await getFactorySubscriptionContext(req.factoryId);
        if (!subscriptionContext) {
            await ensureFactoryDefaultSubscription(req.factoryId, req.user.id, { onlyIfNoHistory: true });
            subscriptionContext = await getFactorySubscriptionContext(req.factoryId);
        }
        const subscriptionStatus = subscriptionContext?.subscription?.status;
        if (!subscriptionStatus || ["expired", "cancelled", "past_due", "superseded"].includes(subscriptionStatus)) {
            return fail(res, 402, "Subscription expired. Please upgrade the factory subscription.");
        }
        req.subscription = subscriptionContext.subscription;
        req.subscriptionPlan = subscriptionContext.plan;
        const user = await UserModel.findOne({
            _id: req.user.id,
            factoryId: req.factoryId,
            active: true,
        }).lean();
        if (!user)
            return fail(res, 403, "Forbidden");
        if (user.factoryRole === "admin" || user.globalRole === "admin")
            return next();
        const actions = user.pagePermissions?.[page] ?? [];
        if (!actions.includes(action)) {
            return fail(res, 403, `You do not have ${action} permission for ${page}`);
        }
        next();
    };
}
