/**
 * Provision an account with a role (run locally — never deployed).
 * This is how the very first Super Admin is created; after that, org
 * admins invite staff from their dashboard and the Super Admin manages
 * roles from /super/users.
 *
 *   npm run create-account -- --production --email ana@lgu.gov.ph --name "Ana Reyes" \
 *       --role lgu_admin --org org_calapan --area "Calapan City" --areas "Calapan City,Baco"
 *
 *   npm run create-account -- --emulator --email owner@example.com --name "Owner" --role super_admin
 *
 * Roles: citizen, lgu_staff, lgu_admin, business_staff, business_admin,
 * enterprise_admin, super_admin (legacy: drrm_editor, admin).
 * Prints a password-reset link; no password is ever chosen or stored here.
 */
import { setupScriptEnv } from "./lib/scriptEnv";

const ctx = setupScriptEnv();
const { getAdminAuth, getDb } = await import("../server/lib/firebaseAdmin");
const { FieldValue } = await import("firebase-admin/firestore");
const { isClaimRole, normalizeRole, orgTypeForRole } = await import("../shared/roles");
const { DEFAULT_ALERT_PREFERENCES } = await import("../shared/types");

const email = ctx.option("--email");
const name = ctx.option("--name") ?? email ?? "";
const role = ctx.option("--role") ?? "citizen";
const orgId = ctx.option("--org") ?? null;
const assignedArea = ctx.option("--area") ?? null;
const areas = (ctx.option("--areas") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function fail(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

if (!email) fail("--email is required.");
if (!isClaimRole(role)) fail(`Unknown role "${role}".`);
const appRole = normalizeRole(role);
const needsOrg = orgTypeForRole(appRole) !== null && role !== "admin" && role !== "drrm_editor";
if (needsOrg && !orgId) fail(`Role ${role} belongs to an organization — pass --org <orgId>.`);
if ((appRole === "lgu_staff" || appRole === "lgu_admin") && !assignedArea) fail("LGU roles need --area <municipality>.");

const auth = getAdminAuth();
const db = getDb();

if (orgId) {
  const org = await db.doc(`organizations/${orgId}`).get();
  if (!org.exists) fail(`Organization ${orgId} does not exist. Create it from the Super Admin dashboard first.`);
}

let uid: string;
try {
  uid = (await auth.getUserByEmail(email)).uid;
  console.log(`Updating existing account ${email}`);
} catch {
  uid = (await auth.createUser({ email, displayName: name })).uid;
  console.log(`Created account ${email}`);
}

const claims: Record<string, unknown> = {};
if (role !== "citizen") claims.role = role;
if (orgId) claims.orgId = orgId;
if (assignedArea) claims.assignedArea = assignedArea;
if (areas.length) claims.areas = areas;
await auth.setCustomUserClaims(uid, claims);
await auth.revokeRefreshTokens(uid); // force a fresh token with the new claims

await db.doc(`users/${uid}`).set(
  {
    name,
    email,
    role,
    orgId,
    assignedArea: assignedArea ?? "",
    active: true,
    alertPrefs: DEFAULT_ALERT_PREFERENCES,
    createdAt: FieldValue.serverTimestamp(),
  },
  { merge: true }
);
if (orgId) {
  await db.doc(`organizations/${orgId}/members/${uid}`).set({
    name, email, role: appRole, assignedArea, active: true, addedAt: FieldValue.serverTimestamp(), addedBy: "create-account-script",
  });
}
await db.collection("audit_logs").add({
  actorUid: "script", actorName: "createAccount script", actorRole: "system", action: "account.provisioned",
  targetType: "user", targetId: uid, orgId, details: { email, role }, at: FieldValue.serverTimestamp(),
});

try {
  const link = await auth.generatePasswordResetLink(email);
  console.log(`\n  uid:   ${uid}\n  role:  ${role}${orgId ? ` @ ${orgId}` : ""}\n  set-password link: ${link}\n`);
} catch {
  console.log(`\n  uid: ${uid}\n  role: ${role}\n  (Ask the user to use "Forgot password?" on the sign-in page to set a password.)\n`);
}
process.exit(0);
