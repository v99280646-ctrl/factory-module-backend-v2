import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireRole } from "../middleware/role.middleware.js";
import {
  handleAssignFactorySubscription,
  handleCancelFactorySubscription,
  handleCreateSubscriptionPlan,
  handleGetFactorySubscriptionHistory,
  handleListFactorySubscriptions,
  handleListSubscriptionHistory,
  handleListSubscriptionPlans,
  handleRenewFactorySubscription,
  handleUpdateSubscriptionPlan,
} from "../controllers/subscriptions/subscriptions.controller.js";

export const subscriptionRoutes = Router();

subscriptionRoutes.use(requireAuth, requireRole("super_admin"));
subscriptionRoutes.get("/plans", handleListSubscriptionPlans);
subscriptionRoutes.post("/plans", handleCreateSubscriptionPlan);
subscriptionRoutes.patch("/plans/:id", handleUpdateSubscriptionPlan);
subscriptionRoutes.get("/factories", handleListFactorySubscriptions);
subscriptionRoutes.get("/factories/:factoryId/history", handleGetFactorySubscriptionHistory);
subscriptionRoutes.get("/history", handleListSubscriptionHistory);
subscriptionRoutes.post("/factories/:factoryId/assign", handleAssignFactorySubscription);
subscriptionRoutes.post("/factories/:factoryId/renew", handleRenewFactorySubscription);
subscriptionRoutes.post("/factories/:factoryId/cancel", handleCancelFactorySubscription);
