import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { ProjectModel } from "../models/project.model.js";
import { StaffModel } from "../models/staff.model.js";
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
  return { start, end };
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

      const range = monthBounds(parsedQuery.data.month);
      const projectFilter = req.user?.globalRole === "super_admin" ? {} : { factoryId: req.factoryId };
      const projects = await ProjectModel.find(projectFilter).lean();

      const targetUserId = staff.userId ? String(staff.userId) : "";
      const targetEmail = String(staff.email || "").trim().toLowerCase();
      const targetName = String(staff.name || "").trim().toLowerCase();

      const records: Array<{
        id: string;
        type: "usage" | "configuration" | "assignment";
        date: string;
        projectId: string;
        projectCode: string;
        projectName: string;
        stageName?: string;
        role?: string;
        note?: string;
        materialCount?: number;
        materials?: Array<{
          projectMaterialId?: string;
          materialName: string;
          materialType?: string;
          thickness?: string;
          quantityUsed?: number;
          requiredQuantity?: number;
          completedQuantity?: number;
          unit?: string;
        }>;
      }> = [];

      const inRange = (value?: unknown) => {
        if (!value) return !range;
        const date = new Date(String(value));
        if (Number.isNaN(date.getTime())) return false;
        if (!range) return true;
        return date >= range.start && date < range.end;
      };

      const matchesStaff = (entry: {
        userId?: unknown;
        staffName?: unknown;
        email?: unknown;
      }) => {
        const entryUserId = entry.userId ? String(entry.userId) : "";
        const entryName = String(entry.staffName || "").trim().toLowerCase();
        const entryEmail = String(entry.email || "").trim().toLowerCase();
        return Boolean(
          (targetUserId && entryUserId && targetUserId === entryUserId) ||
            (targetEmail && entryEmail && targetEmail === entryEmail) ||
            (targetName && entryName && targetName === entryName),
        );
      };

      projects.forEach((project: any) => {
        const projectId = String(project._id);
        const projectCode = String(project.code || "");
        const projectName = String(project.name || "");

        const assignedStaffIds = (project.assignedStaffIds ?? []).map(String);
        if ((!range || inRange(project.updatedAt)) && targetUserId && assignedStaffIds.includes(targetUserId)) {
          records.push({
            id: `assignment-${projectId}`,
            type: "assignment",
            date: new Date(project.updatedAt || project.createdAt || Date.now()).toISOString(),
            projectId,
            projectCode,
            projectName,
            role: String(staff.role || "Assigned"),
            note: "Assigned to project",
          });
        }

        (project.workflowStages ?? []).forEach((stage: any) => {
          const stageName = String(stage.name || "");
          const configuredBy = stage?.configuredBy;
          if (
            configuredBy &&
            matchesStaff({
              userId: configuredBy.userId,
              staffName: configuredBy.staffName,
            }) &&
            inRange(configuredBy.configuredAt)
          ) {
            records.push({
              id: `configuration-${projectId}-${stageName}-${configuredBy.configuredAt || ""}`,
              type: "configuration",
              date: new Date(configuredBy.configuredAt || project.updatedAt || Date.now()).toISOString(),
              projectId,
              projectCode,
              projectName,
              stageName,
              role: String(configuredBy.role || stageName || "Configured"),
              note: "Configured stage materials",
              materialCount: Array.isArray(stage.materials) ? stage.materials.length : 0,
              materials: (stage.materials ?? []).map((material: any) => ({
                projectMaterialId: String(material.projectMaterialId || ""),
                materialName: String(material.materialName || "Material"),
                materialType: String(material.materialType || ""),
                thickness: String(material.thickness || ""),
                requiredQuantity: Number(material.requiredQuantity || 0),
                completedQuantity: Number(material.completedQuantity || 0),
                unit: String(material.unit || "units"),
              })),
            });
          }

          (stage?.usageHistory ?? []).forEach((entry: any) => {
            if (
              matchesStaff({
                userId: entry.userId,
                staffName: entry.staffName,
              }) &&
              inRange(entry.createdAt)
            ) {
              records.push({
                id: String(entry.id || `usage-${projectId}-${stageName}-${entry.createdAt || ""}`),
                type: "usage",
                date: new Date(entry.createdAt || project.updatedAt || Date.now()).toISOString(),
                projectId,
                projectCode,
                projectName,
                stageName,
                role: String(entry.role || stageName || ""),
                note: String(entry.note || ""),
                materialCount: Array.isArray(entry.materials) ? entry.materials.length : 0,
                materials: (entry.materials ?? []).map((material: any) => ({
                  projectMaterialId: String(material.projectMaterialId || ""),
                  materialName: String(material.materialName || "Material"),
                  materialType: String(material.materialType || ""),
                  thickness: String(material.thickness || ""),
                  quantityUsed: Number(material.quantityUsed || 0),
                  unit: String(material.unit || "units"),
                })),
              });
            }
          });
        });
      });

      records.sort((a, b) => +new Date(b.date) - +new Date(a.date));

      const summary = {
        totalRecords: records.length,
        totalUsageEntries: records.filter((record) => record.type === "usage").length,
        totalConfiguredStages: records.filter((record) => record.type === "configuration").length,
        totalAssignedProjects: new Set(
          records
            .filter((record) => record.type === "assignment")
            .map((record) => record.projectId),
        ).size,
        totalMaterialsUsed: records
          .filter((record) => record.type === "usage")
          .reduce(
            (sum, record) =>
              sum +
              (record.materials ?? []).reduce(
                (inner, material) => inner + Number(material.quantityUsed || 0),
                0,
              ),
            0,
          ),
      };

      ok(res, {
        staff: mapStaff(staff),
        month: parsedQuery.data.month || null,
        summary,
        records,
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
