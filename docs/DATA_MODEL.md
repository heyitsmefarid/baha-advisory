# Data model

Firestore is the single database. TypeScript interfaces for every document
are in [`shared/types.ts`](../shared/types.ts), and access rules are in
[`firestore.rules`](../firestore.rules). Composite indexes and TTL policies
are in [`firestore.indexes.json`](../firestore.indexes.json).

## Reconstruction notes

- **The original project could not be reached.** Firebase returned 403 for
  the original project from the account used for this work, so no historical
  records were recovered and **none were invented**. The model below was
  rebuilt from the original source code: `floodZones`, `zoneHistory/*/updates`,
  `users`, and claims `role` / `assignedArea`.
- **Original names were kept** so existing code, and any data still in the old
  project, keep working: `floodZones`, `zoneHistory`, `users`, and the
  `drrm_editor` / `admin` roles. Legacy roles map to new ones in
  `shared/roles.ts`: `drrm_editor` → `lgu_staff`, and `admin` → a
  province-wide `lgu_admin`.
- **If the owner still has the old project**, export it with
  `npm run export-firestore -- --production --out backup.json`, a read-only
  JSON export. Restore with `npm run import-firestore`. The import skips
  existing documents unless `--overwrite` is passed, and supports `--dry-run`.

## Mapping from the proposed model

The brief proposed a list of collections and allowed consolidation. Each
proposed collection maps as follows.

| Proposed | Implemented as | Why |
|---|---|---|
| `users` | `users/{uid}` | Profile only. The role is copied from verified claims; no passwords are stored. |
| `user_roles` | Auth custom claims (`role`, `orgId`) + `organizations/{orgId}/members/{uid}` + jurisdiction grants | Claims identify the tenant; server-owned PSGC grants define its geographic authority. Legacy `assignedArea` / `areas` claims remain readable only for migration compatibility. |
| `flood_zones` | `floodZones/{zoneId}` + `zoneHistory/{zoneId}/updates/{id}` | Original names. The history is append-only and doubles as the zone audit trail. |
| `flood_reports` | `community_reports/{id}` | The original app had no citizen reports. Official zones stay in `floodZones`. |
| `road_conditions` | `road_conditions/{id}` | Polyline with a status and per-vehicle passability. |
| `water_level_stations` | `water_level_stations/{id}` | Includes alert, alarm and critical thresholds. |
| `water_level_readings` | `water_level_stations/{id}/readings/{id}` | Subcollection, so queries stay per station. |
| `incidents` | `incidents/{id}` + `incidents/{id}/timeline/{id}` | Tenant-private. Named `timeline` so it never collides with the public `updates` collection-group query. |
| `advisories` | `advisories/{id}` | Drafts are written by clients; publishing goes through the backend. |
| `notifications` | `users/{uid}/notifications/{id}` | Per-user alert history. |
| `audit_logs` | `audit_logs/{id}` | Server-written platform log. |
| `community_reports` | `community_reports/{id}` + `report_media/{id}` | The photo is in Cloudinary or in `report_media`, which is readable only when the report is verified. |
| `report_verifications` | `community_reports/{id}/verifications/{id}` | One entry per moderation action. |
| `evacuation_centers` | `evacuation_centers/{id}` | Public only when `verified == true`. |
| `evacuation_status_updates` | `evacuation_centers/{id}/status_updates/{id}` | Append-only. |
| `saved_locations` | `users/{uid}/saved_locations/{id}` | Home, school, work or other, each with an alert radius. |
| `saved_routes` | `organizations/{orgId}/saved_routes/{id}` | Business fleet routes, gated by the `fleetMonitoring` entitlement. |
| `route_disruptions` | `organizations/{orgId}/route_disruptions/{id}` + `route_history/{id}` | Written by `POST /api/fleet/check`. |
| `flood_risk_predictions` | `flood_risk_predictions/{municipalityPsgcCode}` | One experimental document per one of the 26 LGUs, overwritten on recompute. |
| `weather_observations` | `weather_observations/{municipalityPsgcCode}_{YYYY-MM-DD-HH}` | Batched Open-Meteo pulls cached under stable PSGC identifiers. |
| `ai_analysis_results` | `ai_analysis_results/{id}` (+ a summary embedded on the report) | Server-written. |
| `ai_chat_history` | `ai_chat_history/{uid}/messages/{id}` | Readable and deletable by the owner only. |
| `offline_sync_queue` | Device IndexedDB (`report_drafts`) + `clientDraftId` idempotency on `POST /api/reports` | A server-side queue cannot help a device that is offline. Resending a draft returns the original report instead of creating a duplicate. |
| `organizations` | `organizations/{orgId}` | Includes the `entitlements` map. |
| `organization_members` | `organizations/{orgId}/members/{uid}` | Document ID = Auth UID. |
| `subscription_plans` | `subscription_plans/{planId}` | Seeded once and then edited by the Super Admin. |
| `subscriptions` | `subscriptions/{id}` | `organizations.subscriptionId` points at the current one. |
| `payment_transactions` | `payment_transactions/{id}` | The ID is the reference sent to the provider. |
| `billing_invoices` | `billing_invoices/{id}` | Numbers come from `counters/invoices`. |
| `ai_usage_records` | `ai_usage_records/{user_<uid>_<period>}` / `{org_<orgId>_<period>}` + `ai_usage_log/{id}` | Counters per day or month in Manila time, plus a per-call log with estimated cost. |
| `feature_entitlements` | `organizations/{orgId}.entitlements` (map) | Computed by the backend from plan, subscription and add-ons. Rules check it with a single `get()`. |
| `revenue_records` | `revenue_records/{YYYY-MM}` | Separate `real` and `demo` totals. |
| `platform_settings` | `platform_settings/{general \| features \| ai}` | `general` and `features` are publicly readable. |

