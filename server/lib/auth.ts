import type { DecodedIdToken } from "firebase-admin/auth";
import { getAdminAuth } from "./firebaseAdmin";
import { getDb } from "./firebaseAdmin";
import { forbidden, unauthorized } from "./http";
import { hasLegacyAreaClaims, normalizeRole, isOrgAdminRole, type AppRole, type RoleClaims } from "../../shared/roles";

export interface AuthCtx {
  uid: string;
  email: string | null;
  name: string;
  anonymous: boolean;
  /** Raw claim value (may be a legacy role). */
  rawRole: string | null;
  role: AppRole;
  orgId: string | null;
  assignedArea: string | null;
  areas: string[];
  claims: RoleClaims;
  /** True only for compatibility tokens issued before PSGC grants. */
  legacyGeographicClaims: boolean;
}

// Short-lived cache so a burst of calls from one page doesn't re-verify
// (and re-check revocation for) the same token every time.
const tokenCache = new Map<string, { ctx: AuthCtx; exp: number }>();
const CACHE_MS = 60_000;

function toCtx(t: DecodedIdToken): AuthCtx {
  const claims: RoleClaims = {
    role: (t.role as string) ?? null,
    orgId: (t.orgId as string) ?? null,
    assignedArea: (t.assignedArea as string) ?? null,
    areas: Array.isArray(t.areas) ? (t.areas as string[]) : [],
  };
  return {
    uid: t.uid,
    email: t.email ?? null,
    name: (t.name as string) || t.email || "Bahadvisory user",
    anonymous: t.firebase?.sign_in_provider === "anonymous",
    rawRole: (claims.role as string) ?? null,
    role: normalizeRole(claims.role),
    orgId: claims.orgId ?? null,
    assignedArea: claims.assignedArea ?? null,
    areas: claims.areas ?? [],
    claims,
    legacyGeographicClaims: hasLegacyAreaClaims(claims),
  };
}

/** Returns the caller's verified identity, or null when no token was sent. */
export async function getAuthCtx(req: Request): Promise<AuthCtx | null> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  const cached = tokenCache.get(token);
  if (cached && cached.exp > Date.now()) return cached.ctx;
  try {
    // checkRevoked=true also rejects disabled (deactivated) accounts.
    const decoded = await getAdminAuth().verifyIdToken(token, true);
    const ctx = toCtx(decoded);
    tokenCache.set(token, { ctx, exp: Date.now() + CACHE_MS });
    if (tokenCache.size > 2000) tokenCache.clear();
    return ctx;
  } catch (err) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "auth/user-disabled") throw forbidden("This account has been deactivated.");
    throw unauthorized("Your session has expired. Please sign in again.");
  }
}

export async function requireAuth(req: Request, opts: { allowAnonymous?: boolean } = {}): Promise<AuthCtx> {
  const ctx = await getAuthCtx(req);
  if (!ctx) throw unauthorized();
  if (ctx.anonymous && !opts.allowAnonymous) {
    throw unauthorized("Create a free account to use this feature.");
  }
  return ctx;
}

export function requireRole(ctx: AuthCtx, roles: AppRole[]): void {
  if (!roles.includes(ctx.role)) throw forbidden();
}

export function requireSuperAdmin(ctx: AuthCtx): void {
  if (ctx.role !== "super_admin") throw forbidden("Platform Super Admin only.");
}

/** Caller has a currently active membership in `orgId` (Super Admin may act on any org). */
export async function requireOrgMember(ctx: AuthCtx, orgId: string): Promise<void> {
  if (ctx.role === "super_admin") return;
  if (!ctx.orgId || ctx.orgId !== orgId) throw forbidden("You are not a member of this organization.");
  const member = await getDb().doc(`organizations/${orgId}/members/${ctx.uid}`).get();
  if (!member.exists || member.get("active") !== true) throw forbidden("Your organization membership is inactive.");
}

export async function requireOrgAdmin(ctx: AuthCtx, orgId: string): Promise<void> {
  if (ctx.role === "super_admin") return;
  await requireOrgMember(ctx, orgId);
  if (!isOrgAdminRole(ctx.role)) throw forbidden("Organization administrators only.");
}
