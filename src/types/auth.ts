export type GlobalRole = "super_admin" | "admin" | "staff";
export type MembershipRole = "admin" | "staff";

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  globalRole: GlobalRole;
  active: boolean;
};

export type AuthMembership = {
  factoryId: string;
  role: MembershipRole;
  accessLevel: "view" | "edit" | "finance" | "full";
  employeeRole?: string;
  pagePermissions?: Record<string, string[]>;
  active: boolean;
  factory?: {
    id: string;
    name: string;
    code: string;
    status?: string;
  };
};
