import { createHash, randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getDb } from "../lib/firebaseAdmin";
import { badRequest, forbidden, HttpError, json, notFound, readJson } from "../lib/http";
import { requireAuth, requireOrgAdmin, requireOrgMember, type AuthCtx } from "../lib/auth";
import { firestoreRateLimit } from "../lib/rateLimit";
import { audit } from "../lib/audit";
import { notifyUser } from "../lib/alerts";
import { recomputeOrgEntitlements } from "../payments/processor";
import { asObject, EMAIL_RE, oneOf, optStr, str, strArray } from "../../shared/validation";
import { AREA_NAMES } from "../../shared/areas";
import { canAssignRole, isClaimRole, normalizeRole, orgTypeForRole, type AppRole } from "../../shared/roles";
import { computeEntitlements, PAID_FEATURES } from "../../shared/plans";
import { DEFAULT_ALERT_PREFERENCES, type Organization, type OrgApplication } from "../../shared/types";
import type { RouteCtx } from "../router";

const db = () => getDb();

/**
 * Sets role claims server-side. Grants take effect when the client refreshes
 * its ID token; removals/demotions also revoke refresh tokens so the old
 * privileges can't be used from an existing session.
 */
async function setClaims(
  uid: string,
  claims: { role?: string | null; orgId?: string | null; assignedArea?: string | null; areas?: string[] | null },
  opts: { revoke?: boolean } = {}
) {
  const clean: Record<string, unknown> = {};
  if (claims.role && claims.role !== "citizen") clean.role = claims.role;
  if (claims.orgId) clean.orgId = claims.orgId;
  if (claims.assignedArea) clean.assignedArea = claims.assignedArea;
  if (claims.areas?.length) clean.areas = claims.areas;
  await getAdminAuth().setCustomUserClaims(uid, clean);
  if (opts.revoke) await getAdminAuth().revokeRefreshTokens(uid);
  await db().doc(`users/${uid}`).set({ role: (clean.role as string) ?? "citizen", orgId: claims.orgId ?? null, assignedArea: claims.assignedArea ?? "" }, { merge: true });
}

function newOrgDoc(input: { name: string; type: Organization["type"]; jurisdictionAreas: string[]; createdBy: string; contactEmail?: string | null; parentOrgId?: string | null }) {
  return {
    name: input.name,
    type: input.type,
    status: "active",
    jurisdictionAreas: input.jurisdictionAreas,
    parentOrgId: input.parentOrgId ?? null,
    planId: null,
    subscriptionId: null,
    subscriptionStatus: "none",
    entitlements: computeEntitlements(null, { subscriptionActive: false }),
    addOns: [],
    contactEmail: input.contactEmail ?? null,
    hotlines: [],
    createdAt: FieldValue.serverTimestamp(),
    createdBy: input.createdBy,
    isDemo: false,
  };
}

/**
 * POST /api/orgs — onboarding.
 *  - business: created immediately; the creator becomes business_admin.
 *    Paid features stay off until a verified payment.
 *  - lgu / enterprise: an application the platform verifies first, because
 *    LGU roles can publish official flood information.
 */
