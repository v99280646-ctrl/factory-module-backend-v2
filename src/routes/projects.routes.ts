import { Router, type Request } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { CustomerModel } from "../models/customer.model.js";
import { ProjectModel } from "../models/project.model.js";
import { StaffModel } from "../models/staff.model.js";
import { StaffUsageLogModel } from "../models/staff-usage-log.model.js";
import { fail, ok } from "../utils/api-response.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import { StockModel } from "../models/stock.model.js";
import { UserModel } from "../models/user.model.js";

export const projectsRoutes = Router();

projectsRoutes.use(
  requireAuth,
  requireRole("super_admin", "admin", "staff"),
  requireFactoryScope,
);

const projectSchema = z.object({
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  customerName: z.string().min(1),
  customerId: z.string().optional().nullable(),
  status: z
    .enum(["ongoing", "hold", "completed", "cancelled"])
    .default("ongoing"),
  progress: z.number().min(0).max(100).default(0),
  delivery: z
    .string()
    .optional()
    .nullable()
    .refine((val) => {
      if (!val) return true;
      try {
        const date = new Date(val);
        return !isNaN(date.getTime());
      } catch {
        return false;
      }
    }, "Invalid date format"),
  amount: z.number().nonnegative().default(0),
  notes: z.string().optional().nullable(),
  workType: z.string().default("own"),
  materials: z
    .array(
      z.object({
        id: z.string().optional(),
        source: z.enum(["inventory", "new-stock"]),
        stockItemId: z.string().optional().nullable(),
        materialName: z.string(),
        materialType: z.string(),
        thickness: z.string().optional(),
        quantity: z.number().positive(),
        unit: z.string(),
      }),
    )
    .optional(),
  services: z
    .array(
      z.object({
        id: z.string().optional(),
        serviceId: z.string().optional().nullable(),
        serviceName: z.string(),
        unit: z.string().optional(),
      }),
    )
    .optional(),
});

const workflowSchema = z.object({
  stages: z.array(z.record(z.string(), z.unknown())),
});

const stageAllocationSchema = z.object({
  role: z.string().optional(),
  staffName: z.string().optional(),
  materials: z
    .array(
      z.object({
        projectMaterialId: z.string().min(1),
        requiredQuantity: z.number().positive(),
      }),
    )
    .min(1)
    .refine(
      (materials) =>
        new Set(materials.map((material) => material.projectMaterialId))
          .size === materials.length,
      "Each project material can only be allocated once",
    ),
});

const stageUsageSchema = z.object({
  role: z.string().optional(),
  staffName: z.string().optional(),
  note: z.string().optional(),
  stageStatus: z.string().optional(),
  materials: z
    .array(
      z.object({
        projectMaterialId: z.string().min(1),
        quantityUsed: z.number().positive(),
      }),
    )
    .default([])
    .refine(
      (materials) =>
        new Set(materials.map((material) => material.projectMaterialId))
          .size === materials.length,
      "Each project material can only be submitted once",
    ),
});

function projectFilter(req: Request) {
  return req.user?.globalRole === "super_admin"
    ? {}
    : { factoryId: req.factoryId };
}

function mapProject(project: any, userId?: string) {
  const row = project?.toObject ? project.toObject() : project;
  const assignedStaffIds = (row.assignedStaffIds ?? []).map(String);
  return {
    ...row,
    id: String(row._id),
    assignedToMe: userId ? assignedStaffIds.includes(userId) : false,
    materials: (row.materials ?? []).map((material: any) => ({
      ...material,
      id: materialId(material),
    })),
    services: (row.services ?? []).map((service: any) => ({
      ...service,
      id: String(service.id ?? service._id ?? ""),
    })),
    workflowStages: (row.workflowStages ?? []).map((stage: any) => ({
      ...stage,
      id: String(stage.id ?? stage._id ?? stage.name ?? ""),
    })),
  };
}

function mapCustomerDetails(row: any) {
  if (!row) return null;
  return {
    id: String(row._id),
    company: row.company || row.companyName || "",
    contact: row.contact || row.name || "",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    state: row.state || "",
    district: row.district || "",
    pincode: row.pincode || row.zipCode || "",
    gstin: row.gstin || row.taxId || "",
  };
}