Collections added beyond the proposal:

| Collection | Purpose |
|---|---|
| `sos_requests` | SOS from citizens; only LGU staff can acknowledge. |
| `org_applications` | LGU and Enterprise sign-up requests, approved by the Super Admin. |
| `users/{uid}/emergency_contacts` | Personal contacts for the offline kit. |
| `organizations/{orgId}/api_keys` | Hashed data-API keys (Enterprise, or the Business add-on). |
| `alerts` | Public alerts, always free. |
| `webhook_events` | Idempotency ledger for payment webhooks. |
| `rate_limits` | Shared rate-limit windows. |
| `ai_cache` | Cached AI responses. |
| `counters/invoices` | Sequential invoice numbers. |
| `geographic_units/{psgcCode}` | Seeded mirror of the generated PSA PSGC catalog for operators and integrations. |
| `geographic_source_status/{municipalityPsgcCode}` | `simulated_demo_pilot` or `no_verified_feed`; never converts missing data into a zero. |
| `organizations/{orgId}/jurisdiction_grants/{psgcCode}` | Server-owned province, municipality, or barangay authorization scope. |
| `geographic_summaries/{scopeKey}` | Five-minute public comparison cache with source freshness and explicit unavailable values. |

## ID strategy

- **Auth-owned data** uses the Firebase Auth UID: `users/{uid}`,
  `members/{uid}`, `ai_chat_history/{uid}`.
- **Natural keys** are used where a document is unique per period or entity:
  - `ai_usage_records/user_<uid>_<YYYY-MM-DD | YYYY-MM>`
  - `revenue_records/<YYYY-MM>`
  - `flood_risk_predictions/<municipalityPsgcCode>`
  - `zoneHistory/<zoneId>`
  - `users/{uid}/notifications/alert_<alertId>`, so an alert is never stored twice for a user
  - `webhook_events/<provider>_<eventId>`
- **Auto IDs** are used for everything else.
- **Seed data** uses fixed, readable IDs such as `org_demo_lgu_calapan`, so seeding is idempotent.

## Common fields

