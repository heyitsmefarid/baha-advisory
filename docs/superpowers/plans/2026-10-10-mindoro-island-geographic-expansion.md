# Mindoro Island Geographic Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand Bahadvisory to a PSGC-based, tenant-safe geographic platform covering all 26 LGUs in Oriental and Occidental Mindoro while preserving the complete Calapan pilot.

**Architecture:** A generated, version-pinned geographic catalog and authoritative boundary assets replace hard-coded municipality names. Every operational record receives an additive PSGC hierarchy, a shared scope controller drives map/query behavior, and exact jurisdiction grants enforce municipal, barangay, provincial, and platform access. Cached aggregate endpoints power island/province comparisons without loading every record into the browser.

**Tech Stack:** React 18, TypeScript 5, Vite 5, Leaflet/react-leaflet, Firebase Auth, Cloud Firestore and rules, Firebase Admin, Vitest, Firebase Emulator Suite, Playwright Core, Node/tsx scripts.

**Spec:** `docs/superpowers/specs/2026-10-10-mindoro-island-geographic-expansion-design.md`

## Global Constraints

- Preserve the current stack, existing data, current routes, and the complete Calapan demo.
- Pin identities to the PSA PSGC 2Q 2026 publication; codes remain strings and source metadata includes URL, version, retrieval date, and SHA-256.
- Accept geometry only from Geoportal Philippines/NAMRIA or another approved Philippine government publication. Otherwise set `boundaryStatus: "unavailable"`.
- Never label missing data safe, invent operational readings, or present seeded records without `simulated: true`.
- Verified public safety information, reporting, evacuation information, alerts, and basic navigation remain free and anonymous-readable.
- Preserve legacy `area`, `assignedArea`, and `areas` until additive migration and compatibility tests pass.
- Store jurisdiction grants in server-managed Firestore documents, not large Auth claim arrays.
- Do not store boundary polygons in Firestore or add unverified ferry routing.
- Initial island rendering must not fetch barangay polygons or unbounded operational collections.
- Execution must first use `superpowers:using-git-worktrees` because this checkout already contains extensive uncommitted work. Verify the aggregate diff is present in the isolated worktree before Task 1.

## Review Focus

- Cross-province URL children are discarded while the valid parent remains; Task 3 pins this.
- Polygon-edge points and unavailable barangay boundaries never receive false high confidence; Task 2 pins this.
- Forged PSGC ancestry and cross-LGU writes are rejected; Tasks 4 and 5 pin this.
- Failed scope queries retain the last confirmed data and show an error, not an empty safe-looking map; Task 6 pins this.
- Mainland-to-Lubang routing returns `no_verified_road_route` without a line or implied ferry; Task 9 pins this.

---

## File Structure

- `shared/geography/types.ts`: geographic contracts.
- `shared/geography/catalog.generated.ts`: generated pinned PSGC catalog.
- `shared/geography/catalog.ts`: indexes, hierarchy validation, scope normalization, and legacy lookup.
- `shared/geography/geometry.ts`: containment and assignment.
- `shared/geography/jurisdiction.ts`: jurisdiction and coverage predicates.
- `scripts/geography/importPsgc.ts`: official PSA workbook importer.
- `scripts/geography/importBoundaries.ts`: government GeoJSON validator and asset generator.
- `data/geography/sources.json`: provenance and hashes.
- `public/geography/`: versioned, simplified browser boundary assets.
- `shared/geography/boundaries.generated.json`: backend assignment geometry.
- `src/contexts/GeographicScopeContext.tsx`: URL-backed selected scope.
- `src/components/geography/`: filters, coverage status, and overview UI.
- `src/lib/geographyAssets.ts`: abortable boundary loading.
- `src/hooks/useScopedPublicData.ts`: bounded scope-aware queries.
- `server/lib/geography.ts`: backend assignment and hierarchy validation.
- `server/lib/jurisdiction.ts`: server grant enforcement.
- `server/lib/geographicSummary.ts`: cached aggregates.
- `server/handlers/geography.ts`: overview and refresh API.
- `scripts/migrateGeography.ts`: dry-run-first idempotent backfill.

---

### Task 1: Generate the pinned Mindoro PSGC catalog

**Files:**
- Create: `shared/geography/types.ts`
- Create: `shared/geography/catalog.generated.ts`
- Create: `shared/geography/catalog.ts`
- Create: `shared/geography/index.ts`
- Create: `scripts/geography/importPsgc.ts`
- Create: `data/geography/sources.json`
- Create: `data/geography/README.md`
- Create: `tests/fixtures/geography/psgc-small.json`
- Test: `tests/unit/geography-catalog.test.ts`
- Modify: `package.json`, `package-lock.json`, `.gitignore`

**Interfaces:**
- Consumes: the official PSA 2Q 2026 workbook.
- Produces: `GeographicUnit`, `GeographicScope`, `GeographicReference`, `LocationAssignment`, `MINDORO_CATALOG`, `getUnit()`, `childrenOf()`, `normalizeScope()`, `isValidHierarchy()`, and `legacyAreaToMunicipality()`.

- [ ] **Step 1: Write the failing catalog integrity tests**