async function enrichProjectDetail(project: any, req: Request) {
  const mapped = mapProject(project, req.user?.id);
  const row = project?.toObject ? project.toObject() : project;
  const assignedStaffIds = (row.assignedStaffIds ?? []).map(String).filter(Boolean);

  const customerQuery =
    row.customerId
      ? CustomerModel.findOne({ _id: row.customerId, ...projectFilter(req) }).lean()
      : row.customerName
        ? CustomerModel.findOne({
            ...projectFilter(req),
            $or: [{ company: row.customerName }, { companyName: row.customerName }],
          }).lean()
        : Promise.resolve(null);

  const [assignedUsers, customer] = await Promise.all([
    assignedStaffIds.length
      ? UserModel.find({ _id: { $in: assignedStaffIds } }, { name: 1, email: 1 }).lean()
      : Promise.resolve([]),
    customerQuery,
  ]);

  const assignedUserById = new Map(
    assignedUsers.map((user) => [
      String(user._id),
      {
        id: String(user._id),
        name: user.name || user.email || "Staff",
        email: user.email || "",
      },
    ]),
  );

  const assignedStaff: Array<{ id?: string; name: string; email?: string; role?: string }> = [];
  const seenStaff = new Set<string>();
  const pushStaff = (staff?: { id?: string; name?: string; email?: string; role?: string }) => {
    const name = staff?.name?.trim();
    if (!name) return;
    const key = staff?.id || name.toLowerCase();
    if (seenStaff.has(key)) return;
    seenStaff.add(key);
    assignedStaff.push({
      id: staff?.id,
      name,
      email: staff?.email || "",
      role: staff?.role || "",
    });
  };

  assignedStaffIds.forEach((id: string) => {
    pushStaff({ ...assignedUserById.get(id), role: "Assigned" });
  });

  (row.workflowStages ?? []).forEach((stage: any) => {
    pushStaff({
      id: stage?.configuredBy?.userId ? String(stage.configuredBy.userId) : undefined,
      name: stage?.configuredBy?.staffName,
      role: stage?.configuredBy?.role || stage?.name || "Configured",
    });

    (stage?.usageHistory ?? []).forEach((entry: any) => {
      pushStaff({
        id: entry?.userId ? String(entry.userId) : undefined,
        name: entry?.staffName,
        role: entry?.role || stage?.name || "Updated",
      });
    });
  });

  return {
    ...mapped,
    assignedStaffIds,
    assignedStaff,
    customerDetails: mapCustomerDetails(customer),
  };
}

