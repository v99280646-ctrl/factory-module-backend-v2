import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { ProjectModel } from "../models/project.model.js";
import { StaffModel } from "../models/staff.model.js";
import { StaffUsageLogModel } from "../models/staff-usage-log.model.js";
import { PAGE_NAMES, PAGE_ACTIONS, DEFAULT_PAGE_PERMISSIONS, FULL_PAGE_PERMISSIONS } from "../models/membership.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  deactivateStaffMembership,
  syncMembershipForStaff,
} from "../services/staff-membership.service.js";

export const staffRoutes = Router();

staffRoutes.use(requireAuth, requireFactoryScope);

const staffSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  role: z.string().min(1),
  factoryId: z.string().optional(),
  pagePermissions: z.record(z.string(), z.array(z.string()))
    .transform((rec) => {
      return rec as Record<string, string[]>;
    }).optional(),
  active: z.boolean().optional(),
});

const activityQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/u, "Month must be in YYYY-MM format")
    .optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().optional(),
});

/**
 * Returns available pages and actions for building the permissions UI on the frontend.
 */
staffRoutes.get("/permissions/meta", (_req, res) => {
  ok(res, {
    pages: PAGE_NAMES,
    actions: PAGE_ACTIONS,
    defaults: DEFAULT_PAGE_PERMISSIONS,
    full: FULL_PAGE_PERMISSIONS,
  });
});

function mapStaff(row: any) {
  return {
    id: String(row._id),
    name: row.name || "",
    email: row.email || "",
    phone: row.phone || null,
    role: row.role || "",
    pagePermissions: row.pagePermissions && typeof row.pagePermissions === 'object' ? row.pagePermissions : {},
    active: !!row.active,
    createdAt: row.createdAt,
  };
}

function monthBounds(month?: string) {
  if (!month) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return null;
  const start = new Date(Date.UTC(year, monthNumber - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthNumber, 1, 0, 0, 0, 0));

  // Previous month bounds for comparison
  const prevStart = new Date(Date.UTC(year, monthNumber - 2, 1, 0, 0, 0, 0));
  const prevEnd = new Date(Date.UTC(year, monthNumber - 1, 1, 0, 0, 0, 0));

  return { start, end, prevStart, prevEnd };
}

async function backfillUsageLogsForStaff(staff: any, factoryId?: string) {
  if (!factoryId) return;

  const targetUserId = staff.userId ? String(staff.userId) : "";
  const targetEmail = String(staff.email || "").trim().toLowerCase();
  const targetName = String(staff.name || "").trim().toLowerCase();
  if (!targetUserId && !targetEmail && !targetName) return;

  const projects = await ProjectModel.find({ factoryId }).lean();
  const ops: Array<Record<string, unknown>> = [];

  const matchesStaff = (entry: { userId?: unknown; staffName?: unknown }) => {
    const entryUserId = entry.userId ? String(entry.userId) : "";
    const entryName = String(entry.staffName || "").trim().toLowerCase();
    return Boolean(
      (targetUserId && entryUserId && targetUserId === entryUserId) ||
        (targetName && entryName && targetName === entryName),
    );
  };

  projects.forEach((project: any) => {
    (project.workflowStages ?? []).forEach((stage: any) => {
      (stage?.usageHistory ?? []).forEach((entry: any) => {
        if (!entry?.id || !matchesStaff({ userId: entry.userId, staffName: entry.staffName })) {
          return;
        }

        const materials = (entry.materials ?? []).map((material: any) => ({
          projectMaterialId: String(material.projectMaterialId || ""),
          materialName: String(material.materialName || "Material"),
          materialType: String(material.materialType || ""),
          thickness: String(material.thickness || ""),
          quantityUsed: Number(material.quantityUsed || 0),
          unit: String(material.unit || "units"),
        }));

        ops.push({
          updateOne: {
            filter: {
              factoryId,
              sourceRecordId: String(entry.id),
            },
            update: {
              $setOnInsert: {
                factoryId,
                staffId: staff._id,
                userId: entry.userId || staff.userId || undefined,
                staffName: entry.staffName || staff.name || "Staff",
                staffEmail: staff.email || "",
                staffRole: entry.role || staff.role || "",
                projectId: project._id,
                projectCode: project.code,
                projectName: project.name,
                stageName: stage.name || "",
                note: entry.note || "",
                totalQuantityUsed: materials.reduce((sum: number, material: any) => {
                  return sum + Number(material.quantityUsed || 0);
                }, 0),
                sourceRecordId: String(entry.id),
                activityAt: entry.createdAt ? new Date(entry.createdAt) : new Date(project.updatedAt || Date.now()),
                materials,
              },
            },
            upsert: true,
          },
        });
      });
    });
  });

  if (ops.length) {
    await StaffUsageLogModel.bulkWrite(ops as any[], { ordered: false });
  }
}

