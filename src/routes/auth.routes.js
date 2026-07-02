import { Router } from "express";
import { z } from "zod";
import { ok, fail } from "../utils/api-response.js";
import { AccountDeactivatedError, buildSessionForUser, hasGoogleAuthConfigured, StaffAccessNotAssignedError, upsertGoogleUser, verifyGoogleCredential, } from "../services/auth.service.js";
import { FactoryModel } from "../models/factory.model.js";
import { FULL_PAGE_PERMISSIONS } from "../models/membership.model.js";
import { UserModel } from "../models/user.model.js";
import { ensureFactoryDefaultSubscription } from "../services/subscription.service.js";
import { ensureDefaultFactoryServices } from "../services/default-services.service.js";
import { requireAuth } from "../middleware/auth.middleware.js";
export const authRoutes = Router();
const googleLoginSchema = z.object({
    credential: z.string().min(1),
});
const deleteAccountSchema = z.object({
    reason: z.string().trim().max(500).optional().nullable(),
});
authRoutes.post("/google", async (req, res) => {
    if (!hasGoogleAuthConfigured()) {
        return fail(res, 500, "Google auth is not configured on the backend. Set GOOGLE_CLIENT_ID and JWT_SECRET.");
    }
    const parsed = googleLoginSchema.safeParse(req.body);
    if (!parsed.success) {
        return fail(res, 400, "Invalid login payload");
    }
    try {
        const googleUser = await verifyGoogleCredential(parsed.data.credential);
        const { user, isNewUser } = await upsertGoogleUser(googleUser);
        // If an admin user (new or existing) has no factory, create and assign one.
        // This handles the edge case where a user is promoted to admin but not given a factory.
        const isAdminWithoutFactory = user.globalRole === "admin" && !user.factoryId;

        if (isAdminWithoutFactory) {
            const baseName = String(user.name || user.email || "My Factory").slice(0, 64);
            // Add a random suffix to ensure the factory code is unique.
            const uniqueSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
            const baseCode = baseName.replace(/[^a-z0-9]+/gi, "").slice(0, 4).toUpperCase();
            const code = `${baseCode || "FACT"}-${uniqueSuffix}`;

            const createdFactory = await FactoryModel.create({
                name: baseName,
                code,
                createdBy: user._id,
                updatedBy: user._id,
            });
            await UserModel.findByIdAndUpdate(user._id, {
                factoryId: createdFactory._id,
                factoryRole: "admin",
                pagePermissions: FULL_PAGE_PERMISSIONS,
                active: true,
            });
            await ensureDefaultFactoryServices(createdFactory._id, user._id);
            await ensureFactoryDefaultSubscription(createdFactory._id, user._id);
        }
        const session = await buildSessionForUser(String(user._id), isNewUser);
        ok(res, session);
    }
    catch (error) {
        console.error("Google login failed", error);
        return fail(res, error instanceof StaffAccessNotAssignedError || error instanceof AccountDeactivatedError ? error.status : 401, error instanceof Error ? error.message : "Login failed");
    }
});
authRoutes.get("/me", requireAuth, async (req, res) => {
    if (!req.user?.id) {
        return fail(res, 401, "Unauthorized");
    }
    try {
        const session = await buildSessionForUser(req.user.id);
        ok(res, session);
    }
    catch (error) {
        fail(res, error instanceof StaffAccessNotAssignedError || error instanceof AccountDeactivatedError ? error.status : 500, error instanceof Error ? error.message : "Unable to load session");
    }
});
authRoutes.post("/logout", (_req, res) => {
    ok(res, { message: "Logged out" });
});
authRoutes.delete("/account", requireAuth, async (req, res) => {
    const parsed = deleteAccountSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
        return fail(res, 400, "Invalid delete account payload");
    }
    try {
        const user = await UserModel.findById(req.user?.id);
        if (!user || user.active !== true) {
            return fail(res, 404, "User not found");
        }
        if (user.globalRole === "staff" || user.factoryRole === "staff") {
            return fail(res, 403, "Staff accounts cannot use self-delete");
        }
        const deletionReason = parsed.data.reason || "Self deleted";
        if (user.factoryId && user.factoryRole === "admin" && user.globalRole !== "super_admin") {
            await UserModel.updateMany(
                { factoryId: user.factoryId, active: true },
                {
                    $set: {
                        active: false,
                        deletedAt: new Date(),
                        deletedBy: user._id,
                        deletionReason,
                    },
                },
            );
            await FactoryModel.findByIdAndUpdate(user.factoryId, {
                status: "inactive",
                updatedBy: user._id,
            });
            return ok(
                res,
                { success: true, scope: "factory" },
                "Factory admin account deleted successfully. All factory users were deactivated.",
            );
        }
        user.active = false;
        user.deletedAt = new Date();
        user.deletedBy = user._id;
        user.deletionReason = deletionReason;
        await user.save();
        ok(res, { success: true }, "Account deleted successfully");
    }
    catch (error) {
        fail(res, 500, error instanceof Error ? error.message : "Unable to delete account");
    }
});
