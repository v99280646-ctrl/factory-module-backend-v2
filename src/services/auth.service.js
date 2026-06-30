import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { FactoryModel } from "../models/factory.model.js";
import { FULL_PAGE_PERMISSIONS, PAGE_ACTIONS, PAGE_NAMES, } from "../models/membership.model.js";
import { UserModel } from "../models/user.model.js";
const googleClient = env.googleClientId
    ? new OAuth2Client(env.googleClientId)
    : null;
export class StaffAccessNotAssignedError extends Error {
    status = 403;
    constructor(email) {
        super(`No factory access is assigned to ${email}. Ask a factory admin to add this exact Google email.`);
        this.name = "StaffAccessNotAssignedError";
    }
}
function signToken(payload) {
    if (!env.jwtSecret) {
        throw new Error("JWT_SECRET is missing");
    }
    return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
}
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
function normalizePagePermissions(value) {
    return Object.fromEntries(PAGE_NAMES.flatMap((page) => {
        const actions = (value?.[page] ?? []).filter((action) => PAGE_ACTIONS.includes(action));
        return actions.length ? [[page, actions]] : [];
    }));
}
function isSuperAdminEmail(email) {
    return normalizeEmail(email) === "muhammedraheem144@gmail.com";
}
async function buildMembershipFromUser(user) {
    const factory = user.factoryId
        ? await FactoryModel.findById(user.factoryId).lean()
        : null;
    const role = user.factoryRole ?? (user.globalRole === "admin" ? "admin" : "staff");
    const normalizedPermissions = role === "admin"
        ? FULL_PAGE_PERMISSIONS
        : normalizePagePermissions(user.pagePermissions);
    return {
        id: String(user._id),
        factoryId: String(user.factoryId),
        role: role === "admin" ? "admin" : "staff",
        accessLevel: role === "admin" ? "full" : "view",
        employeeName: user.name ?? undefined,
        phone: user.phone || undefined,
        employeeRole: user.employeeRole ?? undefined,
        pagePermissions: normalizedPermissions,
        status: user.active ? "active" : "inactive",
        active: user.active,
        factory: factory
            ? {
                id: String(factory._id),
                name: factory.name,
                code: factory.code,
                status: factory.status,
            }
            : {
                id: String(user.factoryId),
                name: "Unknown Factory",
                code: "UNKNOWN",
            },
    };
}
export async function verifyGoogleCredential(credential) {
    if (!googleClient) {
        throw new Error("Backend GOOGLE_CLIENT_ID is missing");
    }
    const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: env.googleClientId,
    });
    const payload = ticket.getPayload();
    const email = payload?.email;
    const name = payload?.name || payload?.given_name || email;
    if (!email || !name) {
        throw new Error("Google account did not return email and name");
    }
    return { email, name, googleId: payload?.sub };
}
export function hasGoogleAuthConfigured() {
    return Boolean(env.googleClientId && env.jwtSecret);
}
export async function buildSessionForUser(userId, isNewUser = false) {
    const user = await UserModel.findById(userId).lean();
    if (!user) {
        throw new Error("User not found");
    }
    if (user.globalRole !== "super_admin" && !user.factoryId) {
        throw new StaffAccessNotAssignedError(user.email);
    }
    const membership = user.globalRole === "super_admin"
        ? null
        : user.factoryId
            ? await buildMembershipFromUser(user)
            : null;
    const globalRole = user.globalRole;
    const primaryRole = globalRole === "super_admin"
        ? "super_admin"
        : membership?.role === "admin"
            ? "admin"
            : "staff";
    return {
        token: signToken({
            userId: String(user._id),
            globalRole,
            factoryId: user.factoryId ? String(user.factoryId) : null,
        }),
        profile: {
            id: String(user._id),
            name: user.name,
            email: user.email,
            globalRole,
            active: user.active,
            factoryId: user.factoryId ? String(user.factoryId) : null,
        },
        memberships: membership ? [membership] : [],
        primaryRole,
        isNewUser,
    };
}
export async function upsertGoogleUser(input) {
    try {
        const email = normalizeEmail(input.email);
        const existing = await UserModel.findOne({ email });
        const targetRole = isSuperAdminEmail(email) ? "super_admin" : "admin";
        console.log("targetRole", targetRole);
        if (existing) {
            existing.name = input.name;
            if (input.googleId)
                existing.googleId = input.googleId;
            if (existing.globalRole === "super_admin") {
                existing.factoryRole = null;
            }
            else if (!existing.factoryRole) {
                existing.factoryRole =
                    existing.globalRole === "admin" ? "admin" : "staff";
            }
            existing.active = true;
            await existing.save();
            return { user: existing, isNewUser: false };
        }
        const created = await UserModel.create({
            name: input.name,
            email,
            googleId: input.googleId,
            globalRole: targetRole,
            factoryRole: targetRole === "super_admin" ? null : "admin",
            pagePermissions: targetRole === "super_admin" ? {} : FULL_PAGE_PERMISSIONS,
            active: true,
        });
        return { user: created, isNewUser: true };
    }
    catch (error) {
        console.error("error", error);
        return { user: null, isNewUser: false };
    }
}
export function decodeBearerToken(token) {
    if (!env.jwtSecret) {
        throw new Error("JWT_SECRET is missing");
    }
    return jwt.verify(token, env.jwtSecret);
}
