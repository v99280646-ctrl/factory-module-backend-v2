import { Router } from "express";
import { z } from "zod";
import { ok, fail } from "../utils/api-response.js";
import {
  buildSessionForUser,
  hasGoogleAuthConfigured,
  StaffAccessNotAssignedError,
  upsertGoogleUser,
  verifyGoogleCredential,
} from "../services/auth.service.js";
import { FactoryModel } from "../models/factory.model.js";
import { MembershipModel, FULL_PAGE_PERMISSIONS } from "../models/membership.model.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  syncStaffMembershipsForUser,
  syncUserStaffMemberships,
} from "../services/staff-membership.service.js";

export const authRoutes = Router();

const googleLoginSchema = z.object({
  credential: z.string().min(1),
});

authRoutes.post("/google", async (req, res) => {
  if (!hasGoogleAuthConfigured()) {
    return fail(
      res,
      500,
      "Google auth is not configured on the backend. Set GOOGLE_CLIENT_ID and JWT_SECRET.",
    );
  }

  const parsed = googleLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return fail(res, 400, "Invalid login payload");
  }

  try {
    const googleUser = await verifyGoogleCredential(parsed.data.credential);
    const { user, isNewUser } = await upsertGoogleUser(googleUser);
    // If this is a brand new user, only create an initial factory and membership
    // when the system has no factories yet (first user signing up). This avoids
    // creating a new factory for every staff member who signs in via Google.
    if (isNewUser) {
      const existingCount = await FactoryModel.countDocuments();
      if (existingCount === 0) {
        const baseName = String(user.name || user.email || "My Factory").slice(0, 64);
        const code = baseName
          .replace(/[^a-z0-9]+/gi, "")
          .slice(0, 8)
          .toUpperCase() || `F${Date.now().toString().slice(-6)}`;

        const createdFactory = await FactoryModel.create({ name: baseName, code });
        await MembershipModel.create({
          userId: String(user._id),
          factoryId: createdFactory._id,
          role: "admin",
          accessLevel: "full",
          pagePermissions: FULL_PAGE_PERMISSIONS,
          active: true,
        });
      }
    }

    if (user.globalRole === "staff") {
      await syncUserStaffMemberships(String(user._id), user.email);
    }

    const session = await buildSessionForUser(String(user._id), isNewUser);
    ok(res, session);
  } catch (error) {
    return fail(
      res,
      error instanceof StaffAccessNotAssignedError ? error.status : 401,
      error instanceof Error ? error.message : "Login failed",
    );
  }
});

authRoutes.get("/me", requireAuth, async (req, res) => {
  if (!req.user?.id) {
    return fail(res, 401, "Unauthorized");
  }

  try {
    await syncStaffMembershipsForUser(req.user.id);
    const session = await buildSessionForUser(req.user.id);
    ok(res, session);
  } catch (error) {
    fail(
      res,
      error instanceof StaffAccessNotAssignedError ? error.status : 500,
      error instanceof Error ? error.message : "Unable to load session",
    );
  }
});

authRoutes.post("/logout", (_req, res) => {
  ok(res, { message: "Logged out" });
});
