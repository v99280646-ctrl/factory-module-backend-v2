import { z } from "zod";
import { InvoiceModel } from "../../models/invoice.model.js";
import { TransactionModel } from "../../models/transaction.model.js";
import { fail, ok } from "../../utils/api-response.js";
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
function factoryFilter(req) {
    return req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
}
function mapTransaction(row) {
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
export async function handleListTransactions(req, res) {
    const type = req.query.type === "credit" ? "income" : req.query.type === "debit" ? "expense" : undefined;
    const rows = await TransactionModel.find({ ...factoryFilter(req), ...(type ? { type } : {}) })
        .sort({ date: -1 })
        .lean();
    ok(res, rows.map(mapTransaction));
}
export async function handleCreateTransaction(req, res) {
    const parsed = transactionSchema.safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid transaction payload");
    const created = await TransactionModel.create({
        ...parsed.data,
        factoryId: req.factoryId,
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
        type: ["credit", "income"].includes(parsed.data.type) ? "income" : "expense",
        date: new Date(parsed.data.transactionDate ?? parsed.data.date ?? Date.now()),
    });
    ok(res, mapTransaction(created.toObject()), "Transaction created");
}
export async function handleUpdateTransaction(req, res) {
    const parsed = transactionSchema.partial().safeParse(req.body);
    if (!parsed.success)
        return fail(res, 400, "Invalid transaction payload");
    const update = { ...parsed.data };
    if (parsed.data.type)
        update.type = ["credit", "income"].includes(parsed.data.type) ? "income" : "expense";
    if (parsed.data.transactionDate || parsed.data.date)
        update.date = new Date(parsed.data.transactionDate ?? parsed.data.date);
    const updated = await TransactionModel.findOneAndUpdate({ _id: req.params.id, ...factoryFilter(req) }, { ...update, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Transaction not found");
    ok(res, mapTransaction(updated), "Transaction updated");
}
export async function handleDeleteTransaction(req, res) {
    const deleted = await TransactionModel.findOneAndDelete({ _id: req.params.id, ...factoryFilter(req) }).lean();
    if (!deleted)
        return fail(res, 404, "Transaction not found");
    ok(res, { message: "Transaction deleted" });
}
export async function handleListInvoices(req, res) {
    const rows = await InvoiceModel.find(factoryFilter(req)).sort({ issueDate: -1 }).lean();
    ok(res, rows.map((row) => ({ ...row, id: String(row._id) })));
}
export async function handleCreateInvoice(req, res) {
    const created = await InvoiceModel.create({
        ...req.body,
        factoryId: req.factoryId,
        createdBy: req.user?.id,
        updatedBy: req.user?.id,
    });
    ok(res, { ...created.toObject(), id: String(created._id) }, "Invoice created");
}
export async function handleUpdateInvoice(req, res) {
    const updated = await InvoiceModel.findOneAndUpdate({ _id: req.params.id, ...factoryFilter(req) }, { ...req.body, updatedBy: req.user?.id }, { new: true }).lean();
    if (!updated)
        return fail(res, 404, "Invoice not found");
    ok(res, { ...updated, id: String(updated._id) }, "Invoice updated");
}
export async function handleDeleteInvoice(req, res) {
    const deleted = await InvoiceModel.findOneAndDelete({ _id: req.params.id, ...factoryFilter(req) }).lean();
    if (!deleted)
        return fail(res, 404, "Invoice not found");
    ok(res, { message: "Invoice deleted" });
}