staffRoutes.get(
  "/:id/activity",
  requireRole("super_admin", "admin", "staff"),
  requirePagePermission("staff", "view"),
  async (req, res) => {
    try {
      const parsedQuery = activityQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) return fail(res, 400, "Invalid activity query");

      const filter =
        req.user?.globalRole === "super_admin"
          ? { _id: req.params.id }
          : { _id: req.params.id, factoryId: req.factoryId };
      const staff = await StaffModel.findOne(filter).lean();
      if (!staff) return fail(res, 404, "Staff not found");
      await backfillUsageLogsForStaff(staff, req.factoryId);

      const page = parsedQuery.data.page ?? 1;
      const limit = parsedQuery.data.limit ?? 10;
      const range = monthBounds(parsedQuery.data.month);
      const search = parsedQuery.data.search?.trim();

      const baseFilter: Record<string, any> = {
        factoryId: new mongoose.Types.ObjectId(String(req.factoryId)),
      };

      const staffMatch: Array<Record<string, any>> = [];
      if (staff._id) staffMatch.push({ staffId: new mongoose.Types.ObjectId(String(staff._id)) });
      if (staff.userId) staffMatch.push({ userId: new mongoose.Types.ObjectId(String(staff.userId)) });
      if (staff.email) staffMatch.push({ staffEmail: String(staff.email).trim().toLowerCase() });
      if (staff.name) staffMatch.push({ staffName: staff.name });

      if (!staffMatch.length) return ok(res, {
        staff: mapStaff(staff),
        month: parsedQuery.data.month || null,
        search: search || "",
        summary: {
          totalRecords: 0,
          totalUsageEntries: 0,
          totalConfiguredStages: 0,
          totalAssignedProjects: 0,
          totalMaterialsUsed: 0,
          totalLastMonthMaterialsUsed: 0,
        },
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
        records: [],
      });

      baseFilter.$or = staffMatch;

      if (range) {
        baseFilter.activityAt = { $gte: range.start, $lt: range.end };
      }

      if (search) {
        const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
        baseFilter.$and = [
          {
            $or: [
              { projectCode: regex },
              { projectName: regex },
              { stageName: regex },
              { note: regex },
              { "materials.materialName": regex },
              { "materials.materialType": regex },
              { "materials.thickness": regex },
            ],
          },
        ];
      }

      const summaryFilter = { factoryId: baseFilter.factoryId, $or: baseFilter.$or };

      const [total, summaryAggregation, rows] = await Promise.all([
        StaffUsageLogModel.countDocuments(baseFilter),
        StaffUsageLogModel.aggregate([
          { $match: summaryFilter },
          {
            $facet: {
              current: [
                { $match: range ? { activityAt: { $gte: range.start, $lt: range.end } } : {} },
                {
                  $group: {
                    _id: null,
                    totalRecords: { $sum: 1 },
                    totalMaterialsUsed: { $sum: { $ifNull: ["$totalQuantityUsed", 0] } },
                    projects: { $addToSet: "$projectId" },
                  },
                },
              ],
              previous: range ? [
                { $match: { activityAt: { $gte: range.prevStart, $lt: range.prevEnd } } },
                {
                  $group: {
                    _id: null,
                    totalMaterialsUsed: { $sum: { $ifNull: ["$totalQuantityUsed", 0] } },
                  },
                }
              ] : []
            }
          },
        ]),
        StaffUsageLogModel.find(baseFilter)
          .sort({ activityAt: -1, createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(limit)
          .lean(),
      ]);

      const facets = summaryAggregation[0];
      const current = facets?.current[0];
      const previous = facets?.previous[0];

      const totalPages = total ? Math.ceil(total / limit) : 0;
      const summary = {
        totalRecords: current?.totalRecords ?? 0,
        totalUsageEntries: current?.totalRecords ?? 0,
        totalConfiguredStages: 0,
        totalAssignedProjects: Array.isArray(current?.projects) ? current.projects.length : 0,
        totalMaterialsUsed: current?.totalMaterialsUsed ?? 0,
        totalLastMonthMaterialsUsed: previous?.totalMaterialsUsed ?? 0,
      };

      ok(res, {
        staff: mapStaff(staff),
        month: parsedQuery.data.month || null,
        search: search || "",
        summary,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
        records: rows.map((row: any) => ({
          id: String(row._id),
          type: "usage" as const,
          date: row.activityAt,
          projectId: String(row.projectId),
          projectCode: row.projectCode,
          projectName: row.projectName,
          stageName: row.stageName || "",
          role: row.staffRole || "",
          note: row.note || "",
          materialCount: Number(row.totalQuantityUsed ?? 0),
          materials: (row.materials ?? []).map((material: any) => ({
            projectMaterialId: String(material.projectMaterialId || ""),
            materialName: material.materialName || "Material",
            materialType: material.materialType || "",
            thickness: material.thickness || "",
            quantityUsed: Number(material.quantityUsed || 0),
            unit: material.unit || "units",
          })),
        })),
      });
    } catch (error: any) {
      fail(res, error.name === "CastError" ? 400 : 500, error.message || "Failed to load staff activity");
    }
  },
);

staffRoutes.get("/", requireRole("super_admin", "admin", "staff"), requirePagePermission("staff", "view"), async (req, res) => {
  try {
    const filter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
    const staff = await StaffModel.find(filter).sort({ createdAt: -1 }).lean();
    ok(res, staff.map(mapStaff));
  } catch (error: any) {
    fail(res, error.name === "CastError" ? 400 : 500, error.message || "Failed to fetch staff");
  }
});

staffRoutes.post("/", requirePagePermission("staff", "add"), async (req, res) => {
  try {
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Invalid staff payload");

    const factoryId = parsed.data.factoryId || req.factoryId;
    if (!factoryId) return fail(res, 400, "Factory scope is required");

    // Default permissions to 'view' only for all pages if not specified
    const pagePermissions = parsed.data.pagePermissions || DEFAULT_PAGE_PERMISSIONS;

    const created = await StaffModel.create({
      ...parsed.data,
      pagePermissions,
      factoryId,
    });
    await syncMembershipForStaff(created.toObject());
    ok(res, mapStaff(created.toObject()), "Staff created");
  } catch (error: any) {
    if (error.code === 11000) return fail(res, 400, "Staff with this email already exists in this factory");
    fail(res, 400, error.message || "Failed to create staff");
  }
});

staffRoutes.patch("/:id/status", requirePagePermission("staff", "update"), async (req, res) => {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid staff status payload");

  const filter = req.user?.globalRole === "super_admin"
    ? { _id: req.params.id }
    : { _id: req.params.id, factoryId: req.factoryId };
  const updated = await StaffModel.findOneAndUpdate(filter, { active: parsed.data.active }, { new: true }).lean();
  if (!updated) return fail(res, 404, "Staff not found");
  await syncMembershipForStaff(updated);
  ok(res, mapStaff(updated), "Staff status updated");
});

staffRoutes.patch("/:id", requirePagePermission("staff", "edit"), async (req, res) => {
  try {
    const parsed = staffSchema.partial().safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Invalid staff payload");

    const filter = req.user?.globalRole === "super_admin" ? { _id: req.params.id } : { _id: req.params.id, factoryId: req.factoryId };
    const previous = await StaffModel.findOne(filter).lean();
    if (!previous) return fail(res, 404, "Staff not found");
    const updated = await StaffModel.findOneAndUpdate(filter, parsed.data, {
      new: true,
    }).lean();
    if (!updated) return fail(res, 404, "Staff not found");
    if (previous.email && previous.email !== updated.email) {
      await deactivateStaffMembership(previous);
    }
    await syncMembershipForStaff(updated);
    ok(res, mapStaff(updated), "Staff updated");
  } catch (error: any) {
    fail(res, 400, error.message || "Failed to update staff");
  }
});

staffRoutes.delete("/:id", requirePagePermission("staff", "delete"), async (req, res) => {
  try {
    const filter = req.user?.globalRole === "super_admin" ? { _id: req.params.id } : { _id: req.params.id, factoryId: req.factoryId };
    const deleted = await StaffModel.findOneAndDelete(filter).lean();
    if (!deleted) return fail(res, 404, "Staff not found");
    await deactivateStaffMembership(deleted);
    ok(res, { message: "Staff deleted" });
  } catch (error: any) {
    fail(res, 400, error.message || "Failed to delete staff");
  }
});
