import { MembershipModel } from "../models/membership.model.js";
import { StaffModel } from "../models/staff.model.js";
import { UserModel } from "../models/user.model.js";
import { PAGE_ACTIONS, PAGE_NAMES, type PagePermissions } from "../models/membership.model.js";

type StaffRecord = {
  _id?: unknown;
  factoryId: unknown;
  userId?: unknown;
  email?: string | null;
  role?: string;
  pagePermissions?: Record<string, string[]>;
  active?: boolean;
};

function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() ?? "";
}

export function normalizePagePermissions(value?: Record<string, string[]> | null): PagePermissions {
  return Object.fromEntries(
    PAGE_NAMES.flatMap((page) => {
      const actions = (value?.[page] ?? []).filter((action) =>
        PAGE_ACTIONS.includes(action as (typeof PAGE_ACTIONS)[number]),
      );
      return actions.length ? [[page, actions]] : [];
    }),
  ) as PagePermissions;
}

export async function syncMembershipForStaff(staff: StaffRecord) {
  const email = normalizeEmail(staff.email);
  if (!email) return;

  const user = await UserModel.findOne({ email });
  if (!user || user.globalRole !== "staff") return;

  await Promise.all([
    StaffModel.updateOne({ _id: staff._id }, { userId: user._id }),
    MembershipModel.findOneAndUpdate(
      { userId: user._id, factoryId: staff.factoryId },
      {
        role: "staff",
        accessLevel: "view",
        employeeRole: staff.role,
        pagePermissions: normalizePagePermissions(staff.pagePermissions),
        active: staff.active !== false,
      },
      { upsert: true, setDefaultsOnInsert: true },
    ),
  ]);
}

export async function deactivateStaffMembership(staff: StaffRecord) {
  const email = normalizeEmail(staff.email);
  if (!email) return;

  const user = await UserModel.findOne({ email }).lean();
  if (!user) return;

  await MembershipModel.updateOne(
    { userId: user._id, factoryId: staff.factoryId, role: "staff" },
    { active: false },
  );
}

export async function syncUserStaffMemberships(userId: string, email: string) {
  const normalizedEmail = normalizeEmail(email);
  const staffRecords = await StaffModel.find({
    $or: [{ email: normalizedEmail }, { userId }],
  }).lean();

  const assignedFactoryIds = staffRecords.map((staff) => staff.factoryId);
  await MembershipModel.updateMany(
    {
      userId,
      role: "staff",
      ...(assignedFactoryIds.length ? { factoryId: { $nin: assignedFactoryIds } } : {}),
    },
    { active: false },
  );

  await Promise.all(
    staffRecords.map((staff) =>
      Promise.all([
        StaffModel.updateOne({ _id: staff._id }, { userId }),
        MembershipModel.findOneAndUpdate(
          { userId, factoryId: staff.factoryId },
          {
            role: "staff",
            accessLevel: "view",
            employeeRole: staff.role,
            pagePermissions: normalizePagePermissions(staff.pagePermissions),
            active: staff.active !== false,
          },
          { upsert: true, setDefaultsOnInsert: true },
        ),
      ]),
    ),
  );
}

export async function syncStaffMembershipsForUser(userId: string) {
  const user = await UserModel.findById(userId).lean();
  if (!user || user.globalRole !== "staff") return;
  await syncUserStaffMemberships(String(user._id), user.email);
}
