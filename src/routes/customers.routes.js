import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleCreateCustomer,
  handleDeleteCustomer,
  handleListCustomers,
  handleUpdateCustomer,
} from "../controllers/customers/customers.controller.js";
export const customersRoutes = Router();
customersRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
customersRoutes.get("/", requirePagePermission("customers", "view"), handleListCustomers);
customersRoutes.post("/", requirePagePermission("customers", "add"), handleCreateCustomer);
customersRoutes.patch("/:id", requirePagePermission("customers", "edit"), handleUpdateCustomer);
customersRoutes.delete("/:id", requirePagePermission("customers", "delete"), handleDeleteCustomer);
