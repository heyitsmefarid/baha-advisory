/**
 * Repeatable database initializer + demo data.
 *
 *   npm run seed -- --emulator                 # local Emulator Suite
 *   npm run seed -- --emulator --reset-demo    # wipe & re-create demo data only
 *   npm run seed -- --production --plans-only  # real project: plans/settings only
 *   npm run seed -- --production --demo        # real project + demo data (hackathon)
 *
 * Guarantees
 *  - Idempotent: fixed document IDs, safe to re-run.
 *  - Never touches non-demo records. --reset-demo only deletes documents
 *    flagged `simulated: true` / `isDemo: true` and *@demo.bahadvisory.test users.
 *  - Every demo record is flagged and labelled "(Demo)"/"Simulated" in the UI.
 *    Nothing here is real flood information.
 *  - Demo passwords come from DEMO_ACCOUNT_PASSWORD (never hard-coded).
 *  - Subscription plans are only created if missing, so Super Admin price
 *    edits survive re-seeding (use --reset-plans to restore defaults).
 */
import { randomBytes } from "node:crypto";
import { setupScriptEnv } from "./lib/scriptEnv";

const ctx = setupScriptEnv();

const { getDb, getAdminAuth } = await import("../server/lib/firebaseAdmin");
const { Timestamp, FieldValue } = await import("firebase-admin/firestore");
const { DEFAULT_PLANS, DEFAULT_PLAN_BY_ID, computeEntitlements } = await import("../shared/plans");
const { suggestPassability, suggestRoadPassability } = await import("../shared/passability");
const { circleToPolygon, destinationPoint } = await import("../shared/geo");
const { addPeriod, invoiceNumber, monthlyEquivalent, toMinor } = await import("../shared/billing");
const { DEFAULT_ALERT_PREFERENCES } = await import("../shared/types");
const { grantForUnit, legacyAreaToMunicipality, MINDORO_CATALOG, MINDORO_REGION_PSGC } = await import("../shared/geography");

type Pt = [number, number];
const db = getDb();
const auth = getAdminAuth();
const NOW = Date.now();
const H = 3600_000;
const D = 24 * H;
const ts = (ms: number) => Timestamp.fromMillis(ms);
const ll = (p: Pt) => ({ lat: p[0], lng: p[1] });
const poly = (center: Pt, radiusM: number, sides = 10) => circleToPolygon(center, radiusM, sides).map(ll);
const geography = (area: string, assignedBy = "seed") => {
  const municipality = legacyAreaToMunicipality(area);
  if (!municipality?.provincePsgcCode) throw new Error(`Seed area is not a supported Mindoro LGU: ${area}`);
  return {
    regionPsgcCode: MINDORO_REGION_PSGC,
    provincePsgcCode: municipality.provincePsgcCode,
    municipalityPsgcCode: municipality.psgcCode,
    barangayPsgcCode: null,
    locationAssignment: {
      method: "migrated" as const,
      confidence: "medium" as const,
      sourceVersion: municipality.sourceVersion,
      assignedAt: NOW,
      assignedBy,
    },
    geographyMigrationVersion: "mindoro-psgc-q2-2026-v1",
  };
};

const DEMO_DOMAIN = "demo.bahadvisory.test";
const SEED_DEMO = !ctx.flag("--plans-only") && (ctx.emulator || ctx.flag("--demo"));

console.log(`\nBahadvisory seed → ${ctx.emulator ? "EMULATOR" : "PRODUCTION"} project "${ctx.projectId}"`);
console.log(`  demo data: ${SEED_DEMO ? "yes" : "no"}\n`);

// =============================================================================
// 1. Platform settings & plans (always)
// =============================================================================

async function seedPlatform() {
  const general = db.doc("platform_settings/general");
  const g = await general.get();
  await general.set(
    {
      ...(g.exists
        ? {}
        : {
            aiEnabled: true,
            chatbotEnabled: true,
            imageAnalysisEnabled: true,
            publicReportingEnabled: true,
            emergencyHotlines: [{ label: "National emergency hotline", number: "911" }],
            maintenanceMessage: null,
          }),
      demoMode: SEED_DEMO ? true : g.get("demoMode") ?? false,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: "seed",
    },
    { merge: true }
  );

  const ai = db.doc("platform_settings/ai");
  if (!(await ai.get()).exists) {
    // USD per 1M tokens — LIST-PRICE ESTIMATES for cost reporting only.
    // Free-tier usage is billed at $0 by the providers; the Super Admin
    // dashboard shows what the same traffic would cost on paid tiers.
    await ai.set({
      pricing: {
        "llama-3.3-70b-versatile": { inputPerM: 0.59, outputPerM: 0.79 },
        "llama-3.1-8b-instant": { inputPerM: 0.05, outputPerM: 0.08 },
        "openai/gpt-oss-20b": { inputPerM: 0.1, outputPerM: 0.5 },
        "gemini-3.8-flash": { inputPerM: 0.3, outputPerM: 2.5 },
        "gemini-3.5-flash-lite": { inputPerM: 0.1, outputPerM: 0.4 },
        default: { inputPerM: 0.5, outputPerM: 1.5 },
      },
      perUserPerMinute: 8,
      cacheTtlMinutes: 360,
      pricingNote: "List-price estimates for planning; verify against current provider pricing.",
    });
  }

  const features = db.doc("platform_settings/features");
  if (!(await features.get()).exists) {
    await features.set({ fleetMonitoring: true, apiAccess: true, revenueSimulator: true, demoGuide: true });
  }

  for (const plan of DEFAULT_PLANS) {
    const ref = db.doc(`subscription_plans/${plan.id}`);
    if (ctx.flag("--reset-plans") || !(await ref.get()).exists) {
      await ref.set({ ...plan, updatedAt: FieldValue.serverTimestamp(), updatedBy: "seed" });
      console.log(`  plan ${plan.id} written`);
    }
  }
  console.log("✓ platform settings & plans");
}

