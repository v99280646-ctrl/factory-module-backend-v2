import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleCreateStaff,
  handleDeleteStaff,
  handleGetStaffActivity,
  handleGetStaffPermissionsMeta,
  handleListStaff,
  handleToggleStaffStatus,
  handleUpdateStaff,
} from "../controllers/staff/staff.controller.js";

export const staffRoutes = Router();

staffRoutes.use(requireAuth, requireFactoryScope);

staffRoutes.get("/permissions/meta", handleGetStaffPermissionsMeta);
staffRoutes.get("/", requireRole("super_admin", "admin", "staff"), requirePagePermission("staff", "view"), handleListStaff);
staffRoutes.get("/:id/activity", requireRole("super_admin", "admin", "staff"), requirePagePermission("staff", "view"), handleGetStaffActivity);
staffRoutes.post("/", requirePagePermission("staff", "add"), handleCreateStaff);
staffRoutes.patch("/:id/status", requirePagePermission("staff", "update"), handleToggleStaffStatus);
staffRoutes.patch("/:id", requirePagePermission("staff", "edit"), handleUpdateStaff);
staffRoutes.delete("/:id", requirePagePermission("staff", "delete"), handleDeleteStaff);