```ts
import { describe, expect, it } from "vitest";
import { MINDORO_CATALOG, childrenOf, getUnit, isValidHierarchy, normalizeScope } from "../../shared/geography";

describe("Mindoro PSGC catalog", () => {
  it("contains two provinces and exactly 26 city/municipality LGUs", () => {
    expect(MINDORO_CATALOG.filter((u) => u.level === "province")).toHaveLength(2);
    expect(MINDORO_CATALOG.filter((u) => ["city", "municipality"].includes(u.level))).toHaveLength(26);
  });

  it("stores ten-digit codes as strings with valid parents", () => {
    for (const unit of MINDORO_CATALOG) {
      expect(unit.psgcCode).toMatch(/^\d{10}$/);
      if (unit.parentPsgcCode) expect(getUnit(unit.parentPsgcCode)).toBeDefined();
    }
  });

  it("clears cross-province child scope", () => {
    const oriental = MINDORO_CATALOG.find((u) => u.level === "province" && u.name === "Oriental Mindoro")!;
    const child = MINDORO_CATALOG.find((u) => u.level === "municipality" && u.provincePsgcCode !== oriental.psgcCode)!;
    expect(normalizeScope({ provincePsgcCode: oriental.psgcCode, municipalityPsgcCode: child.psgcCode, barangayPsgcCode: null }))
      .toEqual({ provincePsgcCode: oriental.psgcCode, municipalityPsgcCode: null, barangayPsgcCode: null });
  });

  it("validates barangay ancestry", () => {
    const b = MINDORO_CATALOG.find((u) => u.level === "barangay")!;
    expect(isValidHierarchy({ regionPsgcCode: b.regionPsgcCode, provincePsgcCode: b.provincePsgcCode!, municipalityPsgcCode: b.municipalityPsgcCode!, barangayPsgcCode: b.psgcCode })).toBe(true);
    expect(childrenOf(b.municipalityPsgcCode!, "barangay")).toContainEqual(b);
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npx vitest run tests/unit/geography-catalog.test.ts`

Expected: FAIL because `shared/geography` does not exist.

- [ ] **Step 3: Implement the contracts and catalog indexes**

```ts
export type GeographicLevel = "region" | "province" | "city" | "municipality" | "barangay";
export type BoundaryStatus = "authoritative" | "approximate_official" | "unavailable";
export interface GeographicUnit {
  psgcCode: string;
  name: string;
  level: GeographicLevel;
  parentPsgcCode: string | null;
  regionPsgcCode: string;
  provincePsgcCode: string | null;
  municipalityPsgcCode: string | null;
  center: [number, number];
  boundingBox: [[number, number], [number, number]];
  boundaryStatus: BoundaryStatus;
  boundaryAsset: string | null;
  sourceVersion: "Q2_2026";
}
export interface GeographicScope {
  provincePsgcCode: string | null;
  municipalityPsgcCode: string | null;
  barangayPsgcCode: string | null;
}
export interface LocationAssignment {
  method: "boundary" | "manual" | "migrated";
  confidence: "high" | "medium" | "review_required";
  sourceVersion: string;
  assignedAt: number;
  assignedBy: string;
}
export interface GeographicReference {
  regionPsgcCode: string;
  provincePsgcCode: string;
  municipalityPsgcCode: string;
  barangayPsgcCode: string | null;
  locationAssignment: LocationAssignment;
}
```

Implement maps by code and parent, normalized legacy-name lookup, and a `normalizeScope()` that retains the deepest valid hierarchy and clears invalid descendants.

- [ ] **Step 4: Implement the reproducible workbook importer**

Add `exceljs` as a dev dependency. Export `buildMindoroCatalog(rows, "Q2_2026")`, assert two named provinces and 26 LGUs, validate uniqueness/parents, sort deterministically, and write the actual SHA-256 and retrieval timestamp to `sources.json`.

Run:

```powershell
npm run geography:psgc -- --input .cache/geography/PSGC-2Q-2026.xlsx --source-url https://psa.gov.ph/classification/psgc --version Q2_2026
npx tsx scripts/geography/importPsgc.ts --check
```

Expected: 2 provinces, 26 LGUs, a nonzero barangay count, and no generated diff in check mode.

- [ ] **Step 5: Run catalog and regression tests**

Run: `npx vitest run tests/unit/geography-catalog.test.ts && npm test`