export async function createOrg(req: Request, _ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  await firestoreRateLimit(`org-create:${auth.uid}`, 5, 24 * 3600_000);
  if (auth.orgId) throw new HttpError(409, "Your account already belongs to an organization.", "already_in_org");
  const body = asObject(await readJson(req));
  const type = oneOf(body, "type", ["business", "lgu", "enterprise"] as const);
  const name = str(body, "name", { min: 3, max: 160 });
  const contactEmail = optStr(body, "contactEmail", 160);
  if (contactEmail && !EMAIL_RE.test(contactEmail)) throw badRequest("Enter a valid contact email.");

  if (type === "business") {
    const ref = db().collection("organizations").doc();
    await ref.set(newOrgDoc({ name, type, jurisdictionAreas: [], createdBy: auth.uid, contactEmail: contactEmail ?? auth.email }));
    await ref.collection("members").doc(auth.uid).set({ name: auth.name, email: auth.email ?? "", role: "business_admin", assignedArea: null, active: true, addedAt: FieldValue.serverTimestamp(), addedBy: auth.uid });
    await setClaims(auth.uid, { role: "business_admin", orgId: ref.id });
    await audit(auth, "org.created", "organization", ref.id, { type }, ref.id);
    return json({ ok: true, orgId: ref.id, status: "active", refreshClaims: true }, 201);
  }

  const areas = strArray(body, "jurisdictionAreas", { maxItems: 30, maxLen: 80 });
  if (type === "lgu" && (!areas.length || areas.some((a) => !AREA_NAMES.includes(a)))) throw badRequest("Choose the municipalities your LGU covers.");
  const appRef = db().collection("org_applications").doc();
  await appRef.set({
    orgName: name,
    type,
    jurisdictionAreas: areas,
    applicantUid: auth.uid,
    applicantEmail: auth.email ?? "",
    applicantName: auth.name,
    position: optStr(body, "position", 120) ?? "",
    message: optStr(body, "message", 1500) ?? "",
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
  await audit(auth, "org.application_submitted", "org_application", appRef.id, { type, areas });
  return json({ ok: true, applicationId: appRef.id, status: "pending_approval" }, 201);
}

/** POST /api/admin/applications/:id/decide — Super Admin approves/rejects. */
export async function decideApplication(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth.role !== "super_admin") throw forbidden("Platform Super Admin only.");
  const body = asObject(await readJson(req));
  const decision = oneOf(body, "decision", ["approve", "reject"] as const);
  const appRef = db().doc(`org_applications/${ctx.params.id}`);
  const snap = await appRef.get();
  if (!snap.exists) throw notFound("Application not found.");
  const app = { id: snap.id, ...(snap.data() as Omit<OrgApplication, "id">) };
  if (app.status !== "pending") throw new HttpError(409, "Already decided.", "already_decided");
  if (decision === "reject") {
    await appRef.update({ status: "rejected", reviewedBy: auth.uid, reviewedAt: FieldValue.serverTimestamp() });
    await notifyUser(app.applicantUid, { kind: "system", title: "Organization application", body: `Your application for ${app.orgName} was not approved.${body.note ? ` Note: ${String(body.note).slice(0, 300)}` : ""}` });
    await audit(auth, "org.application_rejected", "org_application", app.id, {});
    return json({ ok: true, status: "rejected" });
  }
  const orgRef = db().collection("organizations").doc();
  await orgRef.set(newOrgDoc({ name: app.orgName, type: app.type, jurisdictionAreas: app.jurisdictionAreas, createdBy: auth.uid, contactEmail: app.applicantEmail }));
  const role: AppRole = app.type === "lgu" ? "lgu_admin" : "enterprise_admin";
  await orgRef.collection("members").doc(app.applicantUid).set({
    name: app.applicantName, email: app.applicantEmail, role, assignedArea: app.jurisdictionAreas[0] ?? null, active: true, addedAt: FieldValue.serverTimestamp(), addedBy: auth.uid,
  });
  await setClaims(app.applicantUid, { role, orgId: orgRef.id, assignedArea: app.jurisdictionAreas[0] ?? null, areas: app.type === "lgu" ? app.jurisdictionAreas : null });
  await appRef.update({ status: "approved", reviewedBy: auth.uid, reviewedAt: FieldValue.serverTimestamp(), orgId: orgRef.id });
  await notifyUser(app.applicantUid, { kind: "system", title: "Organization approved", body: `${app.orgName} is set up. Sign out and back in to open your dashboard.` });
  await audit(auth, "org.application_approved", "org_application", app.id, { orgId: orgRef.id }, orgRef.id);
  return json({ ok: true, status: "approved", orgId: orgRef.id });
}

/** PATCH /api/orgs/:orgId — contact details & local hotlines (org admin). */
export async function updateOrg(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireOrgAdmin(auth, ctx.params.orgId);
  const body = asObject(await readJson(req));
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = str(body, "name", { min: 3, max: 160 });
  if (body.contactEmail !== undefined) patch.contactEmail = optStr(body, "contactEmail", 160);
  if (body.contactPhone !== undefined) patch.contactPhone = optStr(body, "contactPhone", 40);
  if (Array.isArray(body.hotlines)) {
    patch.hotlines = (body.hotlines as unknown[]).slice(0, 8).map((h, i) => {
      const o = asObject(h, `hotlines[${i}]`);
      return { label: str(o, "label", { max: 80 }), number: str(o, "number", { max: 30, pattern: /^[0-9+()\-\s]{3,30}$/ }) };
    });
  }
  await db().doc(`organizations/${ctx.params.orgId}`).update(patch);
  await audit(auth, "org.updated", "organization", ctx.params.orgId, { fields: Object.keys(patch) }, ctx.params.orgId);
  return json({ ok: true });
}

async function orgOf(orgId: string) {
  const snap = await db().doc(`organizations/${orgId}`).get();
  if (!snap.exists) throw notFound("Organization not found.");
  return { id: snap.id, ...(snap.data() as Omit<Organization, "id">) };
}

function checkMemberRole(auth: AuthCtx, org: Organization, role: AppRole, assignedArea: string | null, areas: string[]) {
  if (!canAssignRole(auth.role, role)) throw forbidden(`You can't assign the ${role.replace("_", " ")} role.`);
  const expectedType = orgTypeForRole(role);
  const typeOk = expectedType === org.type || (org.type === "enterprise" && expectedType === "business");
  if (!typeOk) throw badRequest(`The ${role.replace("_", " ")} role doesn't belong in a ${org.type} organization.`);
  if (expectedType === "lgu") {
    if (!assignedArea || !org.jurisdictionAreas.includes(assignedArea)) throw badRequest("Assign an area within your LGU's jurisdiction.");
    if (areas.some((a) => !org.jurisdictionAreas.includes(a))) throw badRequest("Areas must be within your LGU's jurisdiction.");
  }
}

/**
 * POST /api/orgs/:orgId/members — invite staff (paid: staffManagement).
 * Creates the Firebase Auth account if needed (the person sets their own
 * password through the reset email) and sets role claims server-side.
 */
export async function inviteMember(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const orgId = ctx.params.orgId;
  requireOrgAdmin(auth, orgId);
  await firestoreRateLimit(`invite:${auth.uid}`, 30, 3600_000);
  const org = await orgOf(orgId);
  if (!org.entitlements?.staffManagement && auth.role !== "super_admin") {
    throw new HttpError(402, "Staff management is a paid feature. Subscribe to add team members.", "upgrade_required");
  }
  const body = asObject(await readJson(req));
  const email = str(body, "email", { max: 160, pattern: EMAIL_RE }).toLowerCase();
  const name = str(body, "name", { min: 2, max: 80 });
  const role = oneOf(body, "role", ["lgu_staff", "lgu_admin", "business_staff", "business_admin", "enterprise_admin"] as const);
  const assignedArea = optStr(body, "assignedArea", 80);
  const areas = strArray(body, "areas", { maxItems: 30, maxLen: 80 });
  checkMemberRole(auth, org, role, assignedArea, areas);

  const adminAuth = getAdminAuth();
  let uid: string;
  let created = false;
  let existingClaimsOrg: string | null = null;
  try {
    const existing = await adminAuth.getUserByEmail(email);
    uid = existing.uid;
    existingClaimsOrg = (existing.customClaims?.orgId as string | undefined) ?? null;
    if (existingClaimsOrg && existingClaimsOrg !== orgId) throw new HttpError(409, "That person already belongs to another organization.", "member_of_other_org");
    if (normalizeRole(existing.customClaims?.role) === "super_admin") throw forbidden("Platform administrators can't be added to organizations.");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    uid = (await adminAuth.createUser({ email, displayName: name })).uid;
    created = true;
    await db().doc(`users/${uid}`).set({ name, email, role, orgId, assignedArea: assignedArea ?? "", active: true, alertPrefs: DEFAULT_ALERT_PREFERENCES, createdAt: FieldValue.serverTimestamp() }, { merge: true });
  }
  if (!created) {
    const existingMembership = await db().doc(`organizations/${orgId}/members/${uid}`).get();
    if (existingClaimsOrg === orgId || existingMembership.exists) {
      throw new HttpError(409, "That person is already a member. Use the member editor to change their role.", "already_member");
    }
  }
  await db().doc(`organizations/${orgId}/members/${uid}`).set({
    name, email, role, assignedArea: assignedArea ?? null, active: true, addedAt: FieldValue.serverTimestamp(), addedBy: auth.uid,
  });
  await setClaims(uid, { role, orgId, assignedArea, areas: role === "lgu_admin" ? (areas.length ? areas : org.jurisdictionAreas) : null });
  let setPasswordLink: string | null = null;
  if (created) {
    try {
      setPasswordLink = await adminAuth.generatePasswordResetLink(email);
    } catch {
      setPasswordLink = null;
    }
  } else {
    await notifyUser(uid, { kind: "system", title: `You were added to ${org.name}`, body: `Your role: ${role.replace("_", " ")}. Sign out and back in to open the dashboard.` });
  }
  await audit(auth, "org.member_added", "user", uid, { email, role, assignedArea, created }, orgId);
  // The link lets the admin share a set-password link if email delivery
  // isn't configured; Firebase also sends the reset email from the client.
  return json({ ok: true, uid, created, setPasswordLink }, 201);
}

/** PATCH /api/orgs/:orgId/members/:uid — change role/area or (de)activate. */
export async function updateMember(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const { orgId, uid } = ctx.params;
  requireOrgAdmin(auth, orgId);
  if (uid === auth.uid) throw badRequest("You can't change your own role. Ask another administrator.");
  const org = await orgOf(orgId);
  const ref = db().doc(`organizations/${orgId}/members/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Member not found.");
  const body = asObject(await readJson(req));
  const role = (body.role !== undefined ? oneOf(body, "role", ["lgu_staff", "lgu_admin", "business_staff", "business_admin", "enterprise_admin"] as const) : snap.get("role")) as AppRole;
  const assignedArea = body.assignedArea !== undefined ? optStr(body, "assignedArea", 80) : (snap.get("assignedArea") as string | null);
  const active = body.active !== undefined ? Boolean(body.active) : (snap.get("active") as boolean);
  if (!canAssignRole(auth.role, snap.get("role") as AppRole)) throw forbidden("You can't manage this member.");
  checkMemberRole(auth, org, role, assignedArea, []);
  await ref.update({ role, assignedArea: assignedArea ?? null, active });
  // Deactivated staff keep a normal citizen account (public safety access) but lose org access.
  const demoted = !active || ((snap.get("role") as string).endsWith("_admin") && !role.endsWith("_admin"));
  await setClaims(uid, active ? { role, orgId, assignedArea, areas: role === "lgu_admin" ? org.jurisdictionAreas : null } : { role: "citizen", orgId: null }, { revoke: demoted });
  await audit(auth, active ? "org.member_updated" : "org.member_deactivated", "user", uid, { role, assignedArea, active }, orgId);
  return json({ ok: true });
}

/** DELETE /api/orgs/:orgId/members/:uid — remove from the organization. */
export async function removeMember(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const { orgId, uid } = ctx.params;
  requireOrgAdmin(auth, orgId);
  if (uid === auth.uid) throw badRequest("You can't remove yourself.");
  const ref = db().doc(`organizations/${orgId}/members/${uid}`);
  const snap = await ref.get();
  if (!snap.exists) throw notFound("Member not found.");
  if (!canAssignRole(auth.role, snap.get("role") as AppRole)) throw forbidden("You can't manage this member.");
  await ref.delete();
  await setClaims(uid, { role: "citizen", orgId: null }, { revoke: true });
  await audit(auth, "org.member_removed", "user", uid, {}, orgId);
  return json({ ok: true });
}

// ---- Enterprise branches -----------------------------------------------------------

/** GET /api/orgs/:orgId/branches — enterprise admins see their branches' status. */
export async function listBranches(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireOrgMember(auth, ctx.params.orgId);
  const snap = await db().collection("organizations").where("parentOrgId", "==", ctx.params.orgId).get();
  const branches = await Promise.all(
    snap.docs.map(async (d) => {
      const members = await d.ref.collection("members").count().get();
      const routes = await d.ref.collection("saved_routes").count().get();
      return { id: d.id, name: d.get("name"), type: d.get("type"), status: d.get("status"), members: members.data().count, savedRoutes: routes.data().count, createdAt: d.get("createdAt") };
    })
  );
  return json({ branches });
}

/** POST /api/orgs/:orgId/branches — create a branch (paid: multiBranch). */
export async function createBranch(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const parentId = ctx.params.orgId;
  requireOrgAdmin(auth, parentId);
  const parent = await orgOf(parentId);
  if (parent.type !== "enterprise" || !parent.entitlements?.multiBranch) throw new HttpError(402, "Multi-branch management requires the Enterprise plan.", "upgrade_required");
  const body = asObject(await readJson(req));
  const name = str(body, "name", { min: 3, max: 160 });
  const ref = db().collection("organizations").doc();
  // Branches inherit the parent's plan & entitlements.
  await ref.set({ ...newOrgDoc({ name, type: "business", jurisdictionAreas: [], createdBy: auth.uid, parentOrgId: parentId }), planId: parent.planId, subscriptionId: parent.subscriptionId ?? null, subscriptionStatus: parent.subscriptionStatus, entitlements: parent.entitlements });
  await audit(auth, "org.branch_created", "organization", ref.id, { parentId }, parentId);
  return json({ ok: true, orgId: ref.id }, 201);
}

// ---- API keys (paid: apiAccess) ---------------------------------------------------------

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** POST /api/orgs/:orgId/api-keys — returns the key ONCE; only its hash is stored. */
export async function createApiKey(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  const orgId = ctx.params.orgId;
  requireOrgAdmin(auth, orgId);
  const org = await orgOf(orgId);
  if (!org.entitlements?.apiAccess) throw new HttpError(402, "API access isn't included in your plan.", "upgrade_required");
  const body = asObject(await readJson(req));
  const label = str(body, "label", { min: 2, max: 80 });
  const existing = await db().collection(`organizations/${orgId}/api_keys`).where("revoked", "==", false).count().get();
  if (existing.data().count >= 10) throw badRequest("Revoke an unused key first (max 10 active keys).");
  const key = `ba_${org.isDemo ? "test" : "live"}_${randomBytes(24).toString("base64url")}`;
  const ref = db().collection(`organizations/${orgId}/api_keys`).doc();
  await ref.set({ orgId, label, prefix: key.slice(0, 12), hash: hashApiKey(key), createdBy: auth.uid, createdAt: FieldValue.serverTimestamp(), lastUsedAt: null, revoked: false });
  await audit(auth, "api_key.created", "api_key", ref.id, { label }, orgId);
  return json({ id: ref.id, key, prefix: key.slice(0, 12), note: "Copy this key now — it won't be shown again." }, 201);
}

/** DELETE /api/orgs/:orgId/api-keys/:keyId */
export async function revokeApiKey(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  requireOrgAdmin(auth, ctx.params.orgId);
  const ref = db().doc(`organizations/${ctx.params.orgId}/api_keys/${ctx.params.keyId}`);
  if (!(await ref.get()).exists) throw notFound("Key not found.");
  await ref.update({ revoked: true, revokedAt: FieldValue.serverTimestamp() });
  await audit(auth, "api_key.revoked", "api_key", ref.id, {}, ctx.params.orgId);
  return json({ ok: true });
}

// ---- Super Admin org controls ----------------------------------------------------------

/** POST /api/admin/orgs/:orgId/settings — status, add-ons (custom deals). */
export async function adminOrgSettings(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth.role !== "super_admin") throw forbidden("Platform Super Admin only.");
  const body = asObject(await readJson(req));
  const patch: Record<string, unknown> = {};
  if (body.status !== undefined) patch.status = oneOf(body, "status", ["active", "suspended"] as const);
  if (body.addOns !== undefined) patch.addOns = strArray(body, "addOns", { maxItems: 10, maxLen: 40, allowed: PAID_FEATURES });
  await db().doc(`organizations/${ctx.params.orgId}`).update(patch);
  await recomputeOrgEntitlements(ctx.params.orgId);
  await audit(auth, "org.admin_settings", "organization", ctx.params.orgId, patch, ctx.params.orgId);
  return json({ ok: true });
}

/** POST /api/admin/users/:uid/role — Super Admin sets any role (with org/area). */
export async function adminSetRole(req: Request, ctx: RouteCtx): Promise<Response> {
  const auth = await requireAuth(req);
  if (auth.role !== "super_admin") throw forbidden("Platform Super Admin only.");
  if (ctx.params.uid === auth.uid) throw badRequest("You can't change your own role.");
  const body = asObject(await readJson(req));
  const role = str(body, "role", { max: 40 });
  if (!isClaimRole(role) && role !== "citizen") throw badRequest("Unknown role.");
  const orgId = optStr(body, "orgId", 120);
  const assignedArea = optStr(body, "assignedArea", 80);
  const areas = strArray(body, "areas", { maxItems: 30, maxLen: 80 });
  const appRole = normalizeRole(role);
  if (orgTypeForRole(appRole) && role !== "admin" && role !== "drrm_editor") {
    if (!orgId) throw badRequest("This role needs an organization.");
    const org = await orgOf(orgId);
    await db().doc(`organizations/${orgId}/members/${ctx.params.uid}`).set(
      { name: body.name ?? "", email: body.email ?? "", role: appRole, assignedArea: assignedArea ?? null, active: true, addedAt: FieldValue.serverTimestamp(), addedBy: auth.uid },
      { merge: true }
    );
    if (appRole === "lgu_staff" || appRole === "lgu_admin") {
      if (!assignedArea || !org.jurisdictionAreas.includes(assignedArea)) throw badRequest("Assign an area within the LGU's jurisdiction.");
    }
  }
  await setClaims(ctx.params.uid, { role, orgId: orgId ?? null, assignedArea, areas: areas.length ? areas : null }, { revoke: true });
  await audit(auth, "user.role_set", "user", ctx.params.uid, { role, orgId, assignedArea }, orgId ?? null);
  return json({ ok: true });
}
