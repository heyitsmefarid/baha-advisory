# Project status

Last updated: 2026-10-14. This page records what was built, how it was
verified, and **what is not yet verified or needs credentials, data or
approval from outside the project.**

## Current verification results (2026-10-14)

| Check | Result |
|---|---|
| `npm run typecheck` (app + server/scripts/tests) | ✅ no errors |
| `npm test` | ✅ 93 / 93 unit tests |
| `npm run build` | ✅ production build and service-worker precache generated |
| Local app `/` and `/api/health` | ✅ HTTP 200; API reported `ok: true` |
| `npm run test:emulator:attached` | ✅ 57 / 57 Firestore-rules and API integration tests against the running local emulators |
| `npm run test:e2e` | ✅ 13 / 13 real-browser demo steps |
| `npm run test:e2e:offline` | ✅ 7 / 7 production-build offline/PWA checks |

The emulator checks used Android Studio's bundled Java runtime and the already
running, seeded Firebase emulators. The standalone `java` command is not on
`PATH`.

## Feature status

| Feature | Status |
|---|---|
| **Original features** | ✅ Preserved: public map, advisories feed, DRRM dashboard, Manage Map, incidents, users, audit logs. Original collections and roles kept, legacy roles mapped. A latent bug was fixed: the advisories `collectionGroup('updates')` query had no matching rule. |
| **1. Flood-aware navigation** | ✅ Implemented and verified live (OSRM): vehicle-specific passability, alternatives, avoiding verified hazards, turn-by-turn steps, data freshness, recalculation, on-device fallback. ⚠️ ORS polygon avoidance needs `ORS_API_KEY` (not tested live). |
| **2. Location-based alerts** | ✅ Alerts, radius matching against saved places, in-app history; critical alerts always free. ⚠️ FCM push needs a real project, a VAPID key and the service account (**not verified**). |
| **3. AI community reporting** | ✅ Photo, GPS or manual location, depth, duplicate and suspicious flags, DRRM moderation; only verified reports change the map. ⚠️ Gemini analysis is not verified with a real key (labelled fallback verified). |
| **4. Predictive flood risk** | ✅ Experimental, rule-based (PAGASA rainfall thresholds, gauges, verified zones, history, elevation) with stated data completeness. **No accuracy claim**; there is no labelled local data to validate it. |
| **5. Evacuation finder** | ✅ Verified centers ranked by safe road time, LGU management, SOS queue, hotlines. Capacity is shown only when an LGU verified it. |
| **6. Offline PWA** | ✅ Verified in a browser: precached shell, viewed tiles, offline kit with ages, IndexedDB drafts with idempotent sync, offline banner. |
| **AI layer** (Groq + Gemini) | ✅ Central service, quotas, refunds, cache, cost log, kill switches, labelled fallbacks. ⚠️ Live calls **not verified** (no keys in this environment); adapters tested with mocked HTTP. |
| **SaaS plans and entitlements** | ✅ Four plans, Super Admin editing with `validatePlan()` guard, entitlements enforced in the rules and the backend. |
| **Payments** | ✅ Sandbox checkout verified end to end. ⚠️ PayMongo and Xendit are implemented to their docs and unit-tested (signatures, idempotency, amount and live-mode checks), but **not exercised against the providers**; that needs test keys and the checklist in [PAYMENTS.md](PAYMENTS.md). |
| **Dashboards** | ✅ Citizen, LGU (staff and admin), Business, Enterprise, Super Admin; real and demo revenue kept separate. |
| **Security** | ✅ Claims-based RBAC, tenant isolation, rate limits, validation, image checks, audit log. See [SECURITY.md](SECURITY.md). |
| **Demo mode** | ✅ Nine demo accounts, labelled seed data, demo tools, sandbox transactions. |

## Needs credentials, an account, or outside approval

| Item | What is needed | Current state |
|---|---|---|
| **Original Firebase database** | Access by the original owner | Firebase returned 403 for this account. **No records were recovered or invented.** If the owner can still open the project, run `npm run export-firestore` and `npm run import-firestore` ([DATA_MODEL.md](DATA_MODEL.md)). |
| **New Firebase project** | The owner creates it ([SETUP.md](SETUP.md), steps 1–12) | Not created; this needs the owner's Google account. Everything was verified on the Emulator Suite. |
| **Hosting** (Netlify or Vercel) | An account and environment variables | Not deployed. The same router runs in the dev and preview servers, where it is tested; the Netlify and Vercel wrappers are thin adapters, not exercised on those platforms. |
| **Groq / Gemini** | API keys | Fallbacks verified; live models not. |
| **PayMongo / Xendit** | Test keys, then merchant verification for live payments | Unit-tested only. |
| **FCM push** | VAPID key and service account | In-app alerts verified; push not. |
| **Cloudinary** | Free account | The inline photo fallback is verified. |
| **OpenRouteService** | Free API key | The OSRM path is verified. |
| **Official data** | Real evacuation centers, capacities, gauge thresholds and hotlines from the LGU or DRRMO | **All seeded values are simulated.** |

## Known limitations

- **Routing.**
  - Public OSRM servers (FOSSGIS, with the OSRM demo server as fallback) have
    usage policies and no uptime guarantee. For production volume, use
    `ORS_API_KEY` or self-host OSRM.
  - The detour search is heuristic. It can report "no safe route" in rare
    cases where one exists, and it says so rather than guessing.
- **Map tiles** come from OpenStreetMap's public tile servers, which are not
  meant for heavy production traffic. Use a tile provider or a self-hosted
  server at scale.
- **Municipality assignment** uses approximate town centers
  (`shared/areas.ts`, nearest center). It is not official boundary data.
- **Billing.** There are no automatic recurring card charges (each period is
  a hosted checkout) and no proration on upgrades.
- **Push on iPhone** requires installing the PWA to the home screen
  (iOS 16.4 or later).
- **App Check / CAPTCHA** is not enabled yet; it is recommended before a
  public launch.
- **Bundle size.** The Firebase SDK chunk is about 555 KB minified (131 KB
  gzip). It is split out and cached by the service worker, but it is still
  the largest download.
- **Legacy `functions/` folder.** This Cloud Functions scaffold from the
  original repo is unused and not deployed, because Cloud Functions need Blaze.

## Implementation phases

| Phase | Status |
|---|---|
| 1. Foundation: analysis, architecture, data model, roles, UI | ✅ |
| 2. Navigation, reporting, evacuation | ✅ |
| 3. Gemini, Groq, fallbacks, quotas | ✅ (live AI pending keys) |
| 4. Alerts, experimental prediction, offline PWA | ✅ (push pending FCM setup) |
| 5. Plans, organizations, restrictions, payments, billing | ✅ (live providers pending keys) |
| 6. Super Admin, revenue, AI monitoring, pricing | ✅ |
| 7. E2E tests, demo accounts, scenarios, mobile, docs, verification | ✅ |
