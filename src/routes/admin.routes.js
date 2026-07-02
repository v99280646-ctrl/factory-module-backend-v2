import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  handleAdminDashboardSummary,
  handleAdminGetFactoryNotificationAudit,
  handleAdminGetFactorySectionData,
  handleAdminListFactories,
  handleAdminListNotificationsHistory,
} from "../controllers/admin/admin.controller.js";
import {
  handleGetNotificationSettings,
  handleListNotificationHistory,
  handleSendNotificationNow,
  handleUpdateNotificationSettings,
} from "../controllers/notifications/notifications.controller.js";

export const adminRoutes = Router();

adminRoutes.use(requireAuth, requireRole("super_admin"));
adminRoutes.get("/dashboard/summary", handleAdminDashboardSummary);
adminRoutes.get("/factories", handleAdminListFactories);
adminRoutes.get("/factories/:factoryId/notification-audit", requireFactoryScope, handleAdminGetFactoryNotificationAudit);
adminRoutes.get("/factories/:factoryId/notifications", requireFactoryScope, handleGetNotificationSettings);
adminRoutes.put("/factories/:factoryId/notifications", requireFactoryScope, handleUpdateNotificationSettings);
adminRoutes.get("/factories/:factoryId/notifications/history", requireFactoryScope, handleListNotificationHistory);
adminRoutes.post("/factories/:factoryId/notifications/events/:eventKey/send-now", requireFactoryScope, handleSendNotificationNow);
adminRoutes.get("/notifications/history", handleAdminListNotificationsHistory);
adminRoutes.get("/factories/:factoryId/section-data", handleAdminGetFactorySectionData);
