# Architecture

## At a glance

```
Browser — React PWA (src/)
  │  service worker (src/sw/service-worker.js): app shell, map tiles, offline kit
  │  IndexedDB: offline report drafts, saved snapshot of centers/alerts/advisories
  │
  ├── reads public data directly ─────────►  Cloud Firestore  (firestore.rules decide access)
  │     real-time onSnapshot + persistent local cache
  │
  └── /api/*  (Firebase ID token) ────────►  Backend (server/, serverless functions)
                                               │  firebase-admin → Firestore + Auth
                                               ├─ Routing ......... OSRM (FOSSGIS) or OpenRouteService
                                               ├─ Weather/elevation  Open-Meteo (no key)
                                               ├─ AI .............. Groq (text), Gemini (images)
                                               ├─ Images .......... Cloudinary, or inline fallback
                                               ├─ Payments ........ PayMongo / Xendit / sandbox
                                               └─ Push ............ Firebase Cloud Messaging
```

## Why this shape

The target infrastructure cost is ₱0, so everything has to run on Firebase's
free **Spark** plan:

- **Firebase Auth and Cloud Firestore** work on Spark, so they hold all identity and data.
- **Cloud Functions** need the Blaze plan, so the trusted backend in `server/`
  runs as a **Netlify Function** instead (free tier). The same handlers also
  run as a Vercel function (`api/index.ts`) and, during development, inside the
  Vite dev server (`server/devPlugin.ts`), so local work needs one process.
- **Firebase Storage** needs Blaze for new projects, so report photos go to
  **Cloudinary**'s free tier, with an inline Firestore fallback for demos.

The split between browser and backend follows one rule. The browser reads
public safety data straight from Firestore, which gives it real-time updates
and offline caching for free. **Anything that needs trust goes through the
backend**, and the rules deny those writes from clients. That covers report
submission, side effects of verification, public alerts, AI calls, billing,
roles and entitlements.

## Repository layout

| Path | What lives there |
|---|---|
| `src/` | React 18 + TypeScript SPA. Pages are lazy-loaded (`App.tsx`). |
| `src/sw/service-worker.js` | Custom service worker. Its precache list is generated at build time by `server/pwaPlugin.ts`. |
| `shared/` | Code used by both browser and backend: types, plans, billing math, the routing engine, the risk model, validation, report heuristics. |
| `server/` | Backend. `routes.ts` is the route table; `handlers/` holds endpoints; `lib/` holds auth, rate limits, audit, alerts and settings; `ai/`, `payments/` and `storage/` hold provider adapters. |
| `netlify/functions/` | `api.mts` serves `/api/*`; `daily.mts` is the scheduled billing job. |
| `api/index.ts` | Vercel adapter for the same router (alternative host). |
| `scripts/` | Local admin scripts: `seed.ts`, `createAccount.ts`, `exportFirestore.ts`, `importFirestore.ts`, and the original `createDrrmAccount.js`. |
| `tests/` | `unit/` (Vitest), `rules/` and `integration/` (Emulator Suite), `e2e/` (real browser). |
| `functions/` | Unused Cloud Functions scaffold from the original repo. It is not deployed, because Cloud Functions need Blaze, and it is kept only so nothing is lost. |

## Geography, scope, and tenancy

Geography is a reusable hierarchy, not a set of Oriental-Mindoro constants.
`shared/geography/catalog.generated.ts` contains MIMAROPA (`1700000000`),
Occidental Mindoro (`1705100000`), Oriental Mindoro (`1705200000`), the 26
city/municipal LGUs, and 590 barangays from PSA PSGC 2Q 2026. The source
manifest in `data/geography/sources.json` pins retrieval metadata and workbook
SHA-256 `31892bc2bdde3ea0682562d9412b5bab4d45a0be5e5a5b4f6c9d7714b94bca5d`.

PSGC codes are identifiers; boundaries are separate assets. No approved
polygon files were available for this build. Geoportal Philippines describes
the candidate layer as approximate and conditional-download, so
`boundaries.generated.json` deliberately has zero features and the UI says
`unavailable`. Catalog bounding boxes support navigation and map fitting but
are never rendered or described as administrative boundaries.

The URL-backed `GeographicScopeProvider` owns province, municipality/city, and
barangay filters. Scoped hooks issue bounded Firestore queries and retain the
last confirmed scope while a new one loads. `geographic_summaries/{scopeKey}`
caches public counts and freshness for five minutes; mutations invalidate the
barangay, municipality, province, and island ancestors.

Operational documents carry additive `regionPsgcCode`, `provincePsgcCode`,
`municipalityPsgcCode`, `barangayPsgcCode`, and `locationAssignment`. The
assignment records method, confidence, source version, time, and actor. Legacy
`area`, `assignedArea`, and `areas` remain readable during migration; new
authorization does not trust them.

