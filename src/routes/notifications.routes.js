import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { NotificationSettingModel } from "../models/notification-setting.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
export const notificationsRoutes = Router();
notificationsRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
const notificationSettingSchema = z.object({
    audience: z.string().min(1),
    label: z.string().min(1),
    enabled: z.boolean(),
});
notificationsRoutes.get("/", requirePagePermission("notifications", "view"), async (req, res) => {
    const filter = req.user?.globalRole === "super_admin" ? { factoryId: req.factoryId ?? null } : { factoryId: req.factoryId };
    const rows = await NotificationSettingModel.find(filter).sort({ createdAt: 1 }).lean();
    ok(res, rows.map((row) => ({
        label: row.label,
        enabled: row.enabled,
    })));
});
notificationsRoutes.put("/", requirePagePermission("notifications", "update"), async (req, res) => {
    const parsed = notificationSettingSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid notification setting payload");
    const factoryId = req.user?.globalRole === "super_admin" ? req.factoryId ?? null : req.factoryId;
    const query = {
        factoryId,
        audience: parsed.data.audience,
        label: parsed.data.label,
    };
    const updated = await NotificationSettingModel.findOneAndUpdate(query, {
        $set: { enabled: parsed.data.enabled, updatedBy: req.user?.id },
        $setOnInsert: { createdBy: req.user?.id },
    }, { new: true, upsert: true, setDefaultsOnInsert: true }).lean();
    ok(res, { label: updated.label, enabled: updated.enabled }, "Notification setting updated");
});
