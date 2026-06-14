import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { InvoiceModel } from "../models/invoice.model.js";
import { TransactionModel } from "../models/transaction.model.js";
import { fail, ok } from "../utils/api-response.js";

export const transactionsRoutes = Router();
export const invoicesRoutes = Router();

const protectedFinance = [
  requireAuth,
  requireRole("super_admin", "admin", "staff"),
  requireFactoryScope,
] as const;

transactionsRoutes.use(...protectedFinance);
invoicesRoutes.use(...protectedFinance);

const transactionSchema = z.object({
  type: z.enum(["credit", "debit", "income", "expense"]),
  category: z.string().min(1).default("general"),
  description: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().default("INR"),
  transactionDate: z.string().optional(),
  date: z.string().optional(),
  status: z.enum(["pending", "completed", "cancelled"]).default("completed"),
  paymentMethod: z.string().optional(),
  notes: z.string().optional(),
});

function factoryFilter(req: any) {
  return req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
}

function mapTransaction(row: any) {
  return {
    id: String(row._id),
    transactionDate: row.date,
    description: row.description ?? row.category,
    type: row.type === "income" ? "credit" : "debit",
    amount: Number(row.amount),
    category: row.category,
    currency: row.currency,
    status: row.status,
  };
}

transactionsRoutes.get("/", requirePagePermission("finance", "view"), async (req, res) => {
  const type = req.query.type === "credit" ? "income" : req.query.type === "debit" ? "expense" : undefined;
  const rows = await TransactionModel.find({ ...factoryFilter(req), ...(type ? { type } : {}) })
    .sort({ date: -1 })
    .lean();
  ok(res, rows.map(mapTransaction));
});

transactionsRoutes.post("/", requirePagePermission("finance", "add"), async (req, res) => {
  const parsed = transactionSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid transaction payload");
  const created = await TransactionModel.create({
    ...parsed.data,
    factoryId: req.factoryId,
    type: ["credit", "income"].includes(parsed.data.type) ? "income" : "expense",
    date: new Date(parsed.data.transactionDate ?? parsed.data.date ?? Date.now()),
  });
  ok(res, mapTransaction(created.toObject()), "Transaction created");
});

transactionsRoutes.patch("/:id", requirePagePermission("finance", "edit"), async (req, res) => {
  const parsed = transactionSchema.partial().safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid transaction payload");
  const update: any = { ...parsed.data };
  if (parsed.data.type) update.type = ["credit", "income"].includes(parsed.data.type) ? "income" : "expense";
  if (parsed.data.transactionDate || parsed.data.date) update.date = new Date(parsed.data.transactionDate ?? parsed.data.date!);
  const updated = await TransactionModel.findOneAndUpdate(
    { _id: req.params.id, ...factoryFilter(req) },
    update,
    { new: true },
  ).lean();
  if (!updated) return fail(res, 404, "Transaction not found");
  ok(res, mapTransaction(updated), "Transaction updated");
});

transactionsRoutes.delete("/:id", requirePagePermission("finance", "delete"), async (req, res) => {
  const deleted = await TransactionModel.findOneAndDelete({ _id: req.params.id, ...factoryFilter(req) }).lean();
  if (!deleted) return fail(res, 404, "Transaction not found");
  ok(res, { message: "Transaction deleted" });
});

invoicesRoutes.get("/", requirePagePermission("finance", "view"), async (req, res) => {
  const rows = await InvoiceModel.find(factoryFilter(req)).sort({ issueDate: -1 }).lean();
  ok(res, rows.map((row) => ({ ...row, id: String(row._id) })));
});

invoicesRoutes.post("/", requirePagePermission("finance", "add"), async (req, res) => {
  const created = await InvoiceModel.create({ ...req.body, factoryId: req.factoryId });
  ok(res, { ...created.toObject(), id: String(created._id) }, "Invoice created");
});

invoicesRoutes.patch("/:id", requirePagePermission("finance", "edit"), async (req, res) => {
  const updated = await InvoiceModel.findOneAndUpdate(
    { _id: req.params.id, ...factoryFilter(req) },
    req.body,
    { new: true },
  ).lean();
  if (!updated) return fail(res, 404, "Invoice not found");
  ok(res, { ...updated, id: String(updated._id) }, "Invoice updated");
});

invoicesRoutes.delete("/:id", requirePagePermission("finance", "delete"), async (req, res) => {
  const deleted = await InvoiceModel.findOneAndDelete({ _id: req.params.id, ...factoryFilter(req) }).lean();
  if (!deleted) return fail(res, 404, "Invoice not found");
  ok(res, { message: "Invoice deleted" });
});
