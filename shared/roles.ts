// ---------------------------------------------------------------------------
// Roles & permissions
//
// Roles live in Firebase Auth custom claims (`role`, `orgId`,
// `assignedArea`, `areas`) and are ONLY ever set server-side (Admin SDK —
// see server/handlers/orgs.ts and scripts/createAccount.ts). Firestore
// rules re-implement the same checks; this module is the single source
// for the UI and the backend.
//
// Backward compatibility: the original app used `drrm_editor` (area-scoped
// DRRM editor) and `admin` (province-wide DRRM admin). Both remain valid
// claim values and normalize onto the new role set below.
// ---------------------------------------------------------------------------

export const APP_ROLES = [
  "citizen",
  "lgu_staff",
  "lgu_admin",
  "business_staff",
  "business_admin",
  "enterprise_admin",
  "super_admin",
] as const;

export type AppRole = (typeof APP_ROLES)[number];
export type LegacyRole = "drrm_editor" | "admin";
/** Any value that may appear in the `role` custom claim. */
export type ClaimRole = AppRole | LegacyRole;

export const ROLE_LABELS: Record<AppRole, string> = {
  citizen: "Citizen",
  lgu_staff: "LGU Staff",
  lgu_admin: "LGU Administrator",
  business_staff: "Business Staff",
  business_admin: "Business Administrator",
  enterprise_admin: "Enterprise Administrator",
  super_admin: "Platform Super Admin",
};

/** Claims shape as read from a verified ID token. */
export interface RoleClaims {
  role?: ClaimRole | string | null;
  orgId?: string | null;
  assignedArea?: string | null;
  /** Jurisdiction list for LGU admins (multi-municipality LGUs). */
  areas?: string[] | null;
}

export function isClaimRole(value: unknown): value is ClaimRole {
  return (
    typeof value === "string" &&
    ((APP_ROLES as readonly string[]).includes(value) || value === "drrm_editor" || value === "admin")
  );
}

/** Maps legacy + missing roles onto the current role set. No claim = citizen. */
export function normalizeRole(role: unknown): AppRole {
  if (role === "drrm_editor") return "lgu_staff";
  if (role === "admin") return "lgu_admin";
  if (typeof role === "string" && (APP_ROLES as readonly string[]).includes(role)) {
    return role as AppRole;
  }
  return "citizen";
}

/** Legacy `admin` was province-wide: it may edit zones in every area. */
export function hasAllAreaAccess(claims: RoleClaims): boolean {
  return claims.role === "admin" || claims.role === "super_admin";
}

export function isLguRole(role: AppRole): boolean {
  return role === "lgu_staff" || role === "lgu_admin";
}

export function isBusinessRole(role: AppRole): boolean {
  return role === "business_staff" || role === "business_admin";
}

export function isOrgAdminRole(role: AppRole): boolean {
  return role === "lgu_admin" || role === "business_admin" || role === "enterprise_admin";
}

export function isOrgRole(role: AppRole): boolean {
  return role !== "citizen" && role !== "super_admin";
}

/**
 * Whether the holder of these claims may edit official flood data
 * (zones, road conditions, verification) for `area`. Mirrors
 * `ownsArea()` in firestore.rules.
 */
export function canManageArea(claims: RoleClaims, area: string | null | undefined): boolean {
  const role = normalizeRole(claims.role);
  if (hasAllAreaAccess(claims)) return true;
  if (!isLguRole(role) || !area) return false;
  if (claims.assignedArea === area) return true;
  return role === "lgu_admin" && Array.isArray(claims.areas) && claims.areas.includes(area);
}

/** Which roles an org admin may hand out inside their own organization. */
export const ASSIGNABLE_ROLES: Partial<Record<AppRole, AppRole[]>> = {
  lgu_admin: ["lgu_staff", "lgu_admin"],
  business_admin: ["business_staff", "business_admin"],
  enterprise_admin: ["business_staff", "business_admin", "enterprise_admin"],
  super_admin: [...APP_ROLES],
};

export function canAssignRole(assigner: AppRole, target: AppRole): boolean {
  return (ASSIGNABLE_ROLES[assigner] ?? []).includes(target);
}

/** Landing page after sign-in for each role. */
export function dashboardPathFor(role: AppRole): string {
  switch (role) {
    case "lgu_staff":
    case "lgu_admin":
      return "/admin";
    case "business_staff":
    case "business_admin":
      return "/business";
    case "enterprise_admin":
      return "/enterprise";
    case "super_admin":
      return "/super";
    default:
      return "/me";
  }
}

/** Organization type each org-bound role belongs to. */
export function orgTypeForRole(role: AppRole): OrgType | null {
  if (isLguRole(role)) return "lgu";
  if (isBusinessRole(role)) return "business";
  if (role === "enterprise_admin") return "enterprise";
  return null;
}

export type OrgType = "lgu" | "business" | "enterprise";
