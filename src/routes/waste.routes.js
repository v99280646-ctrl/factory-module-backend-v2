import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleCreateWaste,
  handleDeleteWaste,
  handleGetNextWasteCode,
  handleListWaste,
  handleUpdateWaste,
} from "../controllers/waste/waste.controller.js";

export const wasteRoutes = Router();

wasteRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
wasteRoutes.get("/", requirePagePermission("stock", "view"), handleListWaste);
wasteRoutes.get("/next-code", requirePagePermission("stock", "view"), handleGetNextWasteCode);
wasteRoutes.post("/", requirePagePermission("stock", "add"), handleCreateWaste);
wasteRoutes.patch("/:id", requirePagePermission("stock", "update"), handleUpdateWaste);
wasteRoutes.delete("/:id", requirePagePermission("stock", "delete"), handleDeleteWaste);
