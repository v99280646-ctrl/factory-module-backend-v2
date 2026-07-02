import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleGetFactory,
  handleGetFactorySettings,
  handleGetFactorySubscription,
  handleSaveFactoryAdminProfile,
  handleSaveFactorySettings,
  handleUpdateFactory,
} from "../controllers/factory/factory.controller.js";

export const factoryRoutes = Router();

factoryRoutes.use("/:factoryId", requireAuth);
factoryRoutes.get("/:factoryId", requirePagePermission("settings", "view"), handleGetFactory);
factoryRoutes.patch("/:factoryId", requirePagePermission("settings", "edit"), handleUpdateFactory);
factoryRoutes.get("/:factoryId/settings", requirePagePermission("settings", "view"), handleGetFactorySettings);
factoryRoutes.get("/:factoryId/subscription", requireFactoryScope, handleGetFactorySubscription);
factoryRoutes.put("/:factoryId/settings", requirePagePermission("settings", "update"), handleSaveFactorySettings);
factoryRoutes.post("/:factoryId/admin-profile", requirePagePermission("settings", "update"), handleSaveFactoryAdminProfile);
