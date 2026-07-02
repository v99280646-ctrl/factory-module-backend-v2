import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleCreateVendor,
  handleDeleteVendor,
  handleListVendors,
  handleUpdateVendor,
} from "../controllers/vendors/vendors.controller.js";

export const vendorsRoutes = Router();

vendorsRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
vendorsRoutes.get("/", requirePagePermission("vendors", "view"), handleListVendors);
vendorsRoutes.post("/", requirePagePermission("vendors", "add"), handleCreateVendor);
vendorsRoutes.patch("/:id", requirePagePermission("vendors", "edit"), handleUpdateVendor);
vendorsRoutes.delete("/:id", requirePagePermission("vendors", "delete"), handleDeleteVendor);
