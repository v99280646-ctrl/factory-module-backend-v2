import { Types } from "mongoose";
import { z } from "zod";
import { ProjectModel } from "../../models/project.model.js";
import { StaffUsageLogModel } from "../../models/staff-usage-log.model.js";
import {
  EMPLOYEE_ROLES,
  PAGE_ACTIONS,
  PAGE_NAMES,
  DEFAULT_PAGE_PERMISSIONS,
  FULL_PAGE_PERMISSIONS,
} from "../../models/membership.model.js";
import { UserModel } from "../../models/user.model.js";
import { fail, ok } from "../../utils/api-response.js";
import { assertFactoryFeatureLimit } from "../../services/subscription.service.js";

const staffSchema = z.object({
  name: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  role: z.enum(EMPLOYEE_ROLES),
  employeeRole: z.enum(EMPLOYEE_ROLES).optional().nullable(),
  factoryId: z.string().optional(),
  pagePermissions: z.record(z.string(), z.array(z.string())).transform((rec) => rec).optional(),
  active: z.boolean().optional(),
});

const activityQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/u, "Month must be in YYYY-MM format").optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().trim().optional(),
});

const staffListQuerySchema = z.object({
  search: z.string().trim().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function normalizeEmail(email) {
  return email?.trim().toLowerCase() ?? "";
}

function normalizePagePermissions(value) {
  return Object.fromEntries(
    PAGE_NAMES.flatMap((page) => {
      const actions = (value?.[page] ?? []).filter((action) => PAGE_ACTIONS.includes(action));
      return actions.length ? [[page, actions]] : [];
    }),
  );
}

function safePagePermissions(value) {
  const normalized = normalizePagePermissions(value);
  return Object.keys(normalized).length ? normalized : DEFAULT_PAGE_PERMISSIONS;
}

function mapStaff(user) {
  return {
    id: String(user._id),
    userId: String(user._id),
    name: user.name || "",
    email: user.email || "",
    phone: user.phone || null,
    role: user.employeeRole || "",
    employeeRole: user.employeeRole || "",
    pagePermissions: user.pagePermissions && typeof user.pagePermissions === "object" ? user.pagePermissions : {},
    active: !!user.active,
    createdAt: user.createdAt,
  };
}

function monthBounds(month) {
  if (!month) return null;
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return null;
  const start = new Date(Date.UTC(year, monthNumber - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, monthNumber, 1, 0, 0, 0, 0));
  const prevStart = new Date(Date.UTC(year, monthNumber - 2, 1, 0, 0, 0, 0));
  const prevEnd = new Date(Date.UTC(year, monthNumber - 1, 1, 0, 0, 0, 0));
  return { start, end, prevStart, prevEnd };
}

function staffFilter(req) {
  if (req.user?.globalRole === "super_admin" && !req.factoryId) {
    return { factoryRole: "staff" };
  }
  return {
    factoryId: req.factoryId,
    factoryRole: "staff",
  };
}

function resolveFactoryId(req, fallback) {
  return req.factoryId ?? fallback ?? req.user?.factoryId ?? null;
}

function routeParam(value) {
  return Array.isArray(value) ? value[0] : value;
}

function buildEmailConflictMessage(user) {
  if (!user) return "This email is already used by another account";
  if (user.globalRole === "super_admin") {
    return "This email already belongs to a super admin account";
  }
  if (user.factoryRole === "admin" || user.globalRole === "admin") {
    return "This email already belongs to a factory admin account";
  }
  if (user.active !== true) {
    return "This email belongs to a deleted or inactive account. Re-add that team member using this email instead of updating another account to it.";
  }
  return "This email is already used by another account";
}

async function backfillUsageLogsForUser(user, factoryId) {
  if (!factoryId) return;
  const targetUserId = String(user._id);
  const targetEmail = normalizeEmail(user.email || "");
  const targetName = String(user.name || "").trim().toLowerCase();
  const projects = await ProjectModel.find({ factoryId }).lean();
  const ops = [];

  const matchesStaff = (entry) => {
    const entryUserId = entry.userId ? String(entry.userId) : "";
    const entryName = String(entry.staffName || "").trim().toLowerCase();
    const entryEmail = normalizeEmail(String(entry.staffEmail || ""));
    return Boolean(
      (targetUserId && entryUserId && targetUserId === entryUserId) ||
        (targetEmail && entryEmail && targetEmail === entryEmail) ||
        (targetName && entryName && targetName === entryName),
    );
  };

  projects.forEach((project) => {
    (project.workflowStages ?? []).forEach((stage) => {
      (stage?.usageHistory ?? []).forEach((entry) => {
        if (
          !entry?.id ||
          !matchesStaff({ userId: entry.userId, staffName: entry.staffName, staffEmail: entry.staffEmail })
        ) {
          return;
        }

        const materials = (entry.materials ?? []).map((material) => ({
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
                userId: user._id,
                staffName: entry.staffName || user.name || "Staff",
                staffEmail: entry.staffEmail || user.email || "",
                staffRole: entry.role || user.employeeRole || "",
                projectId: project._id,
                projectCode: project.code,
                projectName: project.name,
                stageName: stage.name || "",
                note: entry.note || "",
                totalQuantityUsed: materials.reduce((sum, material) => sum + Number(material.quantityUsed || 0), 0),
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
    await StaffUsageLogModel.bulkWrite(ops, { ordered: false });
  }
}

async function loadStaffById(req, id) {
  const filter =
    req.user?.globalRole === "super_admin" && !req.factoryId
      ? { _id: id, factoryRole: "staff" }
      : { _id: id, factoryId: req.factoryId, factoryRole: "staff" };
  return UserModel.findOne(filter).lean();
}

export function handleGetStaffPermissionsMeta(_req, res) {
  ok(res, {
    pages: PAGE_NAMES,
    actions: PAGE_ACTIONS,
    defaults: DEFAULT_PAGE_PERMISSIONS,
    full: FULL_PAGE_PERMISSIONS,
  });
}

export async function handleListStaff(req, res) {
  const parsedQuery = staffListQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) return fail(res, 400, "Invalid staff query");

  const filter = staffFilter(req);
  const search = parsedQuery.data.search?.trim();
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "iu");
    filter.$or = [{ name: regex }, { email: regex }, { phone: regex }, { employeeRole: regex }];
  }

  if (parsedQuery.data.page !== undefined) {
    const page = parsedQuery.data.page;
    const limit = parsedQuery.data.limit ?? 20;
    const total = await UserModel.countDocuments(filter);
    const totalPages = total ? Math.ceil(total / limit) : 0;
    const rows = await UserModel.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();

    return ok(res, {
      items: rows.map(mapStaff),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  }

  const rows = await UserModel.find(filter).sort({ createdAt: -1 }).lean();
  ok(res, rows.map(mapStaff));
}

export async function handleGetStaffActivity(req, res) {
  try {
    const parsedQuery = activityQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) return fail(res, 400, "Invalid activity query");

    const user = await loadStaffById(req, routeParam(req.params.id));
    if (!user) return fail(res, 404, "Staff not found");

    const factoryId = resolveFactoryId(req, user.factoryId ? String(user.factoryId) : null);
    await backfillUsageLogsForUser(user, factoryId);

    const page = parsedQuery.data.page ?? 1;
    const limit = parsedQuery.data.limit ?? 10;
    const range = monthBounds(parsedQuery.data.month);
    const search = parsedQuery.data.search?.trim();

    // Build base filter for the current user
    const baseFilter = {
      ...(factoryId ? { factoryId } : {}),
      $or: [
        { userId: user._id },
        { staffEmail: normalizeEmail(user.email) },
        { staffName: user.name }
      ],
    };

    // Add date range filter if provided
    if (range) {
      baseFilter.activityAt = { $gte: range.start, $lt: range.end };
    }

    // Add search filter if provided
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

    // Create summary filter for current month
    const currentMonthFilter = {
      ...(factoryId ? { factoryId } : {}),
      $or: baseFilter.$or,
    };

    // If range is provided, add date filter for current month
    if (range) {
      currentMonthFilter.activityAt = { $gte: range.start, $lt: range.end };
    }

    // Create summary filter for previous month
    const previousMonthFilter = {
      ...(factoryId ? { factoryId } : {}),
      $or: baseFilter.$or,
    };

    // If range is provided, add date filter for previous month
    if (range) {
      previousMonthFilter.activityAt = { $gte: range.prevStart, $lt: range.prevEnd };
    }

    // Execute queries in parallel
    const [total, currentMonthAggregation, previousMonthAggregation, rows] = await Promise.all([
      StaffUsageLogModel.countDocuments(baseFilter),
      // Current month aggregation
      StaffUsageLogModel.aggregate([
        { $match: currentMonthFilter },
        {
          $group: {
            _id: null,
            totalRecords: { $sum: 1 },
            totalMaterialsUsed: {
              $sum: {
                $add: [
                  { $ifNull: ["$totalQuantityUsed", 0] },
                  { $ifNull: ["$directUsage", 0] }
                ],
              },
            },
            projects: { $addToSet: "$projectId" },
            stages: { $addToSet: "$stageName" },
            // Calculate total processed units (sum of all materials used)
            totalProcessedUnits: {
              $sum: {
                $add: [
                  { $ifNull: ["$totalQuantityUsed", 0] },
                  { $ifNull: ["$directUsage", 0] }
                ],
              },
            },
          },
        },
      ]),
      // Previous month aggregation
      range
        ? StaffUsageLogModel.aggregate([
            { $match: previousMonthFilter },
            {
              $group: {
                _id: null,
                totalRecords: { $sum: 1 },
                totalMaterialsUsed: {
                  $sum: {
                    $add: [
                      { $ifNull: ["$totalQuantityUsed", 0] },
                      { $ifNull: ["$directUsage", 0] }
                    ],
                  },
                },
                // Calculate total processed units for previous month
                totalProcessedUnits: {
                  $sum: {
                    $add: [
                      { $ifNull: ["$totalQuantityUsed", 0] },
                      { $ifNull: ["$directUsage", 0] }
                    ],
                  },
                },
              },
            },
          ])
        : Promise.resolve([]),
      StaffUsageLogModel.find(baseFilter)
        .sort({ activityAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    // Extract current month data
    const currentMonthData = currentMonthAggregation[0] || null;
    const previousMonthData = previousMonthAggregation[0] || null;

    // Get current month statistics
    let currentMonthTotalRecords = currentMonthData?.totalRecords ?? 0;
    let currentMonthTotalMaterials = currentMonthData?.totalMaterialsUsed ?? 0;
    let currentMonthTotalProjects = currentMonthData?.projects?.length ?? 0;
    let currentMonthTotalStages = currentMonthData?.stages?.length ?? 0;
    let currentMonthProcessedUnits = currentMonthData?.totalProcessedUnits ?? 0;

    // If aggregation returned empty but we have records, calculate from records
    if (currentMonthTotalRecords === 0 && rows.length > 0) {
      const uniqueProjects = new Set();
      const uniqueStages = new Set();
      let materialsSum = 0;
      let processedUnits = 0;

      for (const row of rows) {
        if (row.projectId) uniqueProjects.add(String(row.projectId));
        if (row.stageName) uniqueStages.add(row.stageName);
        const rowTotal = Number(row.totalQuantityUsed ?? 0) + Number(row.directUsage ?? 0);
        materialsSum += rowTotal;
        processedUnits += rowTotal;
      }

      currentMonthTotalRecords = rows.length;
      currentMonthTotalMaterials = materialsSum;
      currentMonthTotalProjects = uniqueProjects.size;
      currentMonthTotalStages = uniqueStages.size;
      currentMonthProcessedUnits = processedUnits;
    }

    // Get previous month statistics
    let previousMonthTotalRecords = previousMonthData?.totalRecords ?? 0;
    let previousMonthTotalMaterials = previousMonthData?.totalMaterialsUsed ?? 0;
    let previousMonthProcessedUnits = previousMonthData?.totalProcessedUnits ?? 0;

    // If no previous month data but range exists, and we have records, calculate from all records
    if (range && previousMonthTotalRecords === 0) {
      // Try to get previous month data from all records (not just paginated)
      const allPrevMonthData = await StaffUsageLogModel.aggregate([
        {
          $match: {
            ...(factoryId ? { factoryId } : {}),
            $or: baseFilter.$or,
            activityAt: { $gte: range.prevStart, $lt: range.prevEnd }
          }
        },
        {
          $group: {
            _id: null,
            totalRecords: { $sum: 1 },
            totalMaterialsUsed: {
              $sum: {
                $add: [
                  { $ifNull: ["$totalQuantityUsed", 0] },
                  { $ifNull: ["$directUsage", 0] }
                ],
              },
            },
            totalProcessedUnits: {
              $sum: {
                $add: [
                  { $ifNull: ["$totalQuantityUsed", 0] },
                  { $ifNull: ["$directUsage", 0] }
                ],
              },
            },
          },
        },
      ]);

      const prevResult = allPrevMonthData[0] || null;
      previousMonthTotalRecords = prevResult?.totalRecords ?? 0;
      previousMonthTotalMaterials = prevResult?.totalMaterialsUsed ?? 0;
      previousMonthProcessedUnits = prevResult?.totalProcessedUnits ?? 0;
    }

    const totalPages = total ? Math.ceil(total / limit) : 0;
    const staff = mapStaff(user);

    // Return response
    ok(res, {
      staff,
      month: parsedQuery.data.month || null,
      search: search || "",
      summary: {
        // Current month summary
        totalRecords: currentMonthTotalRecords,
        totalUsageEntries: currentMonthTotalRecords,
        totalConfiguredStages: currentMonthTotalStages,
        totalAssignedProjects: currentMonthTotalProjects,
        totalMaterialsUsed: currentMonthTotalMaterials,
        totalProcessedUnits: currentMonthProcessedUnits,
        
        // Previous month summary
        totalLastMonthRecords: previousMonthTotalRecords,
        totalLastMonthMaterialsUsed: previousMonthTotalMaterials,
        totalLastMonthProcessedUnits: previousMonthProcessedUnits,
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
      records: rows.map((row) => ({
        id: String(row._id),
        type: "usage",
        date: row.activityAt,
        projectId: String(row.projectId),
        projectCode: row.projectCode,
        projectName: row.projectName,
        stageName: row.stageName || "",
        role: row.staffRole || "",
        note: row.note || "",
        materialCount: Number(row.totalQuantityUsed ?? 0) + Number(row.directUsage ?? 0),
        totalQuantityUsed: Number(row.totalQuantityUsed ?? 0),
        directUsage: Number(row.directUsage ?? 0),
        materials: (row.materials ?? []).map((material) => ({
          projectMaterialId: String(material.projectMaterialId || ""),
          materialName: material.materialName || "Material",
          materialType: material.materialType || "",
          thickness: material.thickness || "",
          quantityUsed: Number(material.quantityUsed || 0),
          unit: material.unit || "units",
        })),
      })),
    });
  } catch (error) {
    console.error("Staff activity error:", error);
    fail(
      res,
      error.name === "CastError" ? 400 : 500,
      error.message || "Failed to load staff activity"
    );
  }
}

export async function handleCreateStaff(req, res) {
  try {
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Invalid staff payload");

    const factoryId = resolveFactoryId(req, parsed.data.factoryId);
    if (!factoryId) return fail(res, 400, "Factory scope is required");
    if (!Types.ObjectId.isValid(factoryId)) return fail(res, 400, "Factory scope is invalid");

    const email = normalizeEmail(parsed.data.email);
    if (!email) return fail(res, 400, "Email is required for staff login");

    const pagePermissions = safePagePermissions(parsed.data.pagePermissions);
    const existingUser = await UserModel.findOne({ email });
    if (existingUser && existingUser.globalRole === "super_admin") {
      return fail(res, 400, "This email already belongs to a super admin account");
    }
    if (
      existingUser?.active === true &&
      existingUser?.factoryId &&
      String(existingUser.factoryId) !== String(factoryId)
    ) {
      return fail(res, 400, "This user already belongs to another factory");
    }
    if (
      existingUser?.active === true &&
      (existingUser.factoryRole === "admin" || existingUser.globalRole === "admin")
    ) {
      return fail(res, 400, "This email already belongs to a factory admin account");
    }

    const nextEmployeeRole = parsed.data.employeeRole ?? parsed.data.role;
    const nextActive = parsed.data.active !== false;
    if (
      req.user?.globalRole !== "super_admin" &&
      nextActive &&
      (!existingUser || existingUser.active !== true)
    ) {
      const limitCheck = await assertFactoryFeatureLimit(factoryId, "staff");
      if (!limitCheck.allowed) {
        return fail(res, 403, limitCheck.state.message || "Staff limit reached");
      }
    }

    const user =
      existingUser ??
      new UserModel({
        name: parsed.data.name,
        email,
        globalRole: "staff",
        factoryRole: "staff",
        factoryId,
        employeeRole: nextEmployeeRole,
        phone: parsed.data.phone || "",
        pagePermissions,
        active: nextActive,
      });

    user.name = parsed.data.name;
    user.email = email;
    user.factoryId = factoryId;
    user.globalRole = user.globalRole === "super_admin" ? "super_admin" : "staff";
    user.factoryRole = "staff";
    user.employeeRole = nextEmployeeRole;
    user.phone = parsed.data.phone || "";
    user.pagePermissions = pagePermissions;
    user.active = nextActive;
    user.deletedAt = null;
    user.deletedBy = null;
    user.deletionReason = "";
    await user.save();

    ok(res, mapStaff(user), "Staff created");
  } catch (error) {
    fail(res, 400, error.message || "Failed to create staff");
  }
}

export async function handleToggleStaffStatus(req, res) {
  const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid staff status payload");

  const user = await loadStaffById(req, routeParam(req.params.id));
  if (!user) return fail(res, 404, "Staff not found");

  const updated = await UserModel.findByIdAndUpdate(
    user._id,
    { active: parsed.data.active, updatedBy: req.user?.id },
    { new: true },
  ).lean();
  if (!updated) return fail(res, 404, "Staff not found");

  ok(res, mapStaff(updated), "Staff status updated");
}

export async function handleUpdateStaff(req, res) {
  try {
    const parsed = staffSchema.partial().safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Invalid staff payload");

    const user = await loadStaffById(req, routeParam(req.params.id));
    if (!user) return fail(res, 404, "Staff not found");

    const email =
      parsed.data.email !== undefined ? normalizeEmail(parsed.data.email) : normalizeEmail(user.email);
    if (email) {
      const emailConflict = await UserModel.findOne({ email,active: true, _id: { $ne: user._id } }).lean();
      if (emailConflict) return fail(res, 400, buildEmailConflictMessage(emailConflict));
    }

    const nextEmployeeRole =
      parsed.data.employeeRole !== undefined
        ? parsed.data.employeeRole
        : parsed.data.role !== undefined
          ? parsed.data.role
          : user.employeeRole;
    const nextPagePermissions =
      parsed.data.pagePermissions !== undefined ? safePagePermissions(parsed.data.pagePermissions) : user.pagePermissions;

    const updated = await UserModel.findByIdAndUpdate(
      user._id,
      {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone || "" } : {}),
        ...(email ? { email } : {}),
        ...(parsed.data.employeeRole !== undefined || parsed.data.role !== undefined
          ? { employeeRole: nextEmployeeRole }
          : {}),
        ...(parsed.data.pagePermissions !== undefined ? { pagePermissions: nextPagePermissions } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        ...(parsed.data.active === true
          ? {
              deletedAt: null,
              deletedBy: null,
              deletionReason: "",
            }
          : {}),
        updatedBy: req.user?.id,
      },
      { new: true },
    ).lean();

    if (!updated) return fail(res, 404, "Staff not found");
    ok(res, mapStaff(updated), "Staff updated");
  } catch (error) {
    fail(res, 400, error.message || "Failed to update staff");
  }
}

export async function handleDeleteStaff(req, res) {
  try {
    const user = await loadStaffById(req, routeParam(req.params.id));
    if (!user) return fail(res, 404, "Staff not found");

    const updated = await UserModel.findByIdAndUpdate(
      user._id,
      {
        active: false,
        deletedAt: new Date(),
        deletedBy: req.user?.id,
        deletionReason: "Deleted by factory admin",
        updatedBy: req.user?.id,
      },
      { new: true },
    ).lean();
    if (!updated) return fail(res, 404, "Staff not found");

    ok(res, { message: "Staff removed" });
  } catch (error) {
    fail(res, 400, error.message || "Failed to remove staff");
  }
}
