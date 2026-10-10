/**
 * Firestore security rules tests — run against the emulator:
 *   npm run test:emulator
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

let env: RulesTestEnvironment;

// Separate project id: tests never touch the dev/demo project's data.
const PROJECT = process.env.GCLOUD_PROJECT || "demo-bahadvisory-test";

const zoneData = (overrides: Record<string, unknown> = {}) => ({
  name: "Bucayao Road",
  geometry: { type: "polygon", coordinates: [{ lat: 13.38, lng: 121.17 }, { lat: 13.381, lng: 121.171 }, { lat: 13.379, lng: 121.172 }] },
  waterLevelM: 0.4,
  trend: "rising",
  trendDeltaM: 0.1,
  roadPassability: "caution",
  passability: { bike: false, motor: true, fourWheel: true, suvPickup: true, truck: true },
  notes: "",
  status: "active",
  area: "Calapan City",
  updatedBy: "staff1",
  ...overrides,
});

const calapanGeography = {
  regionPsgcCode: "1700000000",
  provincePsgcCode: "1705200000",
  municipalityPsgcCode: "1705205000",
  barangayPsgcCode: null,
  locationAssignment: { method: "manual", confidence: "medium", sourceVersion: "Q2_2026", assignedAt: 1, assignedBy: "test" },
};

const grant = (orgId: string, psgcCode: string, provincePsgcCode: string, municipalityPsgcCode: string | null, level = "municipality") => ({
  orgId, psgcCode, provincePsgcCode, municipalityPsgcCode, level, active: true, createdAt: new Date(), createdBy: "test",
});

const ENTITLED = {
  floodMonitoring: true, basicNavigation: true, emergencyAlerts: true, communityReporting: true, evacuationFinder: true,
  advancedAnalytics: true, fleetMonitoring: true, incidentManagement: true, staffManagement: true,
  apiAccess: false, customIntegrations: false, multiBranch: false,
};
const NOT_ENTITLED = { ...ENTITLED, advancedAnalytics: false, fleetMonitoring: false, incidentManagement: false, staffManagement: false };

// --- auth contexts -------------------------------------------------------------
const anonymous = () => env.unauthenticatedContext().firestore();
const guest = (uid = "guest1") =>
  env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).firestore();
const citizen = (uid = "cit1") => env.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
const lguStaff = (uid = "staff1", area = "Calapan City", orgId = "org_lgu_calapan") =>
  env.authenticatedContext(uid, { role: "lgu_staff", assignedArea: area, orgId }).firestore();
const lguAdmin = (uid = "lguadmin1", orgId = "org_lgu_calapan") =>
  env.authenticatedContext(uid, { role: "lgu_admin", assignedArea: "Calapan City", areas: ["Calapan City", "Baco"], orgId }).firestore();
const legacyEditor = (uid = "staff1", area = "Calapan City") =>
  env.authenticatedContext(uid, { role: "drrm_editor", assignedArea: area }).firestore();
const legacyAdmin = (uid = "legacyadmin") => env.authenticatedContext(uid, { role: "admin", assignedArea: "MinSU" }).firestore();
const bizStaff = (uid = "biz1", orgId = "org_biz_express") =>
  env.authenticatedContext(uid, { role: "business_staff", orgId }).firestore();
const bizAdmin = (uid = "bizadmin1", orgId = "org_biz_express") =>
  env.authenticatedContext(uid, { role: "business_admin", orgId }).firestore();
const superAdmin = (uid = "super1") => env.authenticatedContext(uid, { role: "super_admin" }).firestore();

async function seed(path: string, data: Record<string, unknown>) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await seed("organizations/org_lgu_calapan", { name: "Calapan DRRMO", type: "lgu", entitlements: ENTITLED });
  await seed("organizations/org_lgu_baco", { name: "Baco MDRRMO", type: "lgu", entitlements: ENTITLED });
  await seed("organizations/org_lgu_unpaid", { name: "Unpaid LGU", type: "lgu", entitlements: NOT_ENTITLED });
  await seed("organizations/org_biz_express", { name: "Express Couriers", type: "business", entitlements: ENTITLED });
  await seed("organizations/org_biz_free", { name: "Free Biz", type: "business", entitlements: NOT_ENTITLED });
  await seed("organizations/org_lgu_calapan/jurisdiction_grants/1705205000", grant("org_lgu_calapan", "1705205000", "1705200000", "1705205000"));
  await seed("organizations/org_lgu_calapan/jurisdiction_grants/1705201000", grant("org_lgu_calapan", "1705201000", "1705200000", "1705201000"));
  await seed("organizations/org_lgu_baco/jurisdiction_grants/1705201000", grant("org_lgu_baco", "1705201000", "1705200000", "1705201000"));
});

// =============================================================================
describe("public safety information is readable without an account", () => {
  it("anyone can read flood zones, road conditions, alerts, risk and stations", async () => {
    await seed("floodZones/z1", zoneData());
    await seed("road_conditions/r1", { name: "x", status: "closed", area: "Calapan City", active: true });
    await seed("alerts/a1", { title: "Flood", active: true });
    await seed("flood_risk_predictions/calapan", { score: 10 });
    await seed("water_level_stations/s1", { name: "Bucayao", area: "Calapan City" });
    await seed("subscription_plans/lgu_pro", { name: "LGU Pro" });
    await seed("platform_settings/general", { demoMode: true });
    const db = anonymous();
    await assertSucceeds(getDoc(doc(db, "floodZones/z1")));
    await assertSucceeds(getDoc(doc(db, "road_conditions/r1")));
    await assertSucceeds(getDoc(doc(db, "alerts/a1")));
    await assertSucceeds(getDoc(doc(db, "flood_risk_predictions/calapan")));
    await assertSucceeds(getDoc(doc(db, "water_level_stations/s1")));
    await assertSucceeds(getDoc(doc(db, "subscription_plans/lgu_pro")));
    await assertSucceeds(getDoc(doc(db, "platform_settings/general")));
  });

  it("the Recent Advisories collection-group query works for the public", async () => {
    await seed("zoneHistory/z1/updates/u1", { zoneName: "x", action: "created", timestamp: new Date() });
    await assertSucceeds(getDocs(query(collectionGroup(anonymous(), "updates"), orderBy("timestamp", "desc"), limit(50))));
  });

  it("only verified evacuation centers are public", async () => {
    await seed("evacuation_centers/c1", { name: "Verified", verified: true, orgId: "org_lgu_calapan", area: "Calapan City" });
    await seed("evacuation_centers/c2", { name: "Unverified", verified: false, orgId: "org_lgu_calapan", area: "Calapan City" });
    await assertSucceeds(getDoc(doc(anonymous(), "evacuation_centers/c1")));
    await assertFails(getDoc(doc(anonymous(), "evacuation_centers/c2")));
    await assertSucceeds(getDocs(query(collection(anonymous(), "evacuation_centers"), where("verified", "==", true))));
    await assertSucceeds(getDoc(doc(lguStaff(), "evacuation_centers/c2")));
  });

  it("only published advisories are public", async () => {
    await seed("advisories/a1", { status: "published", orgId: "org_lgu_calapan", title: "x" });
    await seed("advisories/a2", { status: "draft", orgId: "org_lgu_calapan", title: "y" });
    await assertSucceeds(getDoc(doc(anonymous(), "advisories/a1")));
    await assertFails(getDoc(doc(anonymous(), "advisories/a2")));
    await assertFails(getDoc(doc(lguStaff("s9", "Baco", "org_lgu_baco"), "advisories/a2")));
    await assertSucceeds(getDoc(doc(lguStaff(), "advisories/a2")));
  });

  it("platform settings other than general/features are private", async () => {
    await seed("platform_settings/ai", { pricing: {} });
    await assertFails(getDoc(doc(citizen(), "platform_settings/ai")));
    await assertSucceeds(getDoc(doc(superAdmin(), "platform_settings/ai")));
  });
});

// =============================================================================
describe("official flood zones (original collection, backward compatible)", () => {
  it("enforces exact municipal grants on migrated records", async () => {
    await assertSucceeds(setDoc(doc(lguStaff(), "floodZones/calapan"), zoneData({ ...calapanGeography })));
    await assertFails(setDoc(doc(lguStaff("baco-staff", "Baco", "org_lgu_baco"), "floodZones/calapan2"), zoneData({ ...calapanGeography, updatedBy: "baco-staff" })));
  });

  it("allows a provincial grant only inside its province and rejects forged ancestry", async () => {
    await seed("organizations/org_lgu_calapan/jurisdiction_grants/1705200000", grant("org_lgu_calapan", "1705200000", "1705200000", null, "province"));
    await assertSucceeds(setDoc(doc(lguStaff(), "floodZones/oriental"), zoneData({ ...calapanGeography })));
    await assertFails(setDoc(doc(lguStaff(), "floodZones/occidental"), zoneData({
      ...calapanGeography,
      provincePsgcCode: "1705100000",
      municipalityPsgcCode: "1705106000",
    })));
    await assertFails(setDoc(doc(lguStaff(), "floodZones/forged"), zoneData({
      ...calapanGeography,
      provincePsgcCode: "1705100000",
    })));
  });

  it("clients cannot write jurisdiction grants", async () => {
    await assertFails(setDoc(doc(lguAdmin(), "organizations/org_lgu_calapan/jurisdiction_grants/1705209000"), grant("org_lgu_calapan", "1705209000", "1705200000", "1705209000")));
    await assertFails(setDoc(doc(superAdmin(), "organizations/org_lgu_calapan/jurisdiction_grants/1705209000"), grant("org_lgu_calapan", "1705209000", "1705200000", "1705209000")));
  });
  it("legacy drrm_editor can publish a zone in their own area", async () => {
    await assertSucceeds(setDoc(doc(legacyEditor(), "floodZones/z1"), zoneData()));
  });

  it("legacy admin can publish in any area", async () => {
    await assertSucceeds(setDoc(doc(legacyAdmin(), "floodZones/z1"), zoneData({ area: "Bulalacao", updatedBy: "legacyadmin" })));
  });

  it("LGU staff cannot publish outside their area", async () => {
    await assertFails(setDoc(doc(lguStaff(), "floodZones/z1"), zoneData({ area: "Baco" })));
  });

  it("LGU admin can publish across their jurisdiction list", async () => {
    await assertSucceeds(setDoc(doc(lguAdmin(), "floodZones/z1"), zoneData({ area: "Baco", updatedBy: "lguadmin1" })));
    await assertFails(setDoc(doc(lguAdmin(), "floodZones/z2"), zoneData({ area: "Naujan", updatedBy: "lguadmin1" })));
  });

  it("citizens, guests and businesses cannot change official zones", async () => {
    await assertFails(setDoc(doc(citizen(), "floodZones/z1"), zoneData({ updatedBy: "cit1" })));
    await assertFails(setDoc(doc(guest(), "floodZones/z1"), zoneData({ updatedBy: "guest1" })));
    await assertFails(setDoc(doc(bizAdmin(), "floodZones/z1"), zoneData({ updatedBy: "bizadmin1" })));
    await seed("floodZones/z2", zoneData());
    await assertFails(updateDoc(doc(citizen(), "floodZones/z2"), { waterLevelM: 0, updatedBy: "cit1" }));
    await assertFails(deleteDoc(doc(citizen(), "floodZones/z2")));
  });

  it("rejects invalid shapes and impersonated updatedBy", async () => {
    await assertFails(setDoc(doc(lguStaff(), "floodZones/z1"), zoneData({ waterLevelM: -1 })));
    await assertFails(setDoc(doc(lguStaff(), "floodZones/z1"), zoneData({ trend: "exploding" })));
    await assertFails(setDoc(doc(lguStaff(), "floodZones/z1"), zoneData({ updatedBy: "someone-else" })));
  });

  it("clients cannot mint or launder simulated demo data", async () => {
    await assertFails(setDoc(doc(lguStaff(), "floodZones/z1"), zoneData({ simulated: true })));
    await seed("floodZones/z2", zoneData({ simulated: true }));
    await assertFails(updateDoc(doc(lguStaff(), "floodZones/z2"), { simulated: false, updatedBy: "staff1" }));
    await assertSucceeds(updateDoc(doc(lguStaff(), "floodZones/z2"), { waterLevelM: 0.5, updatedBy: "staff1" }));
  });

  it("zone history is append-only", async () => {
    await assertSucceeds(addDoc(collection(lguStaff(), "zoneHistory/z1/updates"), { editorUid: "staff1", action: "created" }));
    await seed("zoneHistory/z1/updates/u1", { editorUid: "staff1" });
    await assertFails(updateDoc(doc(lguStaff(), "zoneHistory/z1/updates/u1"), { action: "x" }));
    await assertFails(deleteDoc(doc(superAdmin(), "zoneHistory/z1/updates/u1")));
  });
});

// =============================================================================
describe("users & privilege escalation", () => {
  it("a citizen can create their own profile only with role 'citizen'", async () => {
    await assertSucceeds(setDoc(doc(citizen(), "users/cit1"), { name: "C", email: "c@x.ph", role: "citizen", orgId: null, active: true }));
  });

  it("a citizen cannot self-assign a privileged role or organization", async () => {
    await assertFails(setDoc(doc(citizen(), "users/cit1"), { name: "C", role: "super_admin", active: true }));
    await assertFails(setDoc(doc(citizen(), "users/cit1"), { name: "C", role: "citizen", orgId: "org_lgu_calapan", active: true }));
    await seed("users/cit1", { name: "C", role: "citizen", orgId: null, active: true });
    await assertFails(updateDoc(doc(citizen(), "users/cit1"), { role: "lgu_admin" }));
    await assertFails(updateDoc(doc(citizen(), "users/cit1"), { orgId: "org_lgu_calapan" }));
    await assertSucceeds(updateDoc(doc(citizen(), "users/cit1"), { name: "New name", alertPrefs: { radiusM: 5000 } }));
  });

  it("users cannot read other users' profiles", async () => {
    await seed("users/cit2", { name: "Other" });
    await assertFails(getDoc(doc(citizen(), "users/cit2")));
    await assertSucceeds(getDoc(doc(legacyAdmin(), "users/cit2")));
    await assertSucceeds(getDoc(doc(superAdmin(), "users/cit2")));
  });

  it("saved locations and contacts are private to their owner", async () => {
    await assertSucceeds(setDoc(doc(citizen(), "users/cit1/saved_locations/home"), {
      label: "home", name: "Home", location: { lat: 13.4, lng: 121.18 }, alertRadiusM: 2000,
    }));
    await assertFails(getDoc(doc(citizen("cit2"), "users/cit1/saved_locations/home")));
    await assertFails(setDoc(doc(guest(), "users/guest1/saved_locations/home"), {
      label: "home", name: "Home", location: { lat: 13.4, lng: 121.18 }, alertRadiusM: 2000,
    }));
  });

  it("notifications: owner can only flip the read flag", async () => {
    await seed("users/cit1/notifications/n1", { kind: "billing", title: "x", body: "y", read: false });
    await assertSucceeds(updateDoc(doc(citizen(), "users/cit1/notifications/n1"), { read: true }));
    await assertFails(updateDoc(doc(citizen(), "users/cit1/notifications/n1"), { title: "forged" }));
    await assertFails(addDoc(collection(citizen(), "users/cit1/notifications"), { kind: "billing", title: "x", body: "y", read: false }));
  });

  it("chat history is readable by its owner but never client-writable", async () => {
    await seed("ai_chat_history/cit1/messages/m1", { role: "user", content: "hi" });
    await assertSucceeds(getDoc(doc(citizen(), "ai_chat_history/cit1/messages/m1")));
    await assertFails(getDoc(doc(citizen("cit2"), "ai_chat_history/cit1/messages/m1")));
    await assertFails(addDoc(collection(citizen(), "ai_chat_history/cit1/messages"), { role: "assistant", content: "x" }));
  });
});

// =============================================================================
describe("multi-tenant isolation", () => {
  it("org documents are visible to members only", async () => {
    await assertSucceeds(getDoc(doc(lguStaff(), "organizations/org_lgu_calapan")));
    await assertFails(getDoc(doc(lguStaff(), "organizations/org_lgu_baco")));
    await assertFails(getDoc(doc(bizAdmin(), "organizations/org_lgu_calapan")));
    await assertSucceeds(getDoc(doc(superAdmin(), "organizations/org_lgu_baco")));
  });

  it("no client can write organizations or memberships (no self-granted entitlements)", async () => {
    await assertFails(updateDoc(doc(lguAdmin(), "organizations/org_lgu_calapan"), { "entitlements.apiAccess": true }));
    await assertFails(setDoc(doc(bizAdmin(), "organizations/org_biz_express/members/x"), { role: "business_admin" }));
    await assertFails(updateDoc(doc(superAdmin(), "organizations/org_lgu_calapan"), { planId: "enterprise" }));
  });

  it("incidents are isolated per organization", async () => {
    await seed("incidents/i1", { orgId: "org_lgu_calapan", title: "x" });
    await assertSucceeds(getDoc(doc(lguStaff(), "incidents/i1")));
    await assertFails(getDoc(doc(lguStaff("s9", "Baco", "org_lgu_baco"), "incidents/i1")));
    await assertFails(getDoc(doc(citizen(), "incidents/i1")));
    await assertSucceeds(getDocs(query(collection(lguStaff(), "incidents"), where("orgId", "==", "org_lgu_calapan"))));
    await assertFails(getDocs(query(collection(lguStaff(), "incidents"), where("orgId", "==", "org_lgu_baco"))));
  });

  it("billing records are visible to that org's admins only", async () => {
    await seed("subscriptions/s1", { orgId: "org_biz_express", status: "active" });
    await seed("payment_transactions/t1", { orgId: "org_biz_express", amountPhp: 2000 });
    await seed("billing_invoices/inv1", { orgId: "org_biz_express", totalPhp: 2000 });
    await assertSucceeds(getDoc(doc(bizAdmin(), "subscriptions/s1")));
    await assertSucceeds(getDoc(doc(bizAdmin(), "payment_transactions/t1")));
    await assertSucceeds(getDoc(doc(bizAdmin(), "billing_invoices/inv1")));
    await assertFails(getDoc(doc(bizStaff(), "payment_transactions/t1")));
    await assertFails(getDoc(doc(bizAdmin("x", "org_biz_free"), "payment_transactions/t1")));
    await assertFails(getDoc(doc(lguAdmin(), "subscriptions/s1")));
    await assertSucceeds(getDoc(doc(superAdmin(), "payment_transactions/t1")));
  });

  it("nobody can write billing or payment records from a client", async () => {
    for (const db of [bizAdmin(), superAdmin(), citizen()]) {
      await assertFails(setDoc(doc(db, "subscriptions/s9"), { orgId: "org_biz_express", status: "active" }));
      await assertFails(setDoc(doc(db, "payment_transactions/t9"), { orgId: "org_biz_express", status: "paid" }));
      await assertFails(setDoc(doc(db, "webhook_events/x"), { a: 1 }));
      await assertFails(setDoc(doc(db, "subscription_plans/lgu_pro"), { priceMonthlyPhp: 0 }));
    }
  });

  it("audit logs: Super Admin sees all, org admins see their org", async () => {
    await seed("audit_logs/l1", { orgId: "org_lgu_calapan", action: "x" });
    await seed("audit_logs/l2", { orgId: null, action: "platform" });
    await assertSucceeds(getDoc(doc(lguAdmin(), "audit_logs/l1")));
    await assertFails(getDoc(doc(lguAdmin(), "audit_logs/l2")));
    await assertFails(getDoc(doc(lguStaff(), "audit_logs/l1")));
    await assertSucceeds(getDoc(doc(superAdmin(), "audit_logs/l2")));
  });
});

// =============================================================================
describe("subscription enforcement in rules", () => {
  const incident = (orgId: string, uid = "staff1") => ({
    orgId, title: "Flooding at Bucayao", type: "flood", severity: "high", status: "open",
    area: "Calapan City", description: "", linkedReportIds: [], assignedTo: [], createdBy: uid,
    createdByName: "Staff", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });

  it("incident management requires the paid entitlement", async () => {
    await assertSucceeds(addDoc(collection(lguStaff(), "incidents"), incident("org_lgu_calapan")));
    await assertFails(addDoc(collection(lguStaff("s3", "Calapan City", "org_lgu_unpaid"), "incidents"), incident("org_lgu_unpaid", "s3")));
  });

  it("staff cannot create incidents for another organization", async () => {
    await assertFails(addDoc(collection(lguStaff(), "incidents"), incident("org_lgu_baco")));
  });

  it("fleet routes require fleetMonitoring", async () => {
    const route = (orgId: string, uid: string) => ({
      orgId, name: "Calapan loop", vehicle: "truck", createdBy: uid,
      stops: [{ label: "A", location: { lat: 13.4, lng: 121.18 } }, { label: "B", location: { lat: 13.41, lng: 121.19 } }],
    });
    await assertSucceeds(addDoc(collection(bizStaff(), "organizations/org_biz_express/saved_routes"), route("org_biz_express", "biz1")));
    await assertFails(addDoc(collection(bizStaff("b2", "org_biz_free"), "organizations/org_biz_free/saved_routes"), route("org_biz_free", "b2")));
    await assertFails(addDoc(collection(bizStaff(), "organizations/org_biz_free/saved_routes"), route("org_biz_free", "biz1")));
  });

  it("AI quota counters can be read by their owner but never written", async () => {
    await seed("ai_usage_records/user_cit1_2026-10-09", { subjectType: "user", subjectId: "cit1", chat: 3 });
    await assertSucceeds(getDoc(doc(citizen(), "ai_usage_records/user_cit1_2026-10-09")));
    await assertFails(getDoc(doc(citizen("cit2"), "ai_usage_records/user_cit1_2026-10-09")));
    await assertFails(updateDoc(doc(citizen(), "ai_usage_records/user_cit1_2026-10-09"), { chat: 0 }));
    await assertFails(updateDoc(doc(superAdmin(), "ai_usage_records/user_cit1_2026-10-09"), { chat: 0 }));
    // Not-yet-created counters are readable by their subject (no error on first use)…
    await assertSucceeds(getDoc(doc(citizen(), "ai_usage_records/user_cit1_2026-11")));
    await assertSucceeds(getDoc(doc(bizAdmin(), "ai_usage_records/org_org_biz_express_2026-11")));
    // …but never another org's or another user's.
    await assertFails(getDoc(doc(bizAdmin(), "ai_usage_records/org_org_lgu_calapan_2026-11")));
    await assertFails(getDoc(doc(bizStaff(), "ai_usage_records/org_org_biz_express_2026-11")));
    await assertFails(getDoc(doc(citizen(), "ai_usage_records/user_cit2_2026-11")));
  });
});

// =============================================================================
describe("community reports & verification", () => {
  it("clients cannot create or verify reports directly (backend only)", async () => {
    await assertFails(addDoc(collection(citizen(), "community_reports"), { reporterUid: "cit1", status: "pending" }));
    await seed("community_reports/r1", { reporterUid: "cit1", status: "pending", area: "Calapan City" });
    await assertFails(updateDoc(doc(citizen(), "community_reports/r1"), { status: "verified" }));
    await assertFails(updateDoc(doc(lguStaff(), "community_reports/r1"), { status: "verified" }));
  });

  it("pending reports are visible to their reporter and LGU staff only", async () => {
    await seed("community_reports/r1", { reporterUid: "cit1", status: "pending" });
    await seed("community_reports/r2", { reporterUid: "cit2", status: "verified" });
    await assertSucceeds(getDoc(doc(citizen(), "community_reports/r1")));
    await assertFails(getDoc(doc(citizen("cit2"), "community_reports/r1")));
    await assertFails(getDoc(doc(anonymous(), "community_reports/r1")));
    await assertSucceeds(getDoc(doc(lguStaff(), "community_reports/r1")));
    await assertSucceeds(getDoc(doc(anonymous(), "community_reports/r2")));
    await assertSucceeds(getDocs(query(collection(anonymous(), "community_reports"), where("status", "==", "verified"))));
  });

  it("a reporter can withdraw only their own pending report", async () => {
    await seed("community_reports/r1", { reporterUid: "cit1", status: "pending" });
    await seed("community_reports/r2", { reporterUid: "cit1", status: "verified" });
    await assertFails(deleteDoc(doc(citizen("cit2"), "community_reports/r1")));
    await assertFails(deleteDoc(doc(citizen(), "community_reports/r2")));
    await assertSucceeds(deleteDoc(doc(citizen(), "community_reports/r1")));
  });
});

// =============================================================================
describe("evacuation centers, road closures, SOS", () => {
  const center = (overrides: Record<string, unknown> = {}) => ({
    name: "Calapan Central School", address: "Calapan", area: "Calapan City",
    location: { lat: 13.41, lng: 121.18 }, capacity: 300, occupancy: 120, occupancyVerified: true,
    status: "open", facilities: ["water"], contact: {}, orgId: "org_lgu_calapan", verified: true,
    updatedBy: "staff1", updatedAt: serverTimestamp(), ...overrides,
  });

  it("LGU staff manage centers in their area; occupancy cannot exceed capacity", async () => {
    await assertSucceeds(setDoc(doc(lguStaff(), "evacuation_centers/c1"), center()));
    await assertFails(setDoc(doc(lguStaff(), "evacuation_centers/c2"), center({ occupancy: 500 })));
    await assertFails(setDoc(doc(lguStaff(), "evacuation_centers/c3"), center({ area: "Baco" })));
    await assertFails(setDoc(doc(citizen(), "evacuation_centers/c4"), center({ updatedBy: "cit1" })));
  });

  it("road closures can only be set by DRRM personnel for their area", async () => {
    const road = {
      name: "J.P. Rizal St", path: [{ lat: 13.41, lng: 121.17 }, { lat: 13.412, lng: 121.172 }], status: "closed",
      passability: { bike: false, motor: false, fourWheel: false, suvPickup: false, truck: false },
      reason: "Flooded", area: "Calapan City", source: "drrm", active: true, updatedBy: "staff1",
    };
    await assertSucceeds(setDoc(doc(lguStaff(), "road_conditions/r1"), road));
    await assertFails(setDoc(doc(citizen(), "road_conditions/r2"), { ...road, updatedBy: "cit1" }));
    await assertFails(setDoc(doc(bizAdmin(), "road_conditions/r3"), { ...road, updatedBy: "bizadmin1" }));
    await assertFails(setDoc(doc(lguStaff("s9", "Baco", "org_lgu_baco"), "road_conditions/r4"), { ...road, updatedBy: "s9" }));
  });

  it("SOS: anyone signed in can raise; only LGU staff acknowledge", async () => {
    const sos = { uid: "guest1", location: { lat: 13.41, lng: 121.18 }, area: "Calapan City", message: "Trapped", status: "open", createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertSucceeds(setDoc(doc(guest(), "sos_requests/s1"), sos));
    await assertFails(setDoc(doc(guest(), "sos_requests/s2"), { ...sos, uid: "someone" }));
    await assertFails(setDoc(doc(guest(), "sos_requests/s3"), { ...sos, status: "acknowledged" }));
    await assertFails(setDoc(doc(anonymous(), "sos_requests/s4"), sos));
    // self-acknowledgement is not allowed
    await assertFails(updateDoc(doc(guest(), "sos_requests/s1"), { status: "acknowledged", acknowledgedBy: "guest1", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(guest(), "sos_requests/s1"), { status: "cancelled", updatedAt: serverTimestamp() }));
    await seed("sos_requests/s5", { ...sos, createdAt: new Date(), updatedAt: new Date() });
    await assertSucceeds(updateDoc(doc(lguStaff(), "sos_requests/s5"), { status: "acknowledged", acknowledgedBy: "staff1", acknowledgedByName: "Staff", updatedAt: serverTimestamp() }));
    await assertFails(getDoc(doc(citizen(), "sos_requests/s5")));
  });

  it("alerts can only be issued through the backend", async () => {
    await assertFails(addDoc(collection(lguAdmin(), "alerts"), { title: "x" }));
    await assertFails(addDoc(collection(superAdmin(), "alerts"), { title: "x" }));
  });

  it("advisories: staff write drafts; publishing is backend-only", async () => {
    const adv = { orgId: "org_lgu_calapan", title: "Heavy rain", body: "Stay alert", severity: "moderate", areas: ["Calapan City"], status: "draft", aiDrafted: true, createdBy: "staff1", createdByName: "Staff" };
    await assertSucceeds(setDoc(doc(lguStaff(), "advisories/a1"), adv));
    await assertFails(setDoc(doc(lguStaff(), "advisories/a2"), { ...adv, status: "published" }));
    await assertFails(setDoc(doc(lguStaff(), "advisories/a3"), { ...adv, areas: ["Bulalacao"] }));
    await assertFails(setDoc(doc(citizen(), "advisories/a4"), { ...adv, createdBy: "cit1" }));
  });

  it("LGU applications must be pending and self-attributed", async () => {
    const app = { applicantUid: "cit1", status: "pending", type: "lgu", orgName: "Naujan MDRRMO", jurisdictionAreas: ["Naujan"] };
    await assertSucceeds(addDoc(collection(citizen(), "org_applications"), app));
    await assertFails(addDoc(collection(citizen(), "org_applications"), { ...app, status: "approved" }));
    await assertFails(addDoc(collection(citizen(), "org_applications"), { ...app, applicantUid: "other" }));
    await assertFails(addDoc(collection(guest(), "org_applications"), { ...app, applicantUid: "guest1" }));
  });
});
