# Project status

Last updated: 2026-10-12. This page records what was built, how it was
verified, and **what is not yet verified or needs credentials, data or
approval from outside the project.**

## Verification results

| Check | Result |
|---|---|
| `npm run typecheck` (app + server/scripts/tests) | PASS, no errors |
| `npm test` | PASS, 14 files / 104 tests |
| `npm run build` | PASS, 250 modules; only the existing Firebase chunk-size warning |
| PSGC generated-file check | PASS: 2 provinces, 26 LGUs, 590 barangays |
| Boundary generated-file check | PASS: status `unavailable`, 0 features (intentional) |
| `git diff --check` and secret-pattern scan | PASS |
| `npm run test:emulator` | NOT RUN on this workstation: Java is absent, so Firebase Emulator Suite cannot start |
| `npm run test:e2e`, `test:e2e:geography`, `test:e2e:offline` | AUTHORED, NOT COMPLETED here: seeded Auth/Firestore depends on that emulator. Geographic controls were exercised up to the unavailable emulator-backed overview call. |

The last two rows are open verification work, not passes. Run them on a
Java-enabled CI runner or workstation before production release.

## Geographic source status

- Identity/hierarchy: PSA PSGC 2Q 2026, retrieved 2026-10-10, workbook SHA-256
  `31892bc2bdde3ea0682562d9412b5bab4d45a0be5e5a5b4f6c9d7714b94bca5d`.
- Boundaries: unavailable; zero polygon features are shipped.
- Operational feeds: Calapan is a labelled simulated hackathon pilot. Other
  LGUs are technically supported and default to `no_verified_feed`. No
  real-time island-wide operational coverage is claimed.

## Feature status

| Feature | Status |
|---|---|
| **Mindoro geography** | Implemented: PSA PSGC Q2 2026 hierarchy for both provinces, 26 LGUs and 590 barangays; URL filters, auto-fit extents, scoped queries, island/provincial dashboards, grants and paid coverage. Boundaries are explicitly unavailable because no approved polygons were supplied. |
| **Original features** | ✅ Preserved: public map, advisories feed, DRRM dashboard, Manage Map, incidents, users, audit logs. Original collections and roles kept, legacy roles mapped. A latent bug was fixed: the advisories `collectionGroup('updates')` query had no matching rule. |
| **1. Flood-aware navigation** | ✅ Implemented and verified live (OSRM): vehicle-specific passability, alternatives, avoiding verified hazards, turn-by-turn steps, data freshness, recalculation, on-device fallback. ⚠️ ORS polygon avoidance needs `ORS_API_KEY` (not tested live). |
| **2. Location-based alerts** | ✅ Alerts, radius matching against saved places, in-app history; critical alerts always free. ⚠️ FCM push needs a real project, a VAPID key and the service account (**not verified**). |
| **3. AI community reporting** | ✅ Photo, GPS or manual location, depth, duplicate and suspicious flags, DRRM moderation; only verified reports change the map. ⚠️ Gemini analysis is not verified with a real key (labelled fallback verified). |
| **4. Predictive flood risk** | ✅ Experimental, rule-based (PAGASA rainfall thresholds, gauges, verified zones, history, elevation) with stated data completeness. **No accuracy claim**; there is no labelled local data to validate it. |
| **5. Evacuation finder** | ✅ Verified centers ranked by safe road time, LGU management, SOS queue, hotlines. Capacity is shown only when an LGU verified it. |
| **6. Offline PWA** | Implemented: precached shell, viewed tiles, versioned/scoped offline kit, IndexedDB drafts with idempotent sync, offline banner. Current local E2E rerun is pending a Java-enabled emulator host. |
| **AI layer** (Groq + Gemini) | ✅ Central service, quotas, refunds, cache, cost log, kill switches, labelled fallbacks. ⚠️ Live calls **not verified** (no keys in this environment); adapters tested with mocked HTTP. |
| **SaaS plans and entitlements** | ✅ Four plans, Super Admin editing with `validatePlan()` guard, entitlements enforced in the rules and the backend. |
| **Payments** | ✅ Sandbox checkout verified end to end. ⚠️ PayMongo and Xendit are implemented to their docs and unit-tested (signatures, idempotency, amount and live-mode checks), but **not exercised against the providers**; that needs test keys and the checklist in [PAYMENTS.md](PAYMENTS.md). |
| **Dashboards** | Citizen, municipal/provincial LGU, Business, Enterprise, Super Admin, plus public 26-LGU island comparison; real and demo revenue kept separate. |
| **Security** | ✅ Claims-based RBAC, tenant isolation, rate limits, validation, image checks, audit log. See [SECURITY.md](SECURITY.md). |
| **Demo mode** | Ten demo accounts including an Oriental provincial operator, labelled Calapan seed data, no-feed placeholders elsewhere, demo tools, sandbox transactions. |

## Needs credentials, an account, or outside approval

| Item | What is needed | Current state |
|---|---|---|
| **Original Firebase database** | Access by the original owner | Firebase returned 403 for this account. **No records were recovered or invented.** If the owner can still open the project, run `npm run export-firestore` and `npm run import-firestore` ([DATA_MODEL.md](DATA_MODEL.md)). |
| **New Firebase project** | The owner creates it ([SETUP.md](SETUP.md), steps 1–12) | Not created; this needs the owner's Google account. Emulator suites are authored but could not be rerun here because Java is absent. |
| **Hosting** (Netlify or Vercel) | An account and environment variables | Not deployed. The same router runs in the dev and preview servers, where it is tested; the Netlify and Vercel wrappers are thin adapters, not exercised on those platforms. |
| **Groq / Gemini** | API keys | Fallbacks verified; live models not. |
| **PayMongo / Xendit** | Test keys, then merchant verification for live payments | Unit-tested only. |
| **FCM push** | VAPID key and service account | In-app alerts verified; push not. |
| **Cloudinary** | Free account | The inline photo fallback is verified. |
| **OpenRouteService** | Free API key | The OSRM path is verified. |
| **Official data** | Real evacuation centers, capacities, gauge thresholds and hotlines from the LGU or DRRMO | **All seeded values are simulated.** |
| **Administrative polygons** | Approved government GeoJSON and reuse terms | Not supplied. Geoportal Philippines lists the candidate data as approximate and conditional-download; the build intentionally contains zero boundary features. |

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
- **Administrative boundaries are unavailable.** PSGC identifiers are
  authoritative, but catalog bounding boxes are navigation extents only.
  Automatic point assignment returns no match without approved geometry;
  users/staff must explicitly select a PSGC scope and unresolved migration rows
  remain `review_required`.
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
