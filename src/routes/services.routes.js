import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleCreateService,
  handleDeleteService,
  handleListServices,
  handleUpdateService,
} from "../controllers/services/services.controller.js";

export const servicesRoutes = Router();

servicesRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
servicesRoutes.get("/", requirePagePermission("services", "view"), handleListServices);
servicesRoutes.post("/", requirePagePermission("services", "add"), handleCreateService);
servicesRoutes.patch("/:id", requirePagePermission("services", "edit"), handleUpdateService);
servicesRoutes.delete("/:id", requirePagePermission("services", "delete"), handleDeleteService);