function routeParam(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function materialId(material: any) {
  return String(material.id ?? material._id ?? "");
}

function stageTotals(materials: any[]) {
  return {
    completed: materials.reduce(
      (sum, material) => sum + Number(material.completedQuantity ?? 0),
      0,
    ),
    total: materials.reduce(
      (sum, material) => sum + Number(material.requiredQuantity ?? 0),
      0,
    ),
  };
}

async function resolveStaffContext(input: {
  factoryId?: string | null;
  userId?: string;
  staffName?: string;
}) {
  if (!input.factoryId) return null;

  const clauses: Array<Record<string, unknown>> = [];
  if (input.userId) clauses.push({ userId: input.userId });
  if (input.staffName?.trim()) clauses.push({ name: input.staffName.trim() });
  if (!clauses.length) return null;

  return StaffModel.findOne({
    factoryId: input.factoryId,
    $or: clauses,
  }).lean();
}

projectsRoutes.get(
  "/",
  requirePagePermission("projects", "view"),
  async (req, res) => {
    try {
      const filter =
        req.user?.globalRole === "super_admin"
          ? {}
          : { factoryId: req.factoryId };
      if (req.query.scope === "mine" && req.user?.globalRole === "staff") {
        Object.assign(filter, { assignedStaffIds: req.user.id });
      }
      const projects = await ProjectModel.find(filter)
        .sort({ createdAt: -1 })
        .lean();
      // Map _id to id for frontend consistency
      ok(
        res,
        projects.map((project) => mapProject(project, req.user?.id)),
      );
    } catch (error: any) {
      fail(res, 500, error.message);
    }
  },
);

projectsRoutes.get(
  "/:id",
  requirePagePermission("projects", "view"),
  async (req, res) => {
    const project = await ProjectModel.findOne({
      _id: req.params.id,
      ...projectFilter(req),
    }).lean();
    if (!project) return fail(res, 404, "Project not found");
    ok(res, await enrichProjectDetail(project, req));
  },
);

projectsRoutes.post(
  "/:id/assign-self",
  requirePagePermission("projects", "view"),
  async (req, res) => {
    if (req.user?.globalRole !== "staff") {
      return fail(res, 403, "Only staff can add projects to My Projects");
    }
    const project = await ProjectModel.findOneAndUpdate(
      { _id: req.params.id, ...projectFilter(req) },
      { $addToSet: { assignedStaffIds: req.user.id } },
      { new: true },
    ).lean();
    if (!project) return fail(res, 404, "Project not found");
    ok(res, mapProject(project, req.user.id), "Project added to My Projects");
  },
);

projectsRoutes.delete(
  "/:id/assign-self",
  requirePagePermission("projects", "view"),
  async (req, res) => {
    if (req.user?.globalRole !== "staff") {
      return fail(res, 403, "Only staff can remove projects from My Projects");
    }
    const project = await ProjectModel.findOneAndUpdate(
      { _id: req.params.id, ...projectFilter(req) },
      { $pull: { assignedStaffIds: req.user.id } },
      { new: true },
    ).lean();
    if (!project) return fail(res, 404, "Project not found");
    ok(
      res,
      mapProject(project, req.user.id),
      "Project removed from My Projects",
    );
  },
);

projectsRoutes.post(
  "/",
  requirePagePermission("projects", "add"),
  async (req, res) => {
    try {
      const parsed = projectSchema.safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Invalid project payload");
      if (req.user?.globalRole !== "super_admin" && !req.factoryId) {
        return fail(res, 400, "Factory scope is required");
      }

      const code =
        parsed.data.code || `P${Date.now().toString().slice(-8).toUpperCase()}`;

      const created = await ProjectModel.create({
        factoryId: req.factoryId,
        code: code.toUpperCase(),
        ...parsed.data,
        delivery: parsed.data.delivery
          ? new Date(parsed.data.delivery)
          : undefined,
      });
      ok(res, mapProject(created, req.user?.id), "Project created");
    } catch (error: any) {
      fail(res, 400, error.message);
    }
  },
);

projectsRoutes.patch(
  "/:id/workflow",
  requirePagePermission("projects", "update"),
  async (req, res) => {
    const parsed = workflowSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Invalid workflow payload");

    const updated = await ProjectModel.findOneAndUpdate(
      { _id: req.params.id, ...projectFilter(req) },
      { workflowStages: parsed.data.stages },
      { new: true },
    ).lean();
    if (!updated) return fail(res, 404, "Project not found");
    ok(res, mapProject(updated, req.user?.id), "Project workflow updated");
  },
);

projectsRoutes.post(
  "/:id/stages/:stage/allocation",
  requirePagePermission("projects", "update"),
  async (req, res) => {
    try {
      const parsed = stageAllocationSchema.safeParse(req.body);
      if (!parsed.success)
        return fail(res, 400, "Invalid stage allocation payload");

      const project = await ProjectModel.findOne({
        _id: req.params.id,
        ...projectFilter(req),
      });
      if (!project) return fail(res, 404, "Project not found");

      const stages = [...((project.workflowStages as any[]) ?? [])];
      const stageName = routeParam(req.params.stage);
      let stageIndex = stages.findIndex(
        (stage) => String(stage.name).toLowerCase() === stageName.toLowerCase(),
      );

      const projectMaterials = (project.materials as any[]) ?? [];
      const existingStage = stageIndex >= 0 ? stages[stageIndex] : null;
      const existingByMaterial = new Map(
        (existingStage?.materials ?? []).map((material: any) => [
          String(material.projectMaterialId),
          material,
        ]),
      );
      const allocatedMaterials = parsed.data.materials.map((allocation) => {
        const material = projectMaterials.find(
          (item) => materialId(item) === allocation.projectMaterialId,
        );
        if (!material) {
          throw new Error(
            `Project material ${allocation.projectMaterialId} was not found`,
          );
        }
        if (allocation.requiredQuantity > Number(material.quantity ?? 0)) {
          throw new Error(
            `${material.materialName || material.materialType} cannot exceed the project quantity`,
          );
        }
        const previous = existingByMaterial.get(
          allocation.projectMaterialId,
        ) as any;
        const completedQuantity = Number(previous?.completedQuantity ?? 0);
        if (allocation.requiredQuantity < completedQuantity) {
          throw new Error(
            `${material.materialName || material.materialType} requirement cannot be below already used quantity`,
          );
        }
        return {
          projectMaterialId: allocation.projectMaterialId,
          stockItemId: material.stockItemId ?? null,
          materialName: material.materialName ?? "Material",
          materialType: material.materialType ?? "",
          thickness: material.thickness ?? "",
          requiredQuantity: allocation.requiredQuantity,
          completedQuantity,
          unit: material.unit ?? "units",
        };
      });
      const totals = stageTotals(allocatedMaterials);
      const nextStage = {
        ...(existingStage ?? {}),
        id:
          existingStage?.id ??
          `${stageName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`,
        name: stageName,
        sortOrder: existingStage?.sortOrder ?? stages.length,
        materials: allocatedMaterials,
        ...totals,
        configuredBy: {
          userId: req.user?.id,
          role: parsed.data.role,
          staffName: parsed.data.staffName,
          configuredAt: new Date(),
        },
      };
      if (stageIndex >= 0) stages[stageIndex] = nextStage;
      else {
        stages.push(nextStage);
        stageIndex = stages.length - 1;
      }
      project.workflowStages = stages;
      await project.save();
      ok(
        res,
        mapProject(project, req.user?.id),
        "Stage material allocation updated",
      );
    } catch (error: any) {
      fail(res, 400, error.message);
    }
  },
);

projectsRoutes.post(
  "/:id/stages/:stage/usage",
  requirePagePermission("projects", "update"),
  async (req, res) => {
    const parsed = stageUsageSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Invalid stage usage payload");

    const project = await ProjectModel.findOne({
      _id: req.params.id,
      ...projectFilter(req),
    });
    if (!project) return fail(res, 404, "Project not found");

    const stages = [...((project.workflowStages as any[]) ?? [])];
    const stageName = routeParam(req.params.stage);
    const stageIndex = stages.findIndex(
      (stage) => String(stage.name).toLowerCase() === stageName.toLowerCase(),
    );
    if (stageIndex < 0) return fail(res, 404, "Workflow stage not found");

    const stageMaterials = [...(stages[stageIndex].materials ?? [])];
    const usageByMaterial = new Map(
      parsed.data.materials.map((usage) => [
        usage.projectMaterialId,
        usage.quantityUsed,
      ]),
    );
    const stageStatus = parsed.data.stageStatus?.trim();
    const hasStatusUpdate = Boolean(stageStatus);
    const stockDeductions = new Map<string, number>();
    const hasMaterialUsage = parsed.data.materials.length > 0;

    if (!hasMaterialUsage && !hasStatusUpdate && !parsed.data.note?.trim()) {
      return fail(
        res,
        400,
        "Add material usage, update the stage status, or add a note",
      );
    }

    const unknownUsage = parsed.data.materials.find(
      (usage) =>
        !stageMaterials.some(
          (material) =>
            String(material.projectMaterialId) === usage.projectMaterialId,
        ),
    );
    if (unknownUsage)
      return fail(
        res,
        400,
        "Submitted material is not allocated to this stage",
      );

    for (const material of stageMaterials) {
      const quantityUsed =
        usageByMaterial.get(String(material.projectMaterialId)) ?? 0;
      if (!quantityUsed) continue;
      const remaining =
        Number(material.requiredQuantity ?? 0) -
        Number(material.completedQuantity ?? 0);
      if (quantityUsed > remaining) {
        return fail(
          res,
          400,
          `${material.materialName || "Material"} usage cannot exceed the remaining ${remaining} ${material.unit || "units"}`,
        );
      }
      if (material.stockItemId) {
        const stockId = String(material.stockItemId);
        stockDeductions.set(
          stockId,
          (stockDeductions.get(stockId) ?? 0) + quantityUsed,
        );
      }
    }

    for (const [stockId, quantity] of stockDeductions) {
      const stock = await StockModel.findOne({
        _id: stockId,
        ...projectFilter(req),
      }).lean();
      if (!stock) return fail(res, 404, "Allocated stock item was not found");
      if (Number(stock.quantity ?? 0) < quantity) {
        return fail(
          res,
          400,
          `${stock.name} has only ${stock.quantity} ${stock.unit} available`,
        );
      }
    }

    for (const usage of parsed.data.materials) {
      const materialIndex = stageMaterials.findIndex(
        (item) => String(item.projectMaterialId) === usage.projectMaterialId,
      );
      if (materialIndex < 0) continue;
      const material = stageMaterials[materialIndex];
      stageMaterials[materialIndex] = {
        ...material,
        completedQuantity:
          Number(material.completedQuantity ?? 0) + usage.quantityUsed,
      };
    }

    if (stockDeductions.size) {
      await StockModel.bulkWrite(
        [...stockDeductions].map(([stockId, quantity]) => ({
          updateOne: {
            filter: { _id: stockId, ...projectFilter(req) },
            update: { $inc: { quantity: -quantity } },
          },
        })),
      );
    }

    const usageRecord = {
      id: `usage-${Date.now()}`,
      userId: req.user?.id,
      role: parsed.data.role,
      staffName: parsed.data.staffName,
      note: parsed.data.note,
      stageStatus: stageStatus || undefined,
      createdAt: new Date(),
      materials: parsed.data.materials.map((usage) => {
        const material = stageMaterials.find(
          (item) => String(item.projectMaterialId) === usage.projectMaterialId,
        );
        return {
          projectMaterialId: usage.projectMaterialId,
          materialName: material?.materialName ?? "Material",
          materialType: material?.materialType ?? "",
          thickness: material?.thickness ?? "",
          quantityUsed: usage.quantityUsed,
          unit: material?.unit ?? "units",
        };
      }),
    };
    const totals = stageTotals(stageMaterials);

    stages[stageIndex] = {
      ...stages[stageIndex],
      materials: stageMaterials,
      ...totals,
      staffStatus: stageStatus || stages[stageIndex].staffStatus || "In progress",
      usageHistory: [usageRecord, ...(stages[stageIndex].usageHistory ?? [])],
      lastUpdate: usageRecord,
    };
    project.workflowStages = stages;
    const allStageMaterials = stages.flatMap((stage) => stage.materials ?? []);
    const projectTotals = stageTotals(allStageMaterials);
    project.progress = projectTotals.total
      ? Math.min(
          100,
          Math.round((projectTotals.completed / projectTotals.total) * 100),
        )
      : project.progress;
    await project.save();
    const staffContext = await resolveStaffContext({
      factoryId: req.factoryId,
      userId: req.user?.id,
      staffName: parsed.data.staffName,
    });
    await StaffUsageLogModel.findOneAndUpdate(
      {
        factoryId: req.factoryId,
        sourceRecordId: usageRecord.id,
      },
      {
        factoryId: req.factoryId,
        staffId: staffContext?._id,
        userId: req.user?.id,
        staffName: parsed.data.staffName || staffContext?.name || "Staff",
        staffEmail: staffContext?.email || "",
        staffRole: parsed.data.role || staffContext?.role || "",
        projectId: project._id,
        projectCode: project.code,
        projectName: project.name,
        stageName,
        note: parsed.data.note || "",
        totalQuantityUsed: usageRecord.materials.reduce(
          (sum, material) => sum + Number(material.quantityUsed ?? 0),
          0,
        ),
        sourceRecordId: usageRecord.id,
        activityAt: usageRecord.createdAt,
        materials: usageRecord.materials,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    ok(res, mapProject(project, req.user?.id), "Project usage updated");
  },
);

projectsRoutes.patch(
  "/:id",
  requirePagePermission("projects", "edit"),
  async (req, res) => {
    try {
      const parsed = projectSchema.partial().safeParse(req.body);
      if (!parsed.success) return fail(res, 400, "Invalid project payload");

      const update: any = { ...parsed.data };
      if (parsed.data.delivery) {
        update.delivery = new Date(parsed.data.delivery);
      }

      // CRITICAL: Ensure factoryId check for security
      const filter =
        req.user?.globalRole === "super_admin"
          ? { _id: req.params.id }
          : { _id: req.params.id, factoryId: req.factoryId };
      const updated = await ProjectModel.findOneAndUpdate(filter, update, {
        new: true,
      }).lean();

      if (!updated) return fail(res, 404, "Project not found");
      ok(res, mapProject(updated, req.user?.id), "Project updated");
    } catch (error: any) {
      fail(res, 400, error.message);
    }
  },
);

projectsRoutes.delete(
  "/:id",
  requirePagePermission("projects", "delete"),
  async (req, res) => {
    try {
      const filter =
        req.user?.globalRole === "super_admin"
          ? { _id: req.params.id }
          : { _id: req.params.id, factoryId: req.factoryId };
      const deleted = await ProjectModel.findOneAndDelete(filter).lean();
      if (!deleted) return fail(res, 404, "Project not found");
      ok(res, { message: "Project deleted" });
    } catch (error: any) {
      fail(res, 400, error.message);
    }
  },
);
