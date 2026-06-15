import { OAuth2Client } from "google-auth-library";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { FactoryModel } from "../models/factory.model.js";
import { MembershipModel } from "../models/membership.model.js";
import { StaffModel } from "../models/staff.model.js";
import { UserModel } from "../models/user.model.js";
import type { AuthMembership, AuthUser } from "../types/auth.js";
import { normalizePagePermissions } from "./staff-membership.service.js";

const googleClient = env.googleClientId ? new OAuth2Client(env.googleClientId) : null;

export type AuthSession = {
  token: string;
  profile: AuthUser;
  memberships: AuthMembership[];
  primaryRole: "super_admin" | "admin" | "staff";
  isNewUser: boolean;
};

export class StaffAccessNotAssignedError extends Error {
  status = 403;

  constructor(email: string) {
    super(`No active staff access is assigned to ${email}. Ask a factory admin to add this exact Google email.`);
    this.name = "StaffAccessNotAssignedError";
  }
}

function signToken(payload: { userId: string; globalRole: AuthUser["globalRole"] }) {
  if (!env.jwtSecret) {
    throw new Error("JWT_SECRET is missing");
  }
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function isSuperAdminEmail(email: string) {
  return normalizeEmail(email) === "ads.grandcafe@gmail.com";
}

function isAdminEmail(email: string) {
  return env.adminEmails.includes(normalizeEmail(email));
}

export async function verifyGoogleCredential(credential: string) {
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

export async function buildSessionForUser(userId: string, isNewUser = false): Promise<AuthSession> {
  const user = await UserModel.findById(userId).lean();
  if (!user) {
    throw new Error("User not found");
  }

  const memberships = await MembershipModel.find({ userId, active: true }).lean();
  const formattedMemberships = await Promise.all(
    memberships.map(async (membership) => {
      const factory = await FactoryModel.findById(membership.factoryId).lean();
      return {
        factoryId: String(membership.factoryId),
        role: membership.role,
        accessLevel: membership.accessLevel,
        pagePermissions: normalizePagePermissions(
          membership.pagePermissions as unknown as Record<string, string[]>,
        ),
        employeeRole: membership.employeeRole ?? undefined,
        active: membership.active,
        factory: factory
          ? {
              id: String(factory._id),
              name: factory.name,
              code: factory.code,
              status: factory.status,
            }
          : {
              id: String(membership.factoryId),
              name: "Unknown Factory",
              code: "UNKNOWN",
            },
      };
    }),
  );

  if (user.globalRole === "staff" && formattedMemberships.length === 0) {
    throw new StaffAccessNotAssignedError(user.email);
  }

  const globalRole = user.globalRole;
  const primaryRole = (() => {
    if (globalRole === "super_admin") return "super_admin";
    // Prefer explicit membership roles first
    if (formattedMemberships.some((m) => m.role === "admin")) return "admin";
    if (formattedMemberships.some((m) => m.role === "staff")) return "staff";
    // Fallback to the user's global role
    if (globalRole === "admin") return "admin";
    return "staff";
  })();

  return {
    token: signToken({ userId: String(user._id), globalRole }),
    profile: {
      id: String(user._id),
      name: user.name,
      email: user.email,
      globalRole,
      active: user.active,
    },
    memberships: formattedMemberships,
    primaryRole,
    isNewUser,
  };
}

export async function upsertGoogleUser(input: { email: string; name: string; googleId?: string }) {
  const email = normalizeEmail(input.email);
  const existing = await UserModel.findOne({ email });

  // Check if the user is registered as staff in any factory
  const isStaff = await StaffModel.exists({ email });

  const targetRole = isSuperAdminEmail(email)
    ? "super_admin"
    : isStaff
      ? "staff"
      : "admin";

  if (existing) {
    existing.name = input.name;
    if (input.googleId) existing.googleId = input.googleId;
    if (existing.globalRole !== "super_admin") {
      existing.globalRole = targetRole;
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
    active: true,
  });
  return { user: created, isNewUser: true };
}

export function decodeBearerToken(token: string) {
  if (!env.jwtSecret) {
    throw new Error("JWT_SECRET is missing");
  }

  return jwt.verify(token, env.jwtSecret) as { userId: string; globalRole: AuthUser["globalRole"] };
}
