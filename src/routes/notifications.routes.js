import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleGetNotificationSettings,
  handleListNotificationHistory,
  handleSendDailyUpdate,
  handleSendNotificationNow,
  handleUpdateNotificationSettings,
} from "../controllers/notifications/notifications.controller.js";

export const notificationsRoutes = Router();

notificationsRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);

notificationsRoutes.get("/", requirePagePermission("notifications", "view"), handleGetNotificationSettings);
notificationsRoutes.put("/", requirePagePermission("notifications", "update"), handleUpdateNotificationSettings);
notificationsRoutes.post(
  "/daily-updates/send",
  requirePagePermission("notifications", "update"),
  handleSendDailyUpdate,
);
notificationsRoutes.post(
  "/events/:eventKey/send-now",
  requirePagePermission("notifications", "update"),
  handleSendNotificationNow,
);
notificationsRoutes.get("/history", requirePagePermission("notifications", "view"), handleListNotificationHistory);
