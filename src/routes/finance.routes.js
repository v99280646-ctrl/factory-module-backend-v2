import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleCreateInvoice,
  handleCreateTransaction,
  handleDeleteInvoice,
  handleDeleteTransaction,
  handleListInvoices,
  handleListTransactions,
  handleUpdateInvoice,
  handleUpdateTransaction,
} from "../controllers/finance/finance.controller.js";

export const transactionsRoutes = Router();
export const invoicesRoutes = Router();

const protectedFinance = [
  requireAuth,
  requireRole("super_admin", "admin", "staff"),
  requireFactoryScope,
];

transactionsRoutes.use(...protectedFinance);
invoicesRoutes.use(...protectedFinance);
transactionsRoutes.get("/", requirePagePermission("finance", "view"), handleListTransactions);
transactionsRoutes.post("/", requirePagePermission("finance", "add"), handleCreateTransaction);
transactionsRoutes.patch("/:id", requirePagePermission("finance", "edit"), handleUpdateTransaction);
transactionsRoutes.delete("/:id", requirePagePermission("finance", "delete"), handleDeleteTransaction);
invoicesRoutes.get("/", requirePagePermission("finance", "view"), handleListInvoices);
invoicesRoutes.post("/", requirePagePermission("finance", "add"), handleCreateInvoice);
invoicesRoutes.patch("/:id", requirePagePermission("finance", "edit"), handleUpdateInvoice);
invoicesRoutes.delete("/:id", requirePagePermission("finance", "delete"), handleDeleteInvoice);