Expected: catalog tests and all existing tests PASS.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json .gitignore shared/geography scripts/geography/importPsgc.ts data/geography tests/fixtures/geography/psgc-small.json tests/unit/geography-catalog.test.ts
git commit -m "Add: PSGC geographic catalog"
```

---

### Task 2: Import official boundaries and assign points safely

**Files:**
- Create: `shared/geography/geometry.ts`
- Create: `shared/geography/boundaries.generated.json`
- Create: `scripts/geography/importBoundaries.ts`
- Create: `public/geography/manifest.json`, `public/geography/mindoro-provinces.geojson`
- Create: `public/geography/municipalities-1705100000.geojson`, `public/geography/municipalities-1705200000.geojson`
- Create when authoritative geometry exists: `public/geography/barangays/1705101000.geojson`, `1705102000.geojson`, `1705103000.geojson`, `1705104000.geojson`, `1705105000.geojson`, `1705106000.geojson`, `1705107000.geojson`, `1705108000.geojson`, `1705109000.geojson`, `1705110000.geojson`, `1705111000.geojson`
- Create when authoritative geometry exists: `public/geography/barangays/1705201000.geojson`, `1705202000.geojson`, `1705203000.geojson`, `1705204000.geojson`, `1705205000.geojson`, `1705206000.geojson`, `1705207000.geojson`, `1705208000.geojson`, `1705209000.geojson`, `1705210000.geojson`, `1705211000.geojson`, `1705212000.geojson`, `1705213000.geojson`, `1705214000.geojson`, `1705215000.geojson`
- Create: `tests/fixtures/geography/boundaries-small.geojson`
- Test: `tests/unit/geographic-assignment.test.ts`
- Modify: `data/geography/sources.json`, `data/geography/README.md`, `shared/geography/index.ts`

**Interfaces:**
- Consumes: the catalog and explicit government GeoJSON inputs.
- Produces: `resolvePoint()`, `containsPoint()`, `boundsForScope()`, browser assets, and a boundary manifest.

- [ ] **Step 1: Write failing edge and unavailable-boundary tests**

```ts
it("includes a point on the outer boundary", () => {
  expect(containsPoint(fixture.features[0].geometry, [13, 121])).toBe(true);
});
it("does not guess a barangay without authoritative geometry", () => {
  const result = resolvePointWith([13.4, 121.18], fixture, { barangayGeometryAvailable: false });
  expect(result?.barangayPsgcCode).toBeNull();
  expect(result?.locationAssignment.confidence).toBe("review_required");
});
it("returns null outside the supported polygons", () => {
  expect(resolvePointWith([14.5995, 120.9842], fixture, { barangayGeometryAvailable: true })).toBeNull();
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `npx vitest run tests/unit/geographic-assignment.test.ts`

Expected: FAIL because `geometry.ts` is missing.

- [ ] **Step 3: Implement containment and assignment**

Implement point-on-segment before ray casting, support `Polygon` and `MultiPolygon`, reject other shapes, select the smallest matching unit, and validate ancestry. No match returns `null`; absent barangay geometry returns province/municipality with null barangay and `review_required`.

```ts
export interface GeographicAssignment extends GeographicReference {
  locationAssignment: {
    method: "boundary";
    confidence: "high" | "medium" | "review_required";
    sourceVersion: string;
    assignedAt: number;
    assignedBy: "system";
  };
}
```

- [ ] **Step 4: Implement the provenance-enforcing boundary importer**

Require `--source-agency`, `--source-url`, `--retrieved-at`, and `--license-note`. Map by PSGC code, reject unmatched/duplicate/cross-parent features, hash every source, simplify browser copies only, and mark unavailable levels explicitly.

```powershell
npm run geography:boundaries -- --province .cache/geography/provinces.geojson --municipality .cache/geography/municipalities.geojson --barangay-dir .cache/geography/barangays --source-agency NAMRIA --source-url https://geoportal.gov.ph/ --retrieved-at 2026-10-10 --license-note "Approved government-source use recorded in sources.json"
npx tsx scripts/geography/importBoundaries.ts --check
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run tests/unit/geography-catalog.test.ts tests/unit/geographic-assignment.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add shared/geography scripts/geography/importBoundaries.ts public/geography data/geography tests/fixtures/geography/boundaries-small.geojson tests/unit/geographic-assignment.test.ts
git commit -m "Add: Mindoro boundary processing"
```

---

### Task 3: Add URL-backed scope and cascading filters

**Files:**
- Create: `src/contexts/GeographicScopeContext.tsx`
- Create: `src/components/geography/GeographicFilter.tsx`, `src/components/geography/CoverageStatus.tsx`
- Create: `src/components/map/AdministrativeBoundaryLayer.tsx`
- Create: `src/lib/geographyAssets.ts`
- Test: `tests/unit/geographic-scope.test.ts`
- Modify: `src/App.tsx`, `src/firebase.ts`, `src/components/map/BaseMap.tsx`, `src/pages/PublicMapPage.tsx`, `src/index.css`

**Interfaces:**
- Consumes: catalog hierarchy, boundary manifest, and `boundsForScope()`.
- Produces: `GeographicScopeProvider`, `useGeographicScope()`, `GeographicFilter`, `loadBoundaryAsset()`, and `MINDORO_SERVICE_BOUNDS`.

- [ ] **Step 1: Write failing parser tests using real catalog constants**

```ts
it("drops cross-province children", () => {
  const q = new URLSearchParams({ province: ORIENTAL_PSGC, municipality: MAMBURAO_PSGC, barangay: CALAPAN_BARANGAY_PSGC });
  expect(parseGeographicScope(q)).toEqual({ provincePsgcCode: ORIENTAL_PSGC, municipalityPsgcCode: null, barangayPsgcCode: null });
});
it("round-trips a valid barangay scope", () => {
  expect(parseGeographicScope(scopeToSearchParams(calapanBarangayScope))).toEqual(calapanBarangayScope);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/geographic-scope.test.ts`

Expected: FAIL because the context is missing.

- [ ] **Step 3: Implement URL parsing and the provider**

Expose `scope`, selected units, setters, `fitBounds`, and `boundaryStatus`. Update only `province`, `municipality`, and `barangay` query parameters and normalize every incoming URL.

- [ ] **Step 4: Implement filter and abortable asset loader**

Disable child selectors until their parent exists. Cache fulfilled assets by manifest version, pass `AbortSignal` to `fetch`, and throw `BoundaryUnavailableError` when the manifest has no asset.

- [ ] **Step 5: Replace Oriental-only bounds and render boundaries**

Rename `ORIENTAL_MINDORO_BOUNDS` to `MINDORO_SERVICE_BOUNDS`, retain a deprecated alias for one release, include Lubang/Looc in the service extent, wrap routes with the provider, and render the filter/boundary layer on the public map.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run tests/unit/geographic-scope.test.ts && npm run build`

Expected: PASS and no barangay GeoJSON in the initial bundle.

```powershell
git add src/contexts/GeographicScopeContext.tsx src/components/geography src/components/map/AdministrativeBoundaryLayer.tsx src/lib/geographyAssets.ts src/App.tsx src/firebase.ts src/components/map/BaseMap.tsx src/pages/PublicMapPage.tsx src/index.css tests/unit/geographic-scope.test.ts
git commit -m "Add: Island-wide geographic filters"
```

---

### Task 4: Add PSGC references and migrate legacy records

**Files:**
- Create: `server/lib/geography.ts`, `scripts/migrateGeography.ts`
- Test: `tests/unit/geographic-migration.test.ts`
- Modify: `shared/types.ts`, `shared/validation.ts`, `package.json`
- Modify: `server/handlers/reports.ts`, `alerts.ts`, `risk.ts`, `ingest.ts`, `demo.ts`
- Modify: `src/components/admin/ZoneForm.tsx`, `src/components/evacuation/SosPanel.tsx`
- Modify: `src/pages/admin/ManageMapPage.tsx`, `RoadsAdminPage.tsx`, `EvacuationAdminPage.tsx`, `IncidentsPage.tsx`, `AdvisoriesAdminPage.tsx`, `WaterLevelsPage.tsx`
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: `resolvePoint()` and `isValidHierarchy()`.
- Produces: `assignGeography()`, `validateGeographicReference()`, `migrateRecord()`, and `migrate-geography` using the Task 1 contracts.

- [ ] **Step 1: Write failing migration tests**

```ts
it("maps Calapan and preserves legacy area", () => {
  const result = migrateRecord("community_reports", "r1", { area: "Calapan City", location: { lat: 13.41, lng: 121.18 } });
  expect(result.patch).not.toHaveProperty("area");
  expect(result.patch.municipalityPsgcCode).toBe(CALAPAN_PSGC);
});
it("flags unknown names instead of guessing", () => {
  expect(migrateRecord("incidents", "i1", { area: "Unknown" })).toMatchObject({ action: "review_required", patch: {} });
});
it("makes a second run a no-op", () => {
  expect(migrateRecord("alerts", "a1", alreadyMigratedRecord).action).toBe("unchanged");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/geographic-migration.test.ts`

Expected: FAIL because migration functions are missing.

- [ ] **Step 3: Add additive contracts and validators**

Operational interfaces temporarily use `Partial<GeographicReference>` for legacy reads. Backend create paths require the full reference. Reject mismatched ancestry before writes.

- [ ] **Step 4: Assign geography on all create paths**

```ts
const geography = assignGeography(location);
if (!geography) throw new ValidationError(["Location is outside the supported Mindoro service area."]);
const doc = { ...existingFields, ...geography, area: getUnit(geography.municipalityPsgcCode)!.name };
```

Copy the reference to verified zones and alerts. Key risk predictions by municipality PSGC code while returning display names.

- [ ] **Step 5: Update staff forms and direct writes**

Consume `useGeographicScope()`, require a valid municipality, submit the full hierarchy, and retain `area` as a display field. Barangay may be null only for municipality-wide records or unavailable authoritative boundaries.

- [ ] **Step 6: Implement dry-run-first migration**

Process `floodZones`, `road_conditions`, `water_level_stations`, `community_reports`, `incidents`, `advisories`, `alerts`, `evacuation_centers`, `sos_requests`, and `flood_risk_predictions` in batches of at most 400. Default to no writes; `--apply` writes and adds `geographyMigrationVersion: "mindoro-psgc-q2-2026-v1"`. Unresolved rows stay unchanged in the report.

- [ ] **Step 7: Verify dry-run, apply, and repeat**

```powershell
npm run migrate-geography -- --emulator --report .cache/geography/dry.json
npm run migrate-geography -- --emulator --apply --report .cache/geography/apply.json
npm run migrate-geography -- --emulator --apply --report .cache/geography/repeat.json
```

Expected: zero dry-run writes, seeded records migrated once, then all unchanged.

- [ ] **Step 8: Run tests and commit**

Run: `npx vitest run tests/unit/geographic-migration.test.ts && npm run test:emulator:attached && npm run build`

```powershell
git add shared/types.ts shared/validation.ts server/lib/geography.ts server/handlers scripts/migrateGeography.ts scripts/seed.ts src/components/admin/ZoneForm.tsx src/pages/admin src/components/evacuation/SosPanel.tsx package.json tests/unit/geographic-migration.test.ts
git commit -m "Add: PSGC operational record migration"
```

---

### Task 5: Enforce exact geographic jurisdiction grants

**Files:**
- Create: `shared/geography/jurisdiction.ts`, `server/lib/jurisdiction.ts`
- Test: `tests/unit/jurisdiction.test.ts`
- Modify: `shared/types.ts`, `shared/roles.ts`, `server/lib/auth.ts`, `server/handlers/orgs.ts`, `server/handlers/reports.ts`, `server/handlers/alerts.ts`
- Modify: `firestore.rules`, `tests/rules/firestore.rules.test.ts`, `tests/integration/saas.test.ts`
- Modify: `scripts/createAccount.ts`, `scripts/createDrrmAccount.js`, `scripts/seed.ts`

**Interfaces:**
- Consumes: full geographic references and `organizations/{orgId}/jurisdiction_grants/{psgcCode}`.
- Produces: `GovernmentLevel`, `JurisdictionGrant`, `scopeCoversReference()`, `requireJurisdiction()`, and rules helper `ownsGeography()`.

- [ ] **Step 1: Write failing jurisdiction tests**

```ts
it("province scope covers only its province", () => {
  expect(scopeCoversReference({ level: "province", psgcCode: ORIENTAL_PSGC }, calapanRef)).toBe(true);
  expect(scopeCoversReference({ level: "province", psgcCode: ORIENTAL_PSGC }, mamburaoRef)).toBe(false);
});
it("barangay scope excludes a sibling", () => {
  expect(scopeCoversReference({ level: "barangay", psgcCode: BARANGAY_A }, barangayBRef)).toBe(false);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/jurisdiction.test.ts`

Expected: FAIL because the module is missing.

- [ ] **Step 3: Implement grants and backend checks**

```ts
export type GovernmentLevel = "barangay" | "municipality" | "province" | "platform";
export interface JurisdictionGrant {
  psgcCode: string;
  level: Exclude<GovernmentLevel, "platform">;
  orgId: string;
  active: boolean;
  createdAt: TS;
  createdBy: string;
}
```

Permit Super Admin, support legacy claims during compatibility, and deny inactive, mismatched, or invalid hierarchy records.

- [ ] **Step 4: Stop writing geographic claim arrays for new accounts**

New claims contain `{ role, orgId }`; `assignedArea` and `areas` remain readable for legacy users. Application approval and member management create validated server-only grants.

- [ ] **Step 5: Add grant rules and migrated-data enforcement**

```text
function hasGrant(code) {
  return code != null && exists(/databases/$(database)/documents/organizations/$(myOrg())/jurisdiction_grants/$(code));
}
function ownsGeography(record) {
  return isSuper() || isLegacyAdmin()
    || (isLguStaff() && isValidHierarchy(record)
      && (hasGrant(record.barangayPsgcCode) || hasGrant(record.municipalityPsgcCode) || hasGrant(record.provincePsgcCode)));
}
```

Default-deny client grant writes. Keep `ownsArea()` only for unmigrated legacy records. Preserve public reads.

- [ ] **Step 6: Add emulator cases**

Test municipal cross-tenant denial, same-province provincial allowance, cross-province denial, forged ancestry denial, client grant-write denial, public verified reads, and Super Admin backend actions.

- [ ] **Step 7: Run and commit**

Run: `npm run test:emulator:attached`

Expected: all prior and new rule/integration cases PASS.

```powershell
git add shared/geography/jurisdiction.ts shared/types.ts shared/roles.ts server/lib/auth.ts server/lib/jurisdiction.ts server/handlers/orgs.ts server/handlers/reports.ts server/handlers/alerts.ts firestore.rules tests/rules/firestore.rules.test.ts tests/integration/saas.test.ts scripts/createAccount.ts scripts/createDrrmAccount.js scripts/seed.ts
git commit -m "Add: PSGC tenant jurisdiction enforcement"
```

---

### Task 6: Scope public queries and cache geographic summaries

**Files:**
- Create: `src/hooks/useScopedPublicData.ts`, `src/lib/retainedQueryState.ts`
- Create: `server/lib/geographicSummary.ts`, `server/handlers/geography.ts`
- Test: `tests/unit/retained-query-state.test.ts`, `tests/integration/geographic-overview.test.ts`
- Modify: `src/hooks/useFloodZones.ts`, `src/hooks/useOfficialData.ts`, `src/components/map/PublicLayers.tsx`, `src/pages/PublicMapPage.tsx`
- Modify: `server/routes.ts`, `server/handlers/reports.ts`, `server/handlers/alerts.ts`, `server/handlers/ingest.ts`, `firestore.indexes.json`

**Interfaces:**
- Consumes: `GeographicScope`, PSGC operational fields, backend authorization, and Firestore.
- Produces: `useScopedPublicData()`, `transitionRetainedQueryState()`, `GET /api/geography/overview`, `invalidateGeographicSummary()`, and `computeGeographicOverview()`.

- [ ] **Step 1: Write failing retained-state and overview tests**

```ts
it("retains confirmed rows when a replacement query fails", () => {
  const loaded = { rows: [{ id: "z1" }], loading: false, error: null, confirmedScopeKey: "province:A" };
  const next = transitionRetainedQueryState(loaded, { type: "query_failed", scopeKey: "province:B", error: "offline" });
  expect(next.rows).toEqual([{ id: "z1" }]);
  expect(next.displayState).toBe("stale_previous_scope");
});
it("overview returns aggregates without private fields", async () => {
  const res = await call("GET", `/api/geography/overview?province=${ORIENTAL_PSGC}`);
  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty("municipalities");
  expect(JSON.stringify(res.body)).not.toContain("reporterUid");
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/retained-query-state.test.ts tests/integration/geographic-overview.test.ts`

Expected: FAIL because the state reducer and route are missing.

- [ ] **Step 3: Implement bounded query builders**

Island scope subscribes only to active high/critical alerts with a hard limit and loads aggregates from the API. Deeper scopes add the deepest PSGC `where()` and a hard limit. No hook constructs an unbounded query.

- [ ] **Step 4: Retain confirmed data through failures**

Expose `displayScope`, `requestedScope`, `error`, `fromCache`, and `displayState`. Replace rows only after a successful new snapshot. Render **Unable to refresh — showing previous scope** rather than zero.

- [ ] **Step 5: Implement cached aggregate overview**

Validate scope parameters and return only public counts/freshness. Cache in `geographic_summaries/{scopeKey}` with `generatedAt`, `sourceMaxUpdatedAt`, and `expiresAt`. Permit `refresh=1` only to Super Admin or LGU staff within that scope. Invalidate barangay, municipality, province, and island keys after backend mutations.

- [ ] **Step 6: Add exact emulator-proven indexes**

For each scoped public collection, add composite indexes with PSGC scope followed by active/status and descending timestamp. Do not add speculative indexes not exercised by a test.

- [ ] **Step 7: Verify and commit**

Run: `npm run test:emulator:attached && npm run build`

Expected: overview and rules tests PASS; build succeeds.

```powershell
git add src/hooks/useScopedPublicData.ts src/lib/retainedQueryState.ts src/hooks/useFloodZones.ts src/hooks/useOfficialData.ts src/components/map/PublicLayers.tsx src/pages/PublicMapPage.tsx server/lib/geographicSummary.ts server/handlers/geography.ts server/routes.ts server/handlers/reports.ts server/handlers/alerts.ts server/handlers/ingest.ts firestore.indexes.json tests/unit/retained-query-state.test.ts tests/integration/geographic-overview.test.ts
git commit -m "Add: Scoped geographic data loading"
```

---

### Task 7: Build island and provincial comparison dashboards

**Files:**
- Create: `shared/geography/overview.ts`
- Create: `src/components/geography/GeographicOverview.tsx`
- Create: `src/pages/IslandOverviewPage.tsx`, `src/pages/admin/ProvincialOverviewPage.tsx`
- Test: `tests/unit/geographic-overview.test.ts`
- Modify: `src/App.tsx`, `src/components/layout/AppShell.tsx`, `src/components/admin/AdminLayout.tsx`, `src/pages/super/SuperPages.tsx`, `src/index.css`

**Interfaces:**
- Consumes: `/api/geography/overview`, scope, catalog labels, and chart components.
- Produces: `buildOverviewRows()`, `GeographicOverview`, `/overview`, and `/admin/geography`.

- [ ] **Step 1: Write failing view-model tests**

```ts
it("distinguishes no feed from zero events", () => {
  const [row] = buildOverviewRows({ municipalities: [{ psgcCode: CALAPAN_PSGC, verifiedSources: 0, activeFloodZones: 0 }] });
  expect(row.coverageStatus).toBe("no_verified_feed");
  expect(row.activeFloodZonesDisplay).toBe("—");
});
it("keeps simulated and verified counts separate", () => {
  const [row] = buildOverviewRows({ municipalities: [{ psgcCode: CALAPAN_PSGC, verifiedFloodZones: 0, simulatedFloodZones: 1 }] });
  expect(row.verifiedActiveFloodZones).toBe(0);
  expect(row.simulatedActiveFloodZones).toBe(1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/geographic-overview.test.ts`

Expected: FAIL because `overview.ts` is missing.

- [ ] **Step 3: Implement normalization and status precedence**

Do not coalesce missing/stale values to zero. Keep verified/simulated fields separate. Use precedence `source_unavailable`, `stale`, `simulated`, `verified`, `no_verified_feed`.

- [ ] **Step 4: Build accessible comparison UI**

Render province summaries, municipality charts, and a complete table fallback. Link each row to the same page with PSGC query parameters. Show generation time and source coverage for each metric group.

- [ ] **Step 5: Add public, provincial, and platform views**

- `/overview`: anonymous-safe island comparison.
- `/admin/geography`: grant-scoped operations comparison.
- `/super`: island panel and both province links.

Municipal users default to their municipality; provincial users default to their province.

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run tests/unit/geographic-overview.test.ts tests/integration/geographic-overview.test.ts && npm run build`

Inspect `/overview`, `/admin/geography`, and `/super` at desktop and mobile widths.

```powershell
git add shared/geography/overview.ts src/components/geography/GeographicOverview.tsx src/pages/IslandOverviewPage.tsx src/pages/admin/ProvincialOverviewPage.tsx src/App.tsx src/components/layout/AppShell.tsx src/components/admin/AdminLayout.tsx src/pages/super/SuperPages.tsx src/index.css tests/unit/geographic-overview.test.ts
git commit -m "Add: Mindoro geographic dashboards"
```

---

### Task 8: Enforce location-based subscription coverage

**Files:**
- Create: `shared/geography/coverage.ts`
- Test: `tests/unit/coverage.test.ts`
- Modify: `shared/types.ts`, `shared/billing.ts`, `server/handlers/billing.ts`, `server/handlers/admin.ts`, `server/payments/processor.ts`, `server/handlers/fleet.ts`
- Modify: `src/pages/org/OrgPages.tsx`, `src/pages/super/SuperPages.tsx`, `tests/unit/billing.test.ts`, `tests/integration/saas.test.ts`

**Interfaces:**
- Consumes: the catalog, subscriptions, organizations, and premium feature checks.
- Produces: `CoverageScope`, `validateCoverageScopes()`, `coverageIncludes()`, and `requireSubscriptionCoverage()`.

- [ ] **Step 1: Write failing coverage tests**

```ts
it("province coverage includes descendants", () => {
  expect(coverageIncludes([{ level: "province", psgcCode: ORIENTAL_PSGC }], calapanRef)).toBe(true);
});
it("municipality coverage excludes another municipality", () => {
  expect(coverageIncludes([{ level: "municipality", psgcCode: CALAPAN_PSGC }], naujanRef)).toBe(false);
});
it("public safety ignores paid coverage", () => {
  expect(canUseFeatureWithoutCoverage("emergencyAlerts")).toBe(true);
  expect(canUseFeatureWithoutCoverage("floodMonitoring")).toBe(true);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/coverage.test.ts`

Expected: FAIL because `coverage.ts` is missing.

- [ ] **Step 3: Implement discriminated coverage validation**

```ts
export type CoverageScope =
  | { level: "province"; psgcCode: string }
  | { level: "municipality"; psgcCode: string }
  | { level: "barangay"; psgcCode: string };
```

Reject unknown codes, level/code mismatches, duplicates, and redundant descendants under an included parent. Add scopes to subscriptions and billing summaries.

- [ ] **Step 4: Validate checkout and contracts**

Derive government coverage from approved grants. Business/enterprise administrators may select configured service scopes. Store normalized scopes in payment metadata and copy immutable scopes to the subscription only after verified payment.

- [ ] **Step 5: Enforce coverage only for paid operations**

Fleet monitoring, advanced exports, and paid API calls require subscription coverage. Public maps, alerts, evacuation data, reporting, and basic navigation must not call this guard. Add integration assertions for both paths.

- [ ] **Step 6: Add coverage selection UI**

Use the geographic selector in multi-select mode, summarize PSGC names, and explicitly state that emergency features remain island-wide and free. Use the same control for Super Admin manual contracts.

- [ ] **Step 7: Verify and commit**

Run: `npx vitest run tests/unit/coverage.test.ts tests/unit/billing.test.ts && npm run test:emulator:attached`

Expected: out-of-coverage premium requests return HTTP 403 `coverage_denied`; public safety calls succeed.

```powershell
git add shared/geography/coverage.ts shared/types.ts shared/billing.ts server/handlers/billing.ts server/handlers/admin.ts server/payments/processor.ts server/handlers/fleet.ts src/pages/org/OrgPages.tsx src/pages/super/SuperPages.tsx tests/unit/coverage.test.ts tests/unit/billing.test.ts tests/integration/saas.test.ts
git commit -m "Add: Location-based subscription coverage"
```

---

### Task 9: Update risk, routing, AI, offline mode, and demo coverage

**Files:**
- Create: `tests/e2e/geographic-expansion.e2e.mjs`
- Modify: `server/handlers/risk.ts`, `server/handlers/routing.ts`, `server/ai/prompts.ts`
- Modify: `src/services/geocodeService.ts`, `src/hooks/useOfflineSnapshot.ts`, `src/pages/OfflineKitPage.tsx`, `src/pages/ReportPage.tsx`, `src/components/evacuation/SosPanel.tsx`
- Modify: `scripts/seed.ts`, `tests/unit/risk.test.ts`, `tests/unit/routing.test.ts`, `tests/e2e/demo-flow.e2e.mjs`, `tests/e2e/offline-pwa.e2e.mjs`, `package.json`

**Interfaces:**
- Consumes: the catalog, scoped public data, route-provider results, and offline snapshots.
- Produces: PSGC-keyed risk rows, island-biased geocoding, versioned offline scopes, complete Calapan seeds, and explicit disconnected-road behavior.

- [ ] **Step 1: Add failing risk and routing tests**

```ts
it("creates one target per Mindoro LGU", () => {
  expect(buildRiskTargets(MINDORO_CATALOG)).toHaveLength(26);
});
it("does not invent mainland-to-Lubang travel", async () => {
  const result = await planWithProvider(mainlandPoint, lubangPoint, providerReturningNoRoute);
  expect(result).toMatchObject({ status: "no_verified_road_route", routes: [] });
  expect(result.geometry).toBeUndefined();
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/unit/risk.test.ts tests/unit/routing.test.ts`

Expected: FAIL on 26 targets and disconnected routing.

- [ ] **Step 3: Replace Oriental-only risk, prompt, and geocoding constants**

Risk iterates all 26 LGUs, batches weather calls within provider limits, keys predictions by municipality PSGC, and retains completeness warnings. Nominatim uses full service bounds. User-visible AI prompts say Mindoro Island and remain grounded in verified records.

- [ ] **Step 4: Return explicit disconnected-route results**

When every deterministic road provider returns no route, return HTTP 422 code `no_verified_road_route`, origin/destination PSGC scopes, and no geometry. Explain that no verified road-only route exists without implying ferry availability.

- [ ] **Step 5: Version offline geographic snapshots**

Store `scope`, `catalogVersion`, saved names, and age. If opened after a catalog update, show the saved names plus a version warning rather than silently relabeling old codes.

- [ ] **Step 6: Seed all geography without invented operations**

Seed catalog units and jurisdiction grants for all 26 LGUs. Keep the complete Calapan operational scenario. Any Occidental example is `simulated: true`; jurisdictions without demo operations use `no_verified_feed`.

- [ ] **Step 7: Add island E2E coverage**

Verify both provinces, a complete Oriental/Calapan/barangay URL selection, no-feed status in an Occidental municipality, cross-province mutation denial, same-province provincial access, 26-LGU Super Admin view, disconnected Lubang route, and the unchanged Calapan demo.

- [ ] **Step 8: Run and commit**

```powershell
npm test
npm run test:e2e
npm run test:e2e:geography
npm run build
npm run test:e2e:offline
```

Expected: all commands PASS.

```powershell
git add server/handlers/risk.ts server/handlers/routing.ts server/ai/prompts.ts src/services/geocodeService.ts src/hooks/useOfflineSnapshot.ts src/pages/OfflineKitPage.tsx src/pages/ReportPage.tsx src/components/evacuation/SosPanel.tsx scripts/seed.ts tests/unit/risk.test.ts tests/unit/routing.test.ts tests/e2e package.json
git commit -m "Add: Full-island disaster workflows"
```

---

### Task 10: Document, audit, and verify the expansion

**Files:**
- Modify: `README.md`, `.env.example`, `firestore.indexes.json`
- Modify: `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/API.md`, `docs/SECURITY.md`, `docs/DEMO.md`, `docs/SETUP.md`, `docs/DEPLOYMENT.md`, `docs/STATUS.md`

**Interfaces:**
- Consumes: all implemented geography behavior and evidence.
- Produces: reproducible operator documentation and final verification results.

- [ ] **Step 1: Update architecture and data-model docs**

Document codes, provenance, assets, operational fields, grants, coverage scopes, summary cache, migration metadata, compatibility fields, and actual pinned source hashes.

- [ ] **Step 2: Update setup, deployment, API, and security docs**

Include exact import/check, migration dry-run/apply, index deployment, emulator seed, catalog upgrade, and rollback commands. Document `/api/geography/overview`, `refresh=1`, `coverage_denied`, and `no_verified_road_route`.

- [ ] **Step 3: Update demo and status truthfully**

Keep Calapan as the operational path. Add the island filter/dashboard sequence. Distinguish PSGC support, authoritative/approximate/unavailable boundaries, verified sources, simulated data, and no-feed jurisdictions.

- [ ] **Step 4: Run source, generated-file, whitespace, and secret checks**

```powershell
npx tsx scripts/geography/importPsgc.ts --check
npx tsx scripts/geography/importBoundaries.ts --check
git diff --check
git grep -n -I -E "(AIza[0-9A-Za-z_-]{20,}|sk-[0-9A-Za-z]{20,}|BEGIN PRIVATE KEY)" -- . ":(exclude).env.example"
```

Expected: current generated assets, no whitespace errors, no secrets.

- [ ] **Step 5: Run the complete verification matrix**

```powershell
npm run typecheck
npm test
npm run test:emulator
npm run build
npm run test:e2e
npm run test:e2e:geography
npm run test:e2e:offline
```

Expected: every command exits 0. Record exact totals and external-service limitations in `docs/STATUS.md` only after this run.

- [ ] **Step 6: Check specification coverage and the aggregate diff**

Run `git status --short` and review every acceptance criterion against code or a passing test. Confirm unrelated pre-existing changes were not discarded or silently included.

- [ ] **Step 7: Commit documentation**

```powershell
git add README.md .env.example docs firestore.indexes.json
git commit -m "Update: Mindoro expansion documentation"
```

- [ ] **Step 8: Request review and re-verify**

Use `superpowers:requesting-code-review` on the aggregate branch diff. Fix confirmed issues with a test, rerun affected suites, then use `superpowers:verification-before-completion` before reporting completion.
