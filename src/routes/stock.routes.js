import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleCreateStock,
  handleCreateStockMaterialType,
  handleDeleteStock,
  handleGetStockMaterialTypes,
  handleListStock,
  handleUpdateStock,
  handleUpdateStockQuantity,
} from "../controllers/stock/stock.controller.js";

export const stockRoutes = Router();

stockRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);

stockRoutes.get("/material-types", requirePagePermission("stock", "view"), handleGetStockMaterialTypes);
stockRoutes.post("/material-types", requirePagePermission("stock", "add"), handleCreateStockMaterialType);
stockRoutes.get("/", requirePagePermission("stock", "view"), handleListStock);
stockRoutes.post("/", requirePagePermission("stock", "add"), handleCreateStock);
stockRoutes.patch("/:id", requirePagePermission("stock", "edit"), handleUpdateStock);
stockRoutes.patch("/:id/quantity", requirePagePermission("stock", "update"), handleUpdateStockQuantity);
stockRoutes.delete("/:id", requirePagePermission("stock", "delete"), handleDeleteStock);