async function seedGeographyCatalog() {
  let batch = db.batch();
  let pending = 0;
  for (const unit of MINDORO_CATALOG) {
    // Firestore permits arrays, but not arrays nested directly inside arrays.
    // Keep tuple-shaped coordinates in the generated TypeScript catalog and
    // persist the same values as named maps in the queryable catalog.
    const { center, boundingBox, ...catalogFields } = unit;
    batch.set(db.doc(`geographic_units/${unit.psgcCode}`), {
      ...catalogFields,
      center: { lat: center[0], lng: center[1] },
      boundingBox: {
        southWest: { lat: boundingBox[0][0], lng: boundingBox[0][1] },
        northEast: { lat: boundingBox[1][0], lng: boundingBox[1][1] },
      },
      authoritativeIdentifiers: true,
      source: "Philippine Statistics Authority PSGC 2Q 2026",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    pending++;
    if (pending === 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending) await batch.commit();

  const municipalities = MINDORO_CATALOG.filter((unit) => unit.level === "city" || unit.level === "municipality");
  for (const unit of municipalities) {
    await db.doc(`geographic_source_status/${unit.psgcCode}`).set({
      psgcCode: unit.psgcCode,
      provincePsgcCode: unit.provincePsgcCode,
      status: unit.psgcCode === "1705205000" && SEED_DEMO ? "simulated_demo_pilot" : "no_verified_feed",
      operationalCoverageClaimed: false,
      note: unit.psgcCode === "1705205000" && SEED_DEMO
        ? "Calapan hackathon pilot uses clearly labelled simulated operational data."
        : "Geographic navigation is supported; no verified real-time operational feed is configured.",
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  console.log("Geography catalog and source-status records written");
}

// =============================================================================
// 2. Demo reset (flagged records only)
// =============================================================================

const DEMO_COLLECTIONS = [
  "floodZones",
  "road_conditions",
  "water_level_stations",
  "evacuation_centers",
  "community_reports",
  "report_media",
  "incidents",
  "advisories",
  "alerts",
  "sos_requests",
  "subscriptions",
  "payment_transactions",
  "billing_invoices",
  "organizations",
  "ai_analysis_results",
];

async function resetDemo() {
  let removed = 0;
  for (const col of DEMO_COLLECTIONS) {
    for (const flag of ["simulated", "isDemo"]) {
      const snap = await db.collection(col).where(flag, "==", true).get();
      for (const d of snap.docs) {
        await db.recursiveDelete(d.ref);
        removed++;
      }
    }
  }
  // zoneHistory for demo zones
  const hist = await db.collection("zoneHistory").get();
  for (const d of hist.docs) if (d.id.startsWith("z_demo_")) await db.recursiveDelete(d.ref);
  // demo users
  const list = await auth.listUsers(1000);
  for (const u of list.users) {
    if (u.email?.endsWith(`@${DEMO_DOMAIN}`)) {
      await auth.deleteUser(u.uid);
      await db.recursiveDelete(db.doc(`users/${u.uid}`));
      await db.recursiveDelete(db.doc(`ai_chat_history/${u.uid}`));
      removed++;
    }
  }
  console.log(`✓ reset demo data (${removed} demo records/users removed; real data untouched)`);
}

// =============================================================================
// 3. Demo organizations & accounts
// =============================================================================

const ORGS = {
  calapan: {
    id: "org_demo_lgu_calapan",
    name: "Calapan City DRRMO (Demo)",
    type: "lgu" as const,
    jurisdictionAreas: ["Calapan City", "Baco"],
    planId: "lgu_pro",
    active: true,
    hotlines: [{ label: "Calapan DRRMO (demo number)", number: "0917-000-0101" }],
  },
  naujan: {
    id: "org_demo_lgu_naujan",
    name: "Naujan MDRRMO (Demo, no subscription)",
    type: "lgu" as const,
    jurisdictionAreas: ["Naujan"],
    planId: null,
    active: false,
    hotlines: [],
  },
  orientalProvince: {
    id: "org_demo_province_oriental",
    name: "Oriental Mindoro PDRRMO (Demo)",
    type: "lgu" as const,
    jurisdictionAreas: [],
    jurisdictionPsgcCode: "1705200000",
    planId: "lgu_pro",
    active: true,
    hotlines: [],
  },
  express: {
    id: "org_demo_biz_express",
    name: "Mindoro Express Logistics (Demo)",
    type: "business" as const,
    jurisdictionAreas: [],
    planId: "business_pro",
    active: true,
    hotlines: [],
  },
  isla: {
    id: "org_demo_enterprise_isla",
    name: "Isla Group of Companies (Demo)",
    type: "enterprise" as const,
    jurisdictionAreas: [],
    planId: "enterprise",
    active: true,
    hotlines: [],
  },
  islaBranch: {
    id: "org_demo_enterprise_isla_calapan",
    name: "Isla Group — Calapan Branch (Demo)",
    type: "business" as const,
    jurisdictionAreas: [],
    planId: "enterprise",
    active: true,
    hotlines: [],
    parentOrgId: "org_demo_enterprise_isla",
  },
};

async function seedOrgs() {
  const grantedMunicipalities = new Set<string>();
  for (const o of Object.values(ORGS)) {
    const plan = o.planId ? DEFAULT_PLAN_BY_ID[o.planId] : null;
    await db.doc(`organizations/${o.id}`).set({
      name: o.name,
      type: o.type,
      status: "active",
      jurisdictionAreas: o.jurisdictionAreas,
      parentOrgId: (o as { parentOrgId?: string }).parentOrgId ?? null,
      planId: o.planId,
      subscriptionId: o.active ? `sub_demo_${o.id.replace("org_demo_", "")}` : null,
      subscriptionStatus: o.active ? "active" : o.id === ORGS.naujan.id ? "canceled" : "none",
      entitlements: computeEntitlements(plan, { subscriptionActive: o.active }),
      addOns: o.id === ORGS.express.id ? ["apiAccess"] : [],
      hotlines: o.hotlines,
      contactEmail: `contact@${DEMO_DOMAIN}`,
      createdAt: ts(NOW - 120 * D),
      createdBy: "seed",
      isDemo: true,
    });
    for (const area of o.jurisdictionAreas) {
      const municipality = legacyAreaToMunicipality(area);
      if (!municipality) throw new Error(`Unsupported seed jurisdiction: ${area}`);
      await db.doc(`organizations/${o.id}/jurisdiction_grants/${municipality.psgcCode}`).set(
        grantForUnit(municipality.psgcCode, o.id, "seed", ts(NOW - 120 * D)),
      );
      grantedMunicipalities.add(municipality.psgcCode);
    }
    const jurisdictionPsgcCode = (o as { jurisdictionPsgcCode?: string }).jurisdictionPsgcCode;
    if (jurisdictionPsgcCode) {
      await db.doc(`organizations/${o.id}/jurisdiction_grants/${jurisdictionPsgcCode}`).set(
        grantForUnit(jurisdictionPsgcCode, o.id, "seed", ts(NOW - 120 * D)),
      );
    }
  }
  for (const unit of MINDORO_CATALOG.filter((candidate) => candidate.level === "city" || candidate.level === "municipality")) {
    if (grantedMunicipalities.has(unit.psgcCode)) continue;
    const orgId = `org_demo_lgu_${unit.psgcCode}`;
    await db.doc(`organizations/${orgId}`).set({
      name: `${unit.name} DRRMO (Demo coverage placeholder)`,
      type: "lgu",
      status: "active",
      jurisdictionAreas: [unit.name],
      parentOrgId: null,
      planId: null,
      subscriptionId: null,
      subscriptionStatus: "none",
      entitlements: computeEntitlements(null, { subscriptionActive: false }),
      addOns: [],
      hotlines: [],
      contactEmail: `contact@${DEMO_DOMAIN}`,
      dataStatus: "no_verified_feed",
      createdAt: ts(NOW - 120 * D),
      createdBy: "seed",
      isDemo: true,
    }, { merge: true });
    await db.doc(`organizations/${orgId}/jurisdiction_grants/${unit.psgcCode}`).set(
      grantForUnit(unit.psgcCode, orgId, "seed", ts(NOW - 120 * D)),
    );
  }
  console.log("✓ demo organizations");
}

interface DemoAccount {
  key: string;
  email: string;
  name: string;
  role: string;
  orgId?: string;
  assignedArea?: string;
  areas?: string[];
}

const ACCOUNTS: DemoAccount[] = [
  { key: "citizen", email: `citizen@${DEMO_DOMAIN}`, name: "Juan dela Cruz (Demo)", role: "citizen" },
  { key: "citizen2", email: `citizen2@${DEMO_DOMAIN}`, name: "Maria Santos (Demo)", role: "citizen" },
  {
    key: "lguAdmin", email: `lgu.admin@${DEMO_DOMAIN}`, name: "Engr. Ana Reyes (Demo)", role: "lgu_admin",
    orgId: ORGS.calapan.id, assignedArea: "Calapan City", areas: ["Calapan City", "Baco"],
  },
  {
    key: "lguStaff", email: `lgu.staff@${DEMO_DOMAIN}`, name: "Mark Villanueva (Demo)", role: "lgu_staff",
    orgId: ORGS.calapan.id, assignedArea: "Calapan City",
  },
  {
    key: "naujanAdmin", email: `naujan.admin@${DEMO_DOMAIN}`, name: "Liza Mendoza (Demo)", role: "lgu_admin",
    orgId: ORGS.naujan.id, assignedArea: "Naujan", areas: ["Naujan"],
  },
  {
    key: "provincialAdmin", email: `oriental.province@${DEMO_DOMAIN}`, name: "Oriental Mindoro PDRRMO (Demo)", role: "lgu_admin",
    orgId: ORGS.orientalProvince.id, assignedArea: "Oriental Mindoro", areas: [],
  },
  { key: "bizAdmin", email: `business.admin@${DEMO_DOMAIN}`, name: "Carlo Tan (Demo)", role: "business_admin", orgId: ORGS.express.id },
  { key: "bizStaff", email: `business.staff@${DEMO_DOMAIN}`, name: "Joy Ramos (Demo)", role: "business_staff", orgId: ORGS.express.id },
  { key: "entAdmin", email: `enterprise.admin@${DEMO_DOMAIN}`, name: "Atty. Ben Lim (Demo)", role: "enterprise_admin", orgId: ORGS.isla.id },
  { key: "super", email: `super@${DEMO_DOMAIN}`, name: "Platform Owner (Demo)", role: "super_admin" },
];

const uids: Record<string, string> = {};

async function seedAccounts() {
  let password = process.env.DEMO_ACCOUNT_PASSWORD ?? "";
  let generated = false;
  if (password.length < 8) {
    if (!ctx.emulator) throw new Error("Set DEMO_ACCOUNT_PASSWORD (8+ characters) to create demo accounts in a real project.");
    password = `Demo-${randomBytes(6).toString("base64url")}`;
    generated = true;
  }
  for (const a of ACCOUNTS) {
    let uid: string;
    try {
      uid = (await auth.getUserByEmail(a.email)).uid;
      await auth.updateUser(uid, { password, displayName: a.name, disabled: false });
    } catch {
      uid = (await auth.createUser({ email: a.email, password, displayName: a.name, emailVerified: true })).uid;
    }
    uids[a.key] = uid;
    const claims: Record<string, unknown> = {};
    if (a.role !== "citizen") claims.role = a.role;
    if (a.orgId) claims.orgId = a.orgId;
    await auth.setCustomUserClaims(uid, claims);
    await db.doc(`users/${uid}`).set({
      name: a.name,
      email: a.email,
      role: a.role,
      orgId: a.orgId ?? null,
      assignedArea: a.assignedArea ?? "",
      active: true,
      alertPrefs: DEFAULT_ALERT_PREFERENCES,
      createdAt: ts(NOW - 60 * D),
      isDemo: true,
    });
    if (a.orgId) {
      await db.doc(`organizations/${a.orgId}/members/${uid}`).set({
        name: a.name,
        email: a.email,
        role: a.role,
        assignedArea: a.assignedArea ?? null,
        active: true,
        addedAt: ts(NOW - 60 * D),
        addedBy: "seed",
      });
    }
  }
  // Citizen saved places & an emergency contact
  await db.doc(`users/${uids.citizen}/saved_locations/home`).set({
    label: "home", name: "Home — Lalud (Demo)", location: ll([13.4032, 121.1855]), alertRadiusM: 2000, createdAt: ts(NOW - 30 * D),
  });
  await db.doc(`users/${uids.citizen}/saved_locations/school`).set({
    label: "school", name: "School — Calapan Central (Demo)", location: ll([13.4135, 121.1797]), alertRadiusM: 1500, createdAt: ts(NOW - 30 * D),
  });
  await db.doc(`users/${uids.citizen}/emergency_contacts/c1`).set({
    name: "Rosa dela Cruz (Demo)", phone: "0917-000-0199", relationship: "Mother",
  });
  console.log(`✓ ${ACCOUNTS.length} demo accounts`);
  if (generated) {
    console.log(`  DEMO_ACCOUNT_PASSWORD was not set — generated for this emulator run: ${password}`);
  } else {
    console.log("  password: value of DEMO_ACCOUNT_PASSWORD");
  }
}

// =============================================================================
// 4. Flood zones, history, roads, stations
// =============================================================================

interface ZoneSeed {
  id: string;
  name: string;
  area: string;
  center: Pt;
  radiusM: number;
  level: number;
  trend: "rising" | "falling" | "steady";
  delta: number;
  notes: string;
  editor: string;
}

const ACTIVE_ZONES: ZoneSeed[] = [
  { id: "z_demo_bucayao", name: "Bucayao Road near the bridge (Demo)", area: "Calapan City", center: [13.3838, 121.1752], radiusM: 260, level: 0.55, trend: "rising", delta: 0.08, notes: "SIMULATED: knee-to-tire deep water reported over the road. Light vehicles advised to detour.", editor: "lguStaff" },
  { id: "z_demo_lalud", name: "Lalud — low point beside the market (Demo)", area: "Calapan City", center: [13.4031, 121.1883], radiusM: 180, level: 0.3, trend: "steady", delta: 0, notes: "SIMULATED: half-tire level, drainage slow.", editor: "lguStaff" },
  { id: "z_demo_canubing", name: "Canubing I — national highway shoulder (Demo)", area: "Calapan City", center: [13.3546, 121.2079], radiusM: 220, level: 0.22, trend: "falling", delta: -0.05, notes: "SIMULATED: receding.", editor: "lguAdmin" },
  { id: "z_demo_baco", name: "Baco — Poblacion riverside (Demo)", area: "Baco", center: [13.3594, 121.0991], radiusM: 300, level: 0.98, trend: "rising", delta: 0.12, notes: "SIMULATED: road closed to all vehicles; residents near the river advised to move to higher ground.", editor: "lguAdmin" },
  { id: "z_demo_naujan", name: "Naujan — Poblacion (Demo)", area: "Naujan", center: [13.3239, 121.3009], radiusM: 200, level: 0.35, trend: "steady", delta: 0, notes: "SIMULATED.", editor: "naujanAdmin" },
];

async function seedZones() {
  for (const z of ACTIVE_ZONES) {
    const editorUid = uids[z.editor];
    const editorName = ACCOUNTS.find((a) => a.key === z.editor)!.name;
    const data = {
      ...geography(z.area),
      name: z.name,
      geometry: { type: "polygon", coordinates: poly(z.center, z.radiusM) },
      waterLevelM: z.level,
      trend: z.trend,
      trendDeltaM: z.delta,
      roadPassability: suggestRoadPassability(z.level),
      passability: suggestPassability(z.level),
      notes: z.notes,
      status: "active",
      area: z.area,
      source: z.id === "z_demo_bucayao" ? "community_report" : "drrm",
      sourceReportIds: z.id === "z_demo_bucayao" ? ["rpt_demo_verified_bucayao"] : [],
      updatedBy: editorUid,
      updatedByName: editorName,
      updatedAt: ts(NOW - (z.id === "z_demo_baco" ? 25 : 70) * 60_000),
      simulated: true,
    };
    await db.doc(`floodZones/${z.id}`).set(data);
    await db.doc(`zoneHistory/${z.id}/updates/created`).set({
      zoneName: z.name, changedFields: { waterLevelM: z.level, status: "active" }, editorUid, editorName,
      action: "created", timestamp: ts(NOW - 5 * H), simulated: true,
    });
    await db.doc(`zoneHistory/${z.id}/updates/latest`).set({
      zoneName: z.name, changedFields: { waterLevelM: z.level, trend: z.trend }, editorUid, editorName,
      action: "updated", timestamp: ts(NOW - 70 * 60_000), simulated: true,
    });
  }

  // Historical (cleared) zones over the past 90 days → analytics history.
  const places: { name: string; area: string; center: Pt }[] = [
    { name: "Ibaba East", area: "Calapan City", center: [13.4148, 121.1862] },
    { name: "Sto. Niño", area: "Calapan City", center: [13.4088, 121.1758] },
    { name: "Guinobatan", area: "Calapan City", center: [13.3913, 121.1662] },
    { name: "San Vicente", area: "Calapan City", center: [13.4111, 121.1811] },
    { name: "Masipit", area: "Calapan City", center: [13.4291, 121.1585] },
    { name: "Tawiran", area: "Calapan City", center: [13.3965, 121.1987] },
    { name: "Baco Poblacion", area: "Baco", center: [13.3583, 121.0975] },
    { name: "Naujan Poblacion", area: "Naujan", center: [13.3236, 121.3028] },
  ];
  let n = 0;
  for (let dayAgo = 88; dayAgo > 3; dayAgo -= 3 + (n % 4)) {
    const p = places[n % places.length];
    const level = Math.round((0.2 + ((n * 37) % 90) / 100) * 100) / 100;
    const id = `z_demo_hist_${String(n).padStart(2, "0")}`;
    const created = NOW - dayAgo * D;
    const editor = p.area === "Naujan" ? "naujanAdmin" : "lguStaff";
    const editorUid = uids[editor];
    const editorName = ACCOUNTS.find((a) => a.key === editor)!.name;
    await db.doc(`floodZones/${id}`).set({
      ...geography(p.area),
      name: `${p.name} (Demo history)`,
      geometry: { type: "polygon", coordinates: poly(p.center, 150 + (n % 3) * 60) },
      waterLevelM: level,
      trend: "falling",
      trendDeltaM: 0,
      roadPassability: suggestRoadPassability(level),
      passability: suggestPassability(level),
      notes: "SIMULATED historical record for analytics demonstration.",
      status: "cleared",
      area: p.area,
      source: "drrm",
      updatedBy: editorUid,
      updatedByName: editorName,
      updatedAt: ts(created + (6 + (n % 10)) * H),
      simulated: true,
    });
    await db.doc(`zoneHistory/${id}/updates/created`).set({
      zoneName: `${p.name} (Demo history)`, changedFields: { waterLevelM: level, status: "active" },
      editorUid, editorName, action: "created", timestamp: ts(created), simulated: true,
    });
    await db.doc(`zoneHistory/${id}/updates/cleared`).set({
      zoneName: `${p.name} (Demo history)`, changedFields: { status: "cleared" },
      editorUid, editorName, action: "cleared", timestamp: ts(created + (6 + (n % 10)) * H), simulated: true,
    });
    n++;
  }
  console.log(`✓ ${ACTIVE_ZONES.length} active + ${n} historical simulated flood zones`);

  // Road conditions — a closed segment through the Baco zone and a caution
  // segment at Bucayao.
  const bacoStart = destinationPoint([13.3594, 121.0991], 250, 420);
  const bacoEnd = destinationPoint([13.3594, 121.0991], 70, 420);
  const roads = [
    {
      id: "road_demo_baco_closed", name: "Baco Poblacion riverside road (Demo)", path: [ll(bacoStart), ll([13.3594, 121.0991]), ll(bacoEnd)],
      status: "closed", reason: "SIMULATED: closed by MDRRMO — chest-deep water.", area: "Baco",
      passability: { bike: false, motor: false, fourWheel: false, suvPickup: false, truck: false }, editor: "lguAdmin",
    },
    {
      id: "road_demo_bucayao_caution", name: "Bucayao Road (Demo)", path: [ll([13.3858, 121.1735]), ll([13.3838, 121.1752]), ll([13.3816, 121.1772])],
      status: "caution", reason: "SIMULATED: light vehicles not advised.", area: "Calapan City",
      passability: suggestPassability(0.55), editor: "lguStaff",
    },
  ];
  for (const r of roads) {
    const { id, editor, ...rest } = r;
    await db.doc(`road_conditions/${id}`).set({
      ...rest, ...geography(rest.area), source: "drrm", active: true, updatedBy: uids[editor],
      updatedByName: ACCOUNTS.find((a) => a.key === editor)!.name, updatedAt: ts(NOW - 50 * 60_000),
      expiresAt: null, simulated: true,
    });
  }

  // Water level stations with 48 h of simulated hourly readings.
  const stations = [
    { id: "wls_demo_calapan_river", name: "Calapan River — Bucayao Bridge (Simulated)", river: "Calapan River", area: "Calapan City", loc: [13.3842, 121.1747] as Pt, base: 1.2, peak: 2.7 },
    { id: "wls_demo_baco_river", name: "Baco River — Poblacion (Simulated)", river: "Baco River", area: "Baco", loc: [13.3601, 121.0968] as Pt, base: 1.6, peak: 3.4 },
    { id: "wls_demo_naujan_lake", name: "Naujan Lake outlet (Simulated)", river: "Naujan Lake", area: "Naujan", loc: [13.3168, 121.3092] as Pt, base: 1.0, peak: 1.7 },
  ];
  for (const s of stations) {
    let last = s.base;
    for (let h = 47; h >= 0; h--) {
      // Smooth rise over the last ~18 hours, then a slight plateau.
      const t = Math.max(0, 1 - h / 18);
      const level = Math.round((s.base + (s.peak - s.base) * t * t * (3 - 2 * t) + Math.sin(h / 3) * 0.03) * 100) / 100;
      last = level;
      await db.doc(`water_level_stations/${s.id}/readings/h${String(h).padStart(2, "0")}`).set({
        levelM: level, recordedAt: ts(NOW - h * H), source: "simulated", simulated: true,
      });
    }
    await db.doc(`water_level_stations/${s.id}`).set({
      ...geography(s.area),
      name: s.name, riverName: s.river, location: ll(s.loc), area: s.area,
      thresholds: { alertM: 2.0, alarmM: 3.0, criticalM: 4.0 }, source: "simulated", active: true,
      lastLevelM: last, lastReadingAt: ts(NOW), simulated: true,
    });
  }
  console.log("✓ road conditions & water-level stations");
}

// =============================================================================
// 5. Evacuation centers, reports, incidents, advisories, alerts
// =============================================================================

async function seedOperations() {
  const centers = [
    { id: "evac_demo_central_school", name: "Calapan City Central School Gym (Demo)", address: "J.P. Rizal St, Calapan City", area: "Calapan City", loc: [13.4135, 121.1797] as Pt, capacity: 400, occupancy: 132, status: "open", facilities: ["water", "food", "toilets", "medical", "charging", "pwd_access"], verified: true, occVerified: true },
    { id: "evac_demo_sports_complex", name: "Calapan City Sports Complex (Demo)", address: "Brgy. Guinobatan, Calapan City", area: "Calapan City", loc: [13.3946, 121.1683] as Pt, capacity: 800, occupancy: 790, status: "full", facilities: ["water", "food", "toilets", "power", "women_child_space"], verified: true, occVerified: true },
    { id: "evac_demo_lalud_hall", name: "Lalud Barangay Hall (Demo)", address: "Brgy. Lalud, Calapan City", area: "Calapan City", loc: [13.4052, 121.1902] as Pt, capacity: 120, occupancy: null, status: "standby", facilities: ["water", "toilets"], verified: true, occVerified: false },
    { id: "evac_demo_bucayao_es", name: "Bucayao Elementary School (Demo)", address: "Brgy. Bucayao, Calapan City", area: "Calapan City", loc: [13.3786, 121.1712] as Pt, capacity: 250, occupancy: 41, status: "open", facilities: ["water", "toilets", "pet_area"], verified: true, occVerified: true },
    { id: "evac_demo_baco_court", name: "Baco Municipal Covered Court (Demo)", address: "Poblacion, Baco", area: "Baco", loc: [13.3622, 121.0951] as Pt, capacity: 300, occupancy: 210, status: "open", facilities: ["water", "food", "medical", "toilets"], verified: true, occVerified: true },
    { id: "evac_demo_canubing_chapel", name: "Canubing Chapel (Demo, awaiting verification)", address: "Brgy. Canubing I, Calapan City", area: "Calapan City", loc: [13.3561, 121.2101] as Pt, capacity: 80, occupancy: null, status: "standby", facilities: ["water"], verified: false, occVerified: false },
  ];
  for (const c of centers) {
    await db.doc(`evacuation_centers/${c.id}`).set({
      ...geography(c.area),
      name: c.name, address: c.address, area: c.area, location: ll(c.loc), capacity: c.capacity, occupancy: c.occupancy,
      occupancyVerified: c.occVerified, occupancyUpdatedAt: ts(NOW - 40 * 60_000), status: c.status, facilities: c.facilities,
      contact: { name: "Center manager (demo)", phone: "0917-000-0" + String(200 + centers.indexOf(c)) },
      orgId: ORGS.calapan.id, verified: c.verified, updatedBy: uids.lguStaff, updatedAt: ts(NOW - 40 * 60_000), simulated: true,
    });
  }

  const ai = (severity: string, depth: string, consistency: string, confidence: number) => ({
    analysisId: "", provider: "simulated", model: "seed", imageAnalyzed: false, floodVisible: null,
    depthEstimate: depth, severitySuggestion: severity, roadObstruction: null, consistency, confidence,
  });
  const reports = [
    { id: "rpt_demo_verified_bucayao", reporter: "citizen", loc: [13.3841, 121.1756] as Pt, area: "Calapan City", desc: "SIMULATED: Water is up to the knees on Bucayao Road, tricycles turning back.", depth: "knee", depthM: 0.48, status: "verified", road: "Bucayao Road", blocked: true, ago: 4 * H, zone: "z_demo_bucayao", aiSum: ai("high", "knee", "not_checked", 0) },
    { id: "rpt_demo_pending_lalud", reporter: "citizen2", loc: [13.4027, 121.1879], area: "Calapan City", desc: "SIMULATED: Water rising quickly beside the public market, about half-knee deep.", depth: "half_knee", depthM: 0.25, status: "pending", road: "Market access road", blocked: false, ago: 35 * 60_000, zone: null, aiSum: ai("moderate", "half_knee", "not_checked", 0) },
    { id: "rpt_demo_pending_lalud_dup", reporter: "citizen", loc: [13.4033, 121.1884], area: "Calapan City", desc: "SIMULATED: Flooding near Lalud market, cars slowing down.", depth: "half_knee", depthM: 0.25, status: "pending", road: "", blocked: false, ago: 20 * 60_000, zone: null, aiSum: null, dupCandidates: ["rpt_demo_pending_lalud"] },
    { id: "rpt_demo_rejected", reporter: "citizen2", loc: [13.4199, 121.1922], area: "Calapan City", desc: "SIMULATED: test", depth: "unknown", depthM: null, status: "rejected", road: "", blocked: false, ago: 2 * D, zone: null, aiSum: null, flags: ["description_too_short"] },
    { id: "rpt_demo_needs_info", reporter: "citizen", loc: [13.3594, 121.1012], area: "Baco", desc: "SIMULATED: Road near the river looks flooded but I'm not sure how deep.", depth: "unknown", depthM: null, status: "needs_info", road: "", blocked: false, ago: 3 * H, zone: null, aiSum: null },
  ];
  for (const r of reports) {
    await db.doc(`community_reports/${r.id}`).set({
      ...geography(r.area),
      reporterUid: uids[r.reporter], clientDraftId: null, location: ll(r.loc as Pt), locationSource: "gps", locationAccuracyM: 15,
      area: r.area, description: r.desc, depthLabel: r.depth, estimatedDepthM: r.depthM, roadName: r.road, roadBlocked: r.blocked,
      photoUrl: null, photoStorage: null, status: r.status, ai: r.aiSum,
      duplicateOf: null, duplicateCandidates: (r as { dupCandidates?: string[] }).dupCandidates ?? [],
      suspiciousFlags: (r as { flags?: string[] }).flags ?? [], linkedZoneId: r.zone, linkedIncidentId: r.zone ? "inc_demo_bucayao" : null,
      verifiedBy: r.status === "verified" ? uids.lguStaff : null, verifiedByName: r.status === "verified" ? "Mark Villanueva (Demo)" : null,
      verifiedAt: r.status === "verified" ? ts(NOW - r.ago + 25 * 60_000) : null,
      moderationNote: r.status === "rejected" ? "Not a flood report." : r.status === "needs_info" ? "Please add a photo or depth estimate." : "",
      observedAt: ts(NOW - r.ago), createdAt: ts(NOW - r.ago), simulated: true,
    });
    if (r.status !== "pending") {
      await db.doc(`community_reports/${r.id}/verifications/v1`).set({
        action: r.status === "verified" ? "verify" : r.status === "rejected" ? "reject" : "request_info",
        byUid: uids.lguStaff, byName: "Mark Villanueva (Demo)", note: "SIMULATED moderation", appliedToZoneId: r.zone, at: ts(NOW - r.ago + 25 * 60_000),
      });
    }
  }

  await db.doc("incidents/inc_demo_bucayao").set({
    ...geography("Calapan City"),
    orgId: ORGS.calapan.id, title: "Flooding along Bucayao Road (Demo)", type: "flood", severity: "high", status: "responding",
    area: "Calapan City", location: ll([13.3838, 121.1752]), description: "SIMULATED: Rising water at Bucayao bridge approach; rescue team on standby.",
    linkedReportIds: ["rpt_demo_verified_bucayao"], linkedZoneId: "z_demo_bucayao", assignedTo: [uids.lguStaff],
    createdBy: uids.lguStaff, createdByName: "Mark Villanueva (Demo)", createdAt: ts(NOW - 4 * H), updatedAt: ts(NOW - 30 * 60_000),
    resolvedAt: null, aiSummary: null, simulated: true,
  });
  const timeline = [
    [4 * H, "Incident opened from verified community report.", "open"],
    [3 * H, "Barangay tanod deployed to divert light vehicles.", "responding"],
    [30 * 60_000, "Water level still rising (+8 cm/h). Rescue boat on standby at the bridge.", "responding"],
  ] as const;
  for (const [i, [ago, note, status]] of timeline.entries()) {
    await db.doc(`incidents/inc_demo_bucayao/timeline/t${i}`).set({
      orgId: ORGS.calapan.id, note: `SIMULATED: ${note}`, status, byUid: uids.lguStaff, byName: "Mark Villanueva (Demo)", at: ts(NOW - ago),
    });
  }
  await db.doc("incidents/inc_demo_resolved").set({
    ...geography("Calapan City"),
    orgId: ORGS.calapan.id, title: "Clogged drainage, Ibaba East (Demo)", type: "flood", severity: "moderate", status: "resolved",
    area: "Calapan City", location: ll([13.4148, 121.1862]), description: "SIMULATED: Drainage cleared by city engineering.",
    linkedReportIds: [], linkedZoneId: null, assignedTo: [], createdBy: uids.lguAdmin, createdByName: "Engr. Ana Reyes (Demo)",
    createdAt: ts(NOW - 8 * D), updatedAt: ts(NOW - 7 * D), resolvedAt: ts(NOW - 7 * D), aiSummary: null, simulated: true,
  });

  await db.doc("advisories/adv_demo_rainfall").set({
    orgId: ORGS.calapan.id, title: "Heavy rainfall advisory — Calapan City (Simulated)",
    body: "SIMULATED ADVISORY FOR DEMONSTRATION. Moderate to heavy rain expected in the next 6 hours. Residents near Bucayao and Lalud should monitor water levels and prepare go-bags. Avoid Bucayao Road; use alternate routes.",
    bodyFil: "SIMULATED NA ABISO PARA SA DEMO. Inaasahan ang katamtaman hanggang malakas na ulan sa susunod na 6 na oras. Ang mga residente malapit sa Bucayao at Lalud ay pinapayuhang bantayan ang tubig at ihanda ang go-bag. Iwasan ang Bucayao Road.",
    severity: "moderate", areas: ["Calapan City"], areaPsgcCodes: [geography("Calapan City").municipalityPsgcCode], status: "published", aiDrafted: false, aiModel: null,
    createdBy: uids.lguAdmin, createdByName: "Engr. Ana Reyes (Demo)", createdAt: ts(NOW - 3 * H), publishedAt: ts(NOW - 3 * H),
    publishedBy: uids.lguAdmin, simulated: true,
  });
  await db.doc("advisories/adv_demo_draft").set({
    orgId: ORGS.calapan.id, title: "Draft: Bucayao Road closure (Simulated)", body: "SIMULATED draft.", severity: "high",
    areas: ["Calapan City"], areaPsgcCodes: [geography("Calapan City").municipalityPsgcCode], status: "draft", aiDrafted: false, aiModel: null, createdBy: uids.lguStaff,
    createdByName: "Mark Villanueva (Demo)", createdAt: ts(NOW - 50 * 60_000), publishedAt: null, publishedBy: null, simulated: true,
  });

  await db.doc("alerts/alert_demo_bucayao").set({
    ...geography("Calapan City"),
    type: "flood", severity: "high", title: "Flooding on Bucayao Road (Simulated)",
    body: "SIMULATED ALERT: Knee-to-tire deep water near Bucayao bridge. Light vehicles should detour.",
    center: ll([13.3838, 121.1752]), radiusM: 2500, area: "Calapan City", sourceRef: "floodZones/z_demo_bucayao",
    issuedBy: uids.lguStaff, issuedByName: "Calapan City DRRMO (Demo)", orgId: ORGS.calapan.id,
    createdAt: ts(NOW - 60 * 60_000), expiresAt: ts(NOW + 24 * H), active: true, pushSent: 0, simulated: true,
  });
  console.log("✓ evacuation centers, community reports, incidents, advisories, alerts");
}

// =============================================================================
// 6. Demo subscriptions, transactions, invoices, fleet routes
// =============================================================================

async function seedBilling() {
  const subs = [
    { id: "sub_demo_lgu_calapan", orgId: ORGS.calapan.id, orgName: ORGS.calapan.name, planId: "lgu_pro", cycle: "monthly" as const, amount: 5000, startAgo: 12 * D, status: "active", created: 70 * D },
    { id: "sub_demo_province_oriental", orgId: ORGS.orientalProvince.id, orgName: ORGS.orientalProvince.name, planId: "lgu_pro", cycle: "monthly" as const, amount: 5000, startAgo: 10 * D, status: "active", created: 70 * D },
    { id: "sub_demo_biz_express", orgId: ORGS.express.id, orgName: ORGS.express.name, planId: "business_pro", cycle: "annual" as const, amount: 21600, startAgo: 40 * D, status: "active", created: 40 * D },
    { id: "sub_demo_enterprise_isla", orgId: ORGS.isla.id, orgName: ORGS.isla.name, planId: "enterprise", cycle: "monthly" as const, amount: 15000, startAgo: 5 * D, status: "active", created: 95 * D },
    { id: "sub_demo_lgu_naujan", orgId: ORGS.naujan.id, orgName: ORGS.naujan.name, planId: "lgu_pro", cycle: "monthly" as const, amount: 5000, startAgo: 50 * D, status: "canceled", created: 80 * D },
  ];
  let seq = 1;
  for (const s of subs) {
    const coverageScopes = s.orgId === ORGS.calapan.id
      ? ORGS.calapan.jurisdictionAreas.map((area) => ({ level: "municipality" as const, psgcCode: legacyAreaToMunicipality(area)!.psgcCode }))
      : s.orgId === ORGS.orientalProvince.id
        ? [{ level: "province" as const, psgcCode: "1705200000" }]
      : s.orgId === ORGS.naujan.id
        ? [{ level: "municipality" as const, psgcCode: legacyAreaToMunicipality("Naujan")!.psgcCode }]
        : s.orgId === ORGS.express.id
          ? [{ level: "province" as const, psgcCode: "1705200000" }]
          : [{ level: "province" as const, psgcCode: "1705100000" }, { level: "province" as const, psgcCode: "1705200000" }];
    const start = NOW - s.startAgo;
    const end = addPeriod(start, s.cycle);
    await db.doc(`subscriptions/${s.id}`).set({
      orgId: s.orgId, planId: s.planId, status: s.status, billingCycle: s.cycle,
      currentPeriodStart: ts(start), currentPeriodEnd: ts(end), cancelAtPeriodEnd: s.status === "canceled",
      pendingPlanId: null, pendingBillingCycle: null, provider: "demo", isDemo: true, livemode: false, coverageScopes,
      mrrPhp: monthlyEquivalent(s.amount, s.cycle), createdAt: ts(NOW - s.created), updatedAt: ts(start),
      canceledAt: s.status === "canceled" ? ts(NOW - 20 * D) : null, lastReminderAt: null,
    });
    // Payment history: one paid transaction per elapsed period.
    for (let k = 0, t = NOW - s.created; t <= start && k < 6; k++, t = addPeriod(t, s.cycle)) {
      const txId = `tx_demo_${s.id.replace("sub_demo_", "")}_${k}`;
      const invId = `inv_demo_${s.id.replace("sub_demo_", "")}_${k}`;
      const plan = DEFAULT_PLAN_BY_ID[s.planId];
      await db.doc(`payment_transactions/${txId}`).set({
        orgId: s.orgId, kind: "subscription", planId: s.planId, billingCycle: s.cycle, feeId: null,
        description: `${plan.name} — ${s.cycle} (demo sandbox)`, amountPhp: s.amount, amountMinor: toMinor(s.amount), currency: "PHP",
        provider: "demo", providerRef: `demo_${txId}`, checkoutUrl: null, status: "paid", livemode: false, isDemo: true, coverageScopes,
        createdBy: "seed", createdAt: ts(t), paidAt: ts(t + 5 * 60_000), invoiceId: invId, failureReason: null,
      });
      await db.doc(`billing_invoices/${invId}`).set({
        number: invoiceNumber(seq++, t), orgId: s.orgId, orgName: s.orgName, txId,
        lines: [{ description: `${plan.name} — ${s.cycle} subscription`, amountPhp: s.amount }], totalPhp: s.amount,
        provider: "demo", isDemo: true, issuedAt: ts(t + 5 * 60_000), status: "paid",
      });
    }
  }
  // One-time installation fee + a failed attempt (shows failure handling).
  await db.doc("payment_transactions/tx_demo_calapan_install").set({
    orgId: ORGS.calapan.id, kind: "one_time_fee", planId: null, billingCycle: null, feeId: "lgu_installation",
    description: "LGU installation & data onboarding (demo sandbox)", amountPhp: 25000, amountMinor: toMinor(25000), currency: "PHP",
    provider: "demo", providerRef: "demo_install", checkoutUrl: null, status: "paid", livemode: false, isDemo: true,
    createdBy: "seed", createdAt: ts(NOW - 69 * D), paidAt: ts(NOW - 69 * D), invoiceId: "inv_demo_calapan_install", failureReason: null,
  });
  await db.doc("billing_invoices/inv_demo_calapan_install").set({
    number: invoiceNumber(seq++, NOW - 69 * D), orgId: ORGS.calapan.id, orgName: ORGS.calapan.name, txId: "tx_demo_calapan_install",
    lines: [{ description: "LGU installation & data onboarding", amountPhp: 25000 }], totalPhp: 25000,
    provider: "demo", isDemo: true, issuedAt: ts(NOW - 69 * D), status: "paid",
  });
  await db.doc("payment_transactions/tx_demo_naujan_failed").set({
    orgId: ORGS.naujan.id, kind: "subscription", planId: "lgu_pro", billingCycle: "monthly", feeId: null,
    description: "LGU Pro — monthly (demo sandbox)", amountPhp: 5000, amountMinor: toMinor(5000), currency: "PHP",
    provider: "demo", providerRef: "demo_failed", checkoutUrl: null, status: "failed", livemode: false, isDemo: true,
    createdBy: "seed", createdAt: ts(NOW - 19 * D), paidAt: null, invoiceId: null, failureReason: "Simulated: e-wallet balance insufficient",
  });

  // Keep the invoice counter ahead of the seeded invoice numbers.
  const counterRef = db.doc("counters/invoices");
  const current = ((await counterRef.get()).get("seq") as number | undefined) ?? 0;
  if (current < seq) await counterRef.set({ seq }, { merge: true });

  // Fleet saved routes for the business demo org.
  const routes = [
    { id: "route_demo_port_bucayao", name: "Calapan Port → Bucayao warehouse (Demo)", vehicle: "truck", stops: [["Calapan Port", [13.4194, 121.1978]], ["Bucayao warehouse", [13.3742, 121.1702]]] },
    { id: "route_demo_naujan_loop", name: "Calapan → Naujan deliveries (Demo)", vehicle: "car", stops: [["Calapan hub", [13.4117, 121.1803]], ["Canubing drop-off", [13.3546, 121.2079]], ["Naujan Poblacion", [13.3239, 121.3009]]] },
    { id: "route_demo_baco_run", name: "Calapan → Baco pharmacy run (Demo)", vehicle: "motorcycle", stops: [["Calapan hub", [13.4117, 121.1803]], ["Baco Poblacion", [13.3583, 121.0975]]] },
  ] as const;
  for (const r of routes) {
    await db.doc(`organizations/${ORGS.express.id}/saved_routes/${r.id}`).set({
      orgId: ORGS.express.id, name: r.name, vehicle: r.vehicle,
      coveragePsgcCode: legacyAreaToMunicipality(r.id.includes("naujan") ? "Naujan" : r.id.includes("baco") ? "Baco" : "Calapan City")!.psgcCode,
      stops: r.stops.map(([label, p]) => ({ label, location: ll(p as unknown as Pt) })),
      createdBy: uids.bizAdmin, createdAt: ts(NOW - 20 * D), lastCheckedAt: null, lastStatus: "unknown",
      lastDistanceM: null, lastDurationS: null, activeDisruptions: 0,
    });
  }
  // Enterprise API key placeholder is NOT seeded — keys are generated in-app
  // and only their hash is stored.
  console.log("✓ demo subscriptions, payments, invoices & fleet routes (all flagged isDemo)");
}

// =============================================================================

try {
  await seedPlatform();
  await seedGeographyCatalog();
  if (SEED_DEMO) {
    if (ctx.flag("--reset-demo")) await resetDemo();
    await seedOrgs();
    await seedAccounts();
    await seedZones();
    await seedOperations();
    await seedBilling();
  }
  console.log("\nDone. Demo records are flagged simulated/isDemo and labelled in the UI.\n");
  process.exit(0);
} catch (err) {
  console.error("\nSeed failed:", (err as Error).message);
  process.exit(1);
}
