# Mindoro Island Geographic Expansion Design

**Date:** 2026-10-10

**Status:** Approved design

**Scope:** Oriental Mindoro and Occidental Mindoro, including all 26 city and municipal LGUs and their barangays

## Purpose

Expand Bahadvisory from an Oriental Mindoro pilot into a geographic platform
that supports both Mindoro provinces without weakening public-safety access,
tenant isolation, or the existing Calapan demonstration. The geographic model
must be reusable for later Philippine provinces without another database or
frontend redesign.

The hackathon priority is a complete, reliable Calapan and Oriental Mindoro
workflow. The rest of Mindoro must have working geography, filters,
authorization, routing, reporting, and dashboards, but it must not imply live
operational coverage where verified feeds do not exist.

## Goals

- Support all 26 city and municipal LGUs in Oriental and Occidental Mindoro.
- Provide province, city/municipality, and barangay filters based on PSGC IDs.
- Use authoritative Philippine geographic identifiers and boundaries.
- Associate operational records with a validated geographic hierarchy.
- Enforce municipal, barangay, provincial, and platform-wide jurisdictions.
- Keep verified public safety information free across the entire service area.
- Add provincial dashboards and an island-wide comparison dashboard.
- Support location-scoped subscriptions independently from safety access.
- Load map geometry and operational data efficiently by scope and viewport.
- Preserve existing data and the current Calapan demonstration.
- Make later Philippine expansion a data import and configuration task.

## Non-goals

- Claiming that every Mindoro LGU supplies live data.
- Creating or inferring real-time readings for areas without verified sources.
- Replacing authoritative boundaries with unverified polygons.
- Providing unverified ferry routing between mainland Mindoro, Lubang, and
  Looc.
- Nationwide rollout in this phase.
- Deleting legacy `area` fields before migration has been verified.

## Authoritative Sources and Provenance

### Geographic identities

The Philippine Statistics Authority Philippine Standard Geographic Code
(PSGC) master list is the source of truth for region, province,
city/municipality, and barangay identifiers and names. Imports pin a specific
PSGC quarterly release so upstream changes never alter production geography
silently.

Source: <https://psa.gov.ph/classification/psgc>

### Boundaries

Administrative geometry must come from Geoportal Philippines/NAMRIA or
another explicitly approved Philippine government publication. An imported
asset records:

- source agency and URL;
- dataset title and geographic level;
- publication or retrieval date;
- source version;
- file checksum;
- license or permitted-use note; and
- simplification settings used to create application assets.

Source portal: <https://geoportal.gov.ph/>

If an authoritative boundary cannot be obtained or legally bundled, the PSGC
unit remains available with its verified identity and approximate extent, but
the UI displays **Authoritative boundary unavailable**. The system does not
silently substitute an unverified polygon.

## Geographic Model

### Geographic unit

The generated shared catalog exposes this logical model:

```ts
type GeographicLevel = "region" | "province" | "city" | "municipality" | "barangay";

interface GeographicUnit {
  psgcCode: string;
  name: string;
  level: GeographicLevel;
  parentPsgcCode: string | null;
  regionPsgcCode: string;
  provincePsgcCode: string | null;
  municipalityPsgcCode: string | null;
  center: [number, number];
  boundingBox: [[number, number], [number, number]];
  boundaryAsset: string | null;
  sourceVersion: string;
}
```

PSGC codes are strings so leading zeroes are never lost. Names are display
labels, not identity keys.

The catalog includes MIMAROPA, Oriental Mindoro, Occidental Mindoro, all 26
component city/municipality records, and every barangay in those LGUs from the
pinned release. It also covers the administratively included offshore
municipalities of Lubang and Looc.

### Operational record location

Flood reports, flood zones, road conditions, evacuation centers, alerts,
incidents, water-level stations, weather observations, and risk predictions
gain the following additive fields:

```ts
interface GeographicReference {
  regionPsgcCode: string;
  provincePsgcCode: string;
  municipalityPsgcCode: string;
  barangayPsgcCode: string | null;
  locationAssignment: {
    method: "boundary" | "manual" | "migrated";
    confidence: "high" | "medium" | "review_required";
    assignedAt: unknown;
    assignedBy: string;
  };
}
```

The existing human-readable `area` field remains during the compatibility
period. New code uses PSGC fields for queries and authorization and uses the
catalog for display names.

### Geometry storage

Large polygons are not stored in Firestore. A build/import pipeline produces:

- one small full-island province asset;
- one simplified municipality asset per province;
- one barangay asset per city/municipality; and
- generated lookup tables for frontend and backend validation.

The original source geometry remains outside the web bundle. Application
assets use documented simplification and preserve enough precision for map
selection. Backend point-in-polygon assignment uses higher-resolution
geometry than the display map when that geometry is licensed for use.

## Import and Update Pipeline

The import process is reproducible and fails closed:

1. Fetch or accept a local copy of a pinned PSA PSGC publication.
2. Parse and normalize geographic units as strings.
3. Select the two Mindoro provinces and all descendants.
4. Assert two provinces and 26 city/municipality units.
5. Validate unique codes and every parent-child relationship.
6. Ingest approved authoritative boundary data.
7. Match geometry to PSGC codes rather than names where possible.
8. Reject unmatched, duplicate, or cross-parent geometry.
9. Generate TypeScript lookups, metadata, and optimized map assets.
10. Write a machine-readable import report and checksums.

An update produces a diff report showing additions, removals, renames, code
changes, and boundary changes. A human reviews that report before generated
assets are replaced.

## Geographic Selection and Map Behavior

All relevant maps and dashboards use a shared cascading selector:

```text
Province -> City/Municipality -> Barangay
```

The selector uses PSGC values and displays catalog names. Selecting a parent
clears invalid child selections. The active scope is written to URL query
parameters so views are bookmarkable and shareable.

Map behavior by scope:

- **Island:** fit both provinces and show province summaries and clustered
  verified alerts.
- **Province:** fit the province and show municipalities and comparisons.
- **City/municipality:** fit the LGU and load operational features.
- **Barangay:** fit the barangay and show locally scoped records.

If boundary loading fails, the map uses the catalog bounding box or center and
shows a boundary warning. It does not remove existing operational data or
render an empty state that could be mistaken for safety.

## Data Loading and Performance

The client must not download all island records at startup.

- Island requests return aggregates, active high-priority verified alerts,
  and clustered summaries.
- Province requests return municipality aggregates.
- Operational points load at municipality level or through bounded viewport
  queries.
- Barangay geometry loads only after its parent municipality is selected.
- In-flight requests are cancelled when scope changes.
- Geographic assets and safe public aggregates use versioned caches.
- Map markers are clustered and large layers are lazy-loaded.
- Firestore indexes cover PSGC scope, public/verified status, active status,
  severity, and time as required by each query.

The application records payload size and query counts in performance tests.
The initial island view must not include barangay polygons or complete
operational collections.

## Location Assignment

New point-based records are assigned on the backend:

1. Confirm the point is inside the supported Mindoro service extent.
2. Locate the authoritative province and municipality polygon.
3. Locate a barangay polygon when available.
4. Validate that all PSGC units form a valid hierarchy.
5. Save the assignment method and confidence.

Manual staff correction is allowed only within an authorized jurisdiction,
requires a reason, and creates an audit record. If no authoritative polygon is
available, the record is not given a high-confidence automatic barangay.

## Multi-tenant Authorization

Roles continue to describe what a person may do. Geographic grants describe
where they may do it.

Organization levels are:

- `barangay` for barangay-restricted operations;
- `municipality` for city or municipal DRRM offices;
- `province` for provincial disaster response offices; and
- `platform` for Bahadvisory administration.

Jurisdiction grants use exact PSGC codes. They are stored in server-managed
documents that clients cannot create, edit, or delete. Custom claims retain
only compact identity facts such as user role and organization ID; potentially
large jurisdiction lists do not go in tokens.

A privileged write succeeds only when:

1. the authenticated user is active;
2. the role permits the action;
3. membership belongs to the target organization;
4. a municipality, barangay, or province grant covers the record hierarchy;
5. any premium operation has an active server-verified entitlement; and
6. the backend creates an audit record.

Municipal personnel cannot change another municipality. Barangay-restricted
personnel cannot change another barangay. Provincial personnel can operate
only within their granted province. Platform Super Admins can monitor and
administer the configured service area, with all mutations audited.

Citizens can read verified public safety information anywhere in the service
area and submit reports through validated backend endpoints. They can manage
only their own private locations, drafts, and notification settings. They
cannot publish official hazards, assign privileged roles, or grant
jurisdictions.

## Location-based Subscriptions

Subscription geography is independent from public-safety access:

```ts
type CoverageScope =
  | { level: "province"; psgcCode: string }
  | { level: "municipality"; psgcCode: string }
  | { level: "barangay"; psgcCode: string };
```

An organization subscription contains plan, status, effective dates,
entitlements, and validated coverage scopes. A municipal LGU covers its legal
municipality; a provincial plan can cover its province; a business can buy
selected municipalities or both provinces; enterprise coverage can later
include multiple provinces.

Coverage scopes govern premium analytics, fleet monitoring, integrations,
staff limits, and operational reports. They never paywall verified alerts,
evacuation information, public flood maps, community reporting, or basic safe
navigation.

## Dashboards

### Full-island overview

Platform administrators receive island-wide comparisons for:

- active verified flood zones;
- community report status;
- active road disruptions;
- verified evacuation centers and verified occupancy;
- active alerts and published advisories;
- experimental risk indicators; and
- data freshness and coverage completeness.

Every metric supports province and municipality drill-down.

### Provincial dashboard

Authorized provincial personnel receive the same comparisons limited to their
province, including a municipality table, current operational items, stale
data warnings, and source coverage. Municipal staff open directly in their
municipality scope.

### Coverage status

Each jurisdiction visibly reports one of:

- verified operational data;
- simulated hackathon data;
- no verified operational feed;
- stale cached data; or
- source unavailable.

An empty jurisdiction never displays as implicitly safe.

## Navigation and Disconnected Geography

Road routing remains deterministic and evaluates verified hazards. The
service scope covers the administrations of both provinces, including Lubang
and Looc, but a road engine cannot imply a continuous route between separated
islands. When no road-only route exists, the UI says so. Ferry segments are
shown only after a verified transport data source and dedicated routing model
are approved.

## Demo and Data Integrity

The complete hackathon workflow remains based in Calapan and Oriental
Mindoro. Existing seeded records retain their simulated labels.

The remainder of Mindoro receives working geography, selectors, access
control, routing, reporting, and dashboards. Optional non-Calapan demo records
must carry `simulated: true`, a visible simulated badge, and a known seed
source. The application never invents real-time flood readings, evacuation
availability, road closures, or official operational coverage.

## Migration

Migration is additive, idempotent, and recoverable:

1. Export existing Firestore data.
2. Run a dry-run that reports matched, ambiguous, and unresolved documents.
3. Map known municipality names to PSGC codes.
4. Assign barangays only when authoritative geometry or explicit verified
   source data supports the assignment.
5. Preserve legacy fields and original values.
6. Write migration metadata and audit records.
7. Re-running the same migration makes no further changes.

Ambiguous records remain available but carry `review_required`; they do not
receive fabricated geographic precision. Destructive cleanup is a later,
separately approved operation.

## Failure Handling

- **No data:** display no verified operational feed, never safe.
- **Boundary unavailable:** use extent/center with a warning; require review
  for detailed automatic assignment.
- **Scoped query failure:** retain the previous view and show an error rather
  than an empty map.
- **Cached data:** show last-updated time and offline/stale status.
- **Routing failure:** report no verified route and retain emergency guidance.
- **Geographic update conflict:** keep the current pinned catalog active until
  a reviewed import succeeds.
- **Invalid hierarchy:** reject the write server-side.

## Security and Test Strategy

### Catalog tests

- The catalog contains exactly two Mindoro provinces and 26 city/municipality
  LGUs.
- PSGC codes are unique strings.
- Every municipality belongs to the correct province.
- Every barangay belongs to a catalog municipality.
- Generated geometry metadata matches the pinned source checksum.

### Geographic behavior tests

- Cascading filters clear invalid children.
- URL scopes restore the same map selection.
- Each selection fits the expected boundary or fallback extent.
- Point-in-polygon fixtures resolve to the expected hierarchy.
- Viewport and zoom changes request only the intended scope.
- Lubang/mainland road routing cannot produce a fabricated continuous route.

### Authorization tests

- Municipal staff cannot read private or mutate official records in another
  municipality.
- Barangay-restricted staff cannot mutate another barangay.
- Provincial staff can operate across their province but not the other one.
- Platform Super Admin access is island-wide and audited.
- Citizens retain free anonymous access to verified public safety data.
- Clients cannot forge PSGC hierarchy, grants, entitlements, or simulated
  status.
- Subscription scopes restrict premium operations but never public safety.

### Migration and regression tests

- Dry-run performs no writes.
- Migration is idempotent and preserves legacy data.
- Ambiguous records remain flagged for review.
- Current unit, emulator, E2E demo, and offline suites continue to pass.
- A new Calapan geographic E2E path verifies report assignment, LGU
  verification, map update, navigation, alerting, and dashboards.
- An island E2E path verifies province/municipality/barangay filtering,
  full-island aggregates, provincial access, and tenant denial.

## Delivery Sequence

1. Add the PSGC import and authoritative-boundary pipeline.
2. Generate shared geography types, indexes, and optimized assets.
3. Replace hard-coded Oriental Mindoro geography with configured service
   geography.
4. Add cascading selectors and automatic map fitting.
5. Add PSGC fields and the additive migration path.
6. Add jurisdiction grants and enforce them in rules and backend handlers.
7. Add provincial and full-island dashboards.
8. Add location-scoped subscriptions.
9. Update demo seeds, labels, documentation, and offline snapshots.
10. Run security, migration, performance, build, emulator, browser, and
    offline verification.

## Acceptance Criteria

- Both provinces and all 26 city/municipal LGUs appear with standardized PSGC
  identifiers.
- Barangay selectors use the pinned PSGC hierarchy.
- Maps center and filter correctly at all three selectable levels.
- Supported records store validated PSGC references and location-assignment
  metadata.
- Municipal, barangay, provincial, and platform scopes pass positive tests
  and cross-scope denial tests.
- Public safety information remains free and anonymous-readable.
- Provincial and island dashboards clearly compare jurisdictions and data
  coverage.
- Initial island rendering does not load every barangay polygon or operational
  record.
- The Calapan pilot demonstration remains complete and passing.
- All non-verified operational content is visibly labeled simulated, stale,
  unavailable, or without a verified feed.
- The catalog/import interfaces accept later Philippine provinces without a
  schema or frontend redesign.