| Field | Meaning |
|---|---|
| `createdAt` / `updatedAt` | Server timestamps. |
| `area` | Legacy display name retained for compatibility; it is not authoritative for new access decisions. |
| `regionPsgcCode` / `provincePsgcCode` / `municipalityPsgcCode` / `barangayPsgcCode` | Standardized geographic ancestry. Barangay may be null when geometry or explicit selection is unavailable. |
| `locationAssignment` | `{method, confidence, sourceVersion, assignedAt, assignedBy}` provenance for the geographic assignment. |
| `orgId` | Tenant owner, on tenant-private records. |
| `simulated: true` | Seed or demo record. It is shown with a "Simulated" badge and is never presented as real flood information. |
| `isDemo: true` | Sandbox billing record. It is excluded from real revenue. |

## Who can do what

The default is deny. A summary follows; the rules file has the details, and
`tests/rules/firestore.rules.test.ts` exercises them (38 tests).

| Data | Read | Write |
|---|---|---|
| `floodZones`, `zoneHistory`, `road_conditions`, stations and readings | Everyone | LGU staff only when a live PSGC jurisdiction grant covers the record. History is append-only. |
| `alerts`, `subscription_plans`, `flood_risk_predictions`, `weather_observations` | Everyone | Backend only |
| `evacuation_centers` | Everyone if verified; LGU staff see all | LGU staff in their area |
| `community_reports`, `report_media` | Public once verified; otherwise the reporter, LGU staff and the Super Admin | Backend only. A reporter may withdraw their own pending report. |
| `advisories` | Public once published; otherwise members of the owning org | LGU staff (drafts, only for their areas). Publishing goes through the backend. |
| `incidents` and `timeline` | LGU staff of the owning org | LGU staff of the owning org, **only while the org is entitled to `incidentManagement`** |
| `sos_requests` | The requester and LGU staff | Requester creates or cancels; only LGU staff acknowledge or resolve. |
| `users/{uid}` and subcollections | The owner (plus admins for the profile) | Owner, limited to name, alert preferences, FCM tokens and alert location. Role and org can never be self-assigned. |
| `organizations`, `members`, `api_keys` | Members; members list and keys are admin-only | Backend only |
| `saved_routes`, `route_disruptions`, `route_history` | Org members **while entitled to `fleetMonitoring`** | Members (routes); backend (disruptions) |
| `subscriptions`, `payment_transactions`, `billing_invoices` | The org's admins and the Super Admin | Backend only |
| `revenue_records`, `ai_usage_log` | Super Admin | Backend only |
| `ai_usage_records` | The owner of the counter (matched by ID), the org admin, the Super Admin | Backend only |
| `audit_logs` | Super Admin; org admins see their org's entries | Backend only |
| `webhook_events`, `rate_limits`, `ai_cache` | Nobody | Backend only |

## Geographic source and migration contract

The generated catalog is PSA PSGC 2Q 2026: MIMAROPA `1700000000`,
Occidental Mindoro `1705100000`, Oriental Mindoro `1705200000`, 26 LGUs and
590 barangays. `data/geography/sources.json` pins the workbook SHA-256
`31892bc2bdde3ea0682562d9412b5bab4d45a0be5e5a5b4f6c9d7714b94bca5d`.
No approved polygons are bundled; catalog bounding boxes are navigation
extents only and `boundaryStatus` is `unavailable`.

The additive migration leaves legacy names in place, writes PSGC ancestry and
`geographyMigrationVersion: mindoro-psgc-q2-2026-v1`, and sends unknown or
ambiguous rows to `review_required`. It never guesses a barangay. Re-running
the migration is idempotent. Paid subscriptions and payment transactions keep
`coverageScopes[]`; fleet routes keep `coveragePsgcCode`. Coverage limits paid
operations but does not confer LGU authority.

## Indexes and TTL

`firestore.indexes.json` holds:
- composite indexes for every multi-field query used by the app and backend;
- a collection-group field override for `updates.timestamp` (the advisories feed);
- a collection-group override for `api_keys.hash` (API-key lookup);
- **TTL policies** on `rate_limits.expireAt` and `ai_cache.expireAt`.

The code ignores expired documents on its own, so the TTL policies only
matter for storage hygiene.

## Seeding

`npm run seed` creates the plans, platform settings and demo data. See
[SETUP.md](SETUP.md#11-running-database-initialization-scripts) and
[DEMO.md](DEMO.md).