LGU access comes from server-owned
`organizations/{orgId}/jurisdiction_grants/{psgcCode}` documents. A province
grant covers descendants; a municipality or barangay grant does not escape its
ancestry. Super Admin remains island-wide. Paid operations use the separate
`subscriptions.coverageScopes` contract, so commercial coverage never grants
government write authority. Citizens can read public safety data island-wide
without a subscription.

## Key flows

### Flood-aware navigation
1. The client posts origin, destination and vehicle to `POST /api/route`.
2. The backend loads **verified** hazards only: active `floodZones`, active
   `road_conditions`, and simulated demo zones (which are labelled). It caches
   them briefly in memory.
3. `shared/routing/planner.ts` requests the fastest road route plus
   alternatives from OSRM, or from ORS with `avoid_polygons` when it is keyed.
   It then checks each route against every hazard for the chosen vehicle; the
   per-vehicle limits come from the MMDA gauge-based passability rules.
4. If every candidate crosses a hazard, the planner searches detour
   via-points around it. It returns safe, caution or no-safe-route, with
   turn-by-turn steps and how old each hazard report is. When providers report
   no connected road route (for example mainland Mindoro to Lubang), the API
   returns HTTP 422 `no_verified_road_route`, an empty route list, and no
   geometry; it never implies ferry availability.
5. If the backend is unreachable, the browser runs the same planner itself
   against public OSRM and the hazards already synced to the device
   (`src/services/routingService.ts`, `source: "device"`).
6. `POST /api/ai/explain-route` gets **only the computed result**. Groq
   rewrites it in plain English or Filipino, and it cannot add roads or conditions.

### Community report → verification → map
1. The browser compresses the photo and posts it to `POST /api/reports`.
   Guests use Firebase anonymous auth.
2. The backend:
   - validates the input and applies rate limits;
   - checks the image by its magic bytes;
   - stores the photo and runs the Gemini analysis in parallel;
   - flags possible duplicates and suspicious reports;
   - writes `community_reports/{id}` with `status: "pending"`.
   AI failure never blocks a report.
3. LGU staff for that area review it at `/admin/verification`. Verifying can
   create or update a flood zone and optionally send a nearby alert.
   **Only this step changes the official map and routing.**

### Alerts
`publishAlert` (`server/lib/alerts.ts`) writes a public `alerts/{id}`
document. It then matches users whose saved places or last alert location
fall within the radius, writes in-app notifications for them, and sends FCM
web push when that is configured. Alerts are never gated by plan.

### Billing → entitlements
Checkout creates a `payment_transactions` record and a hosted payment page.
Only a **verified webhook** (or the sandbox completion endpoint for demo
transactions) can mark it paid. One Firestore transaction then:
- records the event in `webhook_events`, for idempotency;
- extends `subscriptions/{id}`;
- issues a `billing_invoices` record;
- recomputes `organizations/{orgId}.entitlements`.

Rules read that entitlements map, so paid features turn on and off without
redeploying. See [PAYMENTS.md](PAYMENTS.md).

### AI
Every AI call goes through `server/ai/service.ts`, which handles:
- the quota transaction;
- the response cache;
- the provider order (primary model → fallback model → other provider);
- usage and cost logging.

When every provider fails, it returns `provider: "simulated"` and the caller
falls back to deterministic output, labelled in the UI. See [AI.md](AI.md).

### Offline
- The service worker precaches the app shell and every lazy chunk, so pages
  never opened before still load offline.
- Map tiles the user has viewed are cached (up to 1,500).
- Firestore's persistent cache keeps the last synced data.
  `useOfflineSnapshot` also saves centers, alerts, advisories and hotlines
  for the offline kit.
- Reports made offline are stored in IndexedDB. They are sent when the device
  reconnects; `clientDraftId` makes resending idempotent.
- The UI always says when it is showing saved data and how old it is. An
  empty cache shows "—", never "0 flood zones".

- The offline snapshot stores the selected PSGC scope, catalog version, and
  the location names as they were saved. After a catalog upgrade those names
  are preserved with a warning instead of silently relabelling old codes.

## Principles enforced in code

| Principle | Where |
|---|---|
| Only verified data changes official passability and routing | `server/lib/hazards.ts` reads only DRRM-published zones and roads; `community_reports` cannot be written by clients. |
| AI explains; it never decides routes or conditions | `server/handlers/ai.ts` (`explainRoute` receives the deterministic result); prompts in `server/ai/prompts.ts`. |
| Public safety stays free | `PUBLIC_SAFETY_FEATURES` in `shared/plans.ts`. `validatePlan()` rejects any plan edit that would gate them, and `computeEntitlements()` always sets them to true. |
| Cached data is never presented as live | `StatusBanners.tsx` (offline banner), `Freshness` timestamps, offline-aware map counters. |
| Simulated data is labelled and cannot be faked by clients | `simulated` / `isDemo` flags. The rules' `notSimulatedByClient()` and `simulatedUnchanged()` stop clients setting or clearing them. |
| Real money is kept separate from demo money | `isDemo` on subscriptions and transactions; `splitRealDemo()` in `shared/billing.ts`; separate real and demo totals in `revenue_records`. |
