import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireFactoryScope } from "../middleware/factory-scope.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import { requirePagePermission } from "../middleware/page-permission.middleware.js";
import {
  handleAssignProjectToSelf,
  handleCreateProject,
  handleDeleteProject,
  handleGetProject,
  handleListProjects,
  handleMarkProjectDelivered,
  handleUnassignProjectFromSelf,
  handleUpdateAssignedStaffStatus,
  handleUpdateProject,
  handleUpdateProjectStageAllocation,
  handleUpdateProjectStageUsage,
  handleUpdateProjectWorkflow,
} from "../controllers/projects/projects.controller.js";

export const projectsRoutes = Router();

projectsRoutes.use(requireAuth, requireRole("super_admin", "admin", "staff"), requireFactoryScope);
projectsRoutes.get("/", requirePagePermission("projects", "view"), handleListProjects);
projectsRoutes.get("/:id", requirePagePermission("projects", "view"), handleGetProject);
projectsRoutes.post("/:id/assign-self", requirePagePermission("projects", "view"), handleAssignProjectToSelf);
projectsRoutes.delete("/:id/assign-self", requirePagePermission("projects", "view"), handleUnassignProjectFromSelf);
projectsRoutes.patch("/:id/assigned-staff/:userId/status", requirePagePermission("projects", "view"), handleUpdateAssignedStaffStatus);
projectsRoutes.post("/", requirePagePermission("projects", "add"), handleCreateProject);
projectsRoutes.patch("/:id/workflow", requirePagePermission("projects", "update"), handleUpdateProjectWorkflow);
projectsRoutes.post("/:id/stages/:stage/allocation", requirePagePermission("projects", "update"), handleUpdateProjectStageAllocation);
projectsRoutes.post("/:id/stages/:stage/usage", requirePagePermission("projects", "update"), handleUpdateProjectStageUsage);
projectsRoutes.post("/:id/deliver", requirePagePermission("projects", "update"), handleMarkProjectDelivered);
projectsRoutes.patch("/:id", requirePagePermission("projects", "edit"), handleUpdateProject);
projectsRoutes.delete("/:id", requirePagePermission("projects", "delete"), handleDeleteProject);
