# Backend API

All endpoints live under `/api`. The route table is
[`server/routes.ts`](../server/routes.ts) and the handlers are in
[`server/handlers/`](../server/handlers/).

## Conventions

- **Auth:** send `Authorization: Bearer <Firebase ID token>`. Tokens are
  verified with revocation checks, so disabled accounts are rejected. Role,
  org and area come from the token's custom claims, never from the request body.
- **Guest auth:** endpoints marked *guest ok* accept Firebase anonymous-auth tokens.
- **Request bodies** are JSON and validated strictly (`shared/validation.ts`).
  Coordinates must be inside the Oriental Mindoro service area where noted.
- **Errors** look like `{"error": {"code": "...", "message": "...", ...}}`, with
  the matching HTTP status:

  | Status | Code |
  |---|---|
  | 400 | `validation_error`, with `issues` |
  | 401 | missing or invalid auth |
  | 403 | wrong role, wrong area or wrong org |
  | 402 | `upgrade_required` (the organization's plan does not include the feature) |
  | 429 | `rate_limited` or `ai_quota_exceeded` |

- **Rate limits** are per IP or per user, in memory and in Firestore. The
  limits are listed per endpoint below.

## Public safety (free, no login needed)

| Method & path | Auth | Body / query | Notes |
|---|---|---|---|
| `GET /api/health` | none | — | Liveness, plus which integrations are configured (booleans only, never secrets). |
| `POST /api/route` | none | `origin {lat,lng}`, `destination {lat,lng}`, `mode` (`car`, `motorcycle`, `suv`, `truck`, `bicycle`, `walk`), `language` (`en` \| `fil`) | Flood-aware route: status `safe` \| `caution` \| `no_safe_route`, alternatives, avoided hazards and their age, turn-by-turn steps. 20/min per IP. |
| `POST /api/evacuation/nearest` | none | `location`, `mode` (default `walk`) | Verified centers ranked by safe road travel time. 10/min per IP. |
| `GET /api/risk` | none | `?refresh=1` (LGU staff only) | Experimental per-municipality risk, with its factors, data completeness and a `simulatedInputs` flag. 30/min per IP. |

## Accounts

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/auth/bootstrap` | guest ok | Creates `users/{uid}` if missing. The role is copied from verified claims (or `citizen`), never from the request. |

## Community reports

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /api/reports` | guest ok | `location`, `locationSource` (`gps` \| `manual`), `locationAccuracyM?`, `description` (3–1000), `depthLabel` (`none` \| `ankle` \| `gutter` \| `half_knee` \| `knee` \| `waist` \| `chest_or_higher` \| `unknown`), `roadName?`, `roadBlocked?`, `observedAtMs?`, `image?` (data URL; JPEG/PNG/WebP up to 4 MB, checked by magic bytes), `clientDraftId?` | Returns the report, the AI analysis or `not analyzed`, and duplicate candidates. Resending the same `clientDraftId` returns the original report (`idempotent: true`). Limits: 20/h per IP; 10/h per account (3/h for guests). |
| `POST /api/reports/:id/verify` | LGU staff for the report's area | `action` (`verify` \| `reject` \| `mark_duplicate` \| `request_info`), `note?`, `duplicateOf?`, `apply {mode: create_zone \| update_zone \| none, ...}`, `sendAlert?`, `alertRadiusM?` | The only path by which a community report can change the official map. It writes a verification entry and the audit log, and invalidates the routing hazard cache. |

## AI (keys stay on the server; quotas enforced here)

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /api/ai/chat` | guest ok | `message` (1–1500), `language` (`auto` \| `en` \| `fil`), `location?` | Baha AI chatbot, grounded on verified records. Counts against the chat quota. |
| `POST /api/ai/advisory-draft` | LGU staff | `areas[]`, `severity`, `notes?` | Draft advisory built from verified zones and roads. A human must review and publish it. |
| `POST /api/ai/incident-summary` | LGU staff | `incidentId` | Summary of the incident timeline. |
| `POST /api/ai/explain-route` | optional | The deterministic route result (`status`, `mode`, `distanceM`, `durationS`, `deterministic` text, …) | Plain-language rewrite only. 10/h per user or IP. |
| `GET /api/ai/usage` | guest ok | — | The caller's remaining quota for the current day or month. |

Every AI response includes `provider` and `model`. When `provider` is
`"simulated"`, the text came from a deterministic template, and the UI labels it.

## Alerts and advisories (always free)

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /api/advisories/:id/publish` | LGU staff | `sendAlert` (default true), `alertRadiusM` (500–50,000) | Publishes the draft and sends the matching public alert. |
| `POST /api/alerts` | LGU staff | `center`, `area?`, `type`, `severity`, `title`, `body`, `radiusM?`, `expiresInHours?` | Sends an alert to users with saved places in range: in-app notification, plus push when FCM is set up. |
| `POST /api/alerts/:id/deactivate` | LGU staff | — | Ends an alert early. |

## Sensors

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /api/ingest/water-level` | header `x-sensor-token: <SENSOR_INGEST_TOKEN>` | `stationId`, `levelM` (0–30), `recordedAtMs?` | Updates the station's reading. **Never publishes alerts on its own**; DRRM staff decide. 120/min per IP. |

## Billing

| Method & path | Auth | Body | Notes |
|---|---|---|---|
| `POST /api/billing/checkout` | org admin | `orgId`, `planId`, `billingCycle` (`monthly` \| `annual`), or `feeId` for a one-time fee | Creates a transaction and returns `checkoutUrl`. That is the provider's hosted page, or `/checkout/demo/:txId` in sandbox mode. 10/h per user. |
| `POST /api/billing/webhook/:provider` | provider signature | Raw provider payload | `paymongo` (`Paymongo-Signature`) or `xendit` (`x-callback-token`). Idempotent. 120/min per IP. |
| `POST /api/billing/demo/:txId/complete` | org admin | `outcome` (`paid` \| `failed`) | **Sandbox transactions only** (`isDemo`). Simulates the provider's callback. |
| `POST /api/billing/change-plan` | org admin | `orgId`, `planId`, `billingCycle` | An upgrade starts a checkout now; a downgrade is scheduled for the end of the period. |
| `POST /api/billing/cancel` | org admin | `orgId`, `cancel` (true to cancel at period end, false to undo) | Paid features stay on until the period ends. |
| `GET\|POST /api/cron/daily` | `x-cron-secret` or `Authorization: Bearer <CRON_SECRET>` | — | Applies expiries and downgrades, sends renewal reminders (7, 3 and 1 days before), and rolls up revenue. |

## Organizations

| Method & path | Auth | Notes |
|---|---|---|
| `POST /api/orgs` | registered user | `type` `business` is created immediately on the free plan, and the caller becomes `business_admin`. `lgu` and `enterprise` create an application for the Super Admin to approve. 5/day. |
| `PATCH /api/orgs/:orgId` | org admin | `name`, `contactEmail`, `contactPhone`. |
| `POST /api/orgs/:orgId/members` | org admin | `email`, `name`, `role`, `assignedArea?`, `areas[]`. Creates or links the account, sets claims, and returns a password-setup link. Roles are limited to the org's type. 30/h. |
| `PATCH /api/orgs/:orgId/members/:uid` | org admin | Change role or areas. Demotion revokes existing sessions. |
| `DELETE /api/orgs/:orgId/members/:uid` | org admin | Removes the member, clears their claims and revokes sessions. |
| `GET\|POST /api/orgs/:orgId/branches` | org admin | Branches need the `multiBranch` entitlement (Enterprise). |
| `POST /api/orgs/:orgId/api-keys` | org admin | Needs `apiAccess`. The key is shown **once**; only its SHA-256 hash is stored. |
| `DELETE /api/orgs/:orgId/api-keys/:keyId` | org admin | Revokes the key. |
| `POST /api/fleet/check` | org member with `fleetMonitoring` | `orgId`, `routeId?`. Re-plans saved routes against current hazards and records disruptions. 20/h per org. |

## Data API v1 (Business add-on / Enterprise)

`x-api-key: <key>`. The org's `apiAccess` entitlement is checked on every
call, so a lapsed subscription stops access immediately. Limit: 120 requests
per minute per key.

| Path | Returns |
|---|---|
| `GET /api/v1/flood-zones` | Active DRRM-verified zones and road conditions |
| `GET /api/v1/alerts` | Active public alerts |
| `GET /api/v1/risk` | Latest experimental risk outlook (labelled experimental) |
| `GET /api/v1/evacuation-centers` | Verified centers |

The same information is free in the app. The API sells integration
convenience, not access to safety data.

## Platform Super Admin

All of these require `role: super_admin`, and every change is audit-logged.

| Method & path | Purpose |
|---|---|
| `GET /api/admin/metrics?days=30` | MRR, ARR, churn and active subscriptions, **real and demo kept separate**; AI usage and estimated cost |
| `POST /api/admin/plans/:id` | Create or edit a plan. `validatePlan()` refuses edits that would gate public-safety features. |
| `POST /api/admin/settings` | `general`: demo mode, AI, chatbot, image analysis and public reporting switches, maintenance message, emergency hotlines (911 must stay). `ai`: per-user rate, cache TTL, model pricing for cost estimates. `features`: feature flags. |
| `POST /api/admin/orgs/:orgId/manual-subscription` | Record an offline or contract payment (`provider: "manual"`) |
| `POST /api/admin/orgs/:orgId/settings` | Suspend or reactivate an org; grant add-ons |
| `POST /api/admin/orgs/:orgId/recompute` | Recompute entitlements |
| `POST /api/admin/applications/:id/decide` | Approve or reject an LGU or Enterprise application |
| `POST /api/admin/users/:uid/role` | Set any user's role, org and areas |
| `POST /api/admin/revenue/recompute` | Rebuild `revenue_records` |

## Demo tools

These work only while `platform_settings/general.demoMode` is on.

| Method & path | Auth | Purpose |
|---|---|---|
| `POST /api/demo/flood-on-route` | LGU staff | Places a **simulated** closed flood zone in the middle of the current fastest route, to demonstrate rerouting on real roads. Flagged `simulated` and `demoScenario`. |
| `POST /api/demo/reset` | LGU admin | Deletes zones created by the demo tool (and nothing else). |
