# Security

## Identity and roles

- **Firebase Authentication** handles email/password accounts, password
  reset and anonymous guest sessions. **No passwords are stored in
  Firestore.** `npm run create-account` never chooses a password; it prints
  a password-setup link. The legacy `createDrrmAccount.js` sets a random
  temporary password, prints it once and never stores it.
- **Roles live in custom claims** (`role`, `orgId`, `assignedArea`, `areas`).
  Only the backend (Admin SDK) or a local admin script can set them. The
  client cannot set its own claims, and `users/{uid}.role` is only a mirror
  that the rules force to equal the claim.
- **Changing claims.** Demoting or removing a member revokes their refresh
  tokens, so the old privileges end immediately. Granting does not revoke,
  so users are not signed out. The backend verifies tokens with revocation
  checks, which also rejects disabled accounts.

| Role | Can |
|---|---|
| `citizen` (or no claim) | Use every public-safety feature; save places and contacts; report; SOS |
| `lgu_staff` | Verify reports, manage zones, roads, stations and centers, draft advisories, acknowledge SOS — **only in assigned areas** |
| `lgu_admin` | Everything `lgu_staff` can, for the org's areas, plus staff, billing and publishing |
| `business_staff` | Fleet routes and disruptions (while the org is entitled) |
| `business_admin` | Everything `business_staff` can, plus staff and billing |
| `enterprise_admin` | Branches, API keys, staff, billing |
| `super_admin` | Platform plans, settings, organizations, roles, revenue |

Legacy roles from the original app still work: `drrm_editor` maps to
`lgu_staff`, and `admin` maps to a province-wide `lgu_admin`.

**Nobody can self-assign a privileged role or a paid entitlement.**
- Registration always creates a citizen.
- A business org can be self-created, but only on the free plan, and the
  claims are set by the server.
- LGU and Enterprise orgs need Super Admin approval.
- Entitlements change only after a verified payment, or a manual payment
  recorded by the Super Admin.

## Tenant isolation

- Org-private records carry `orgId`: incidents, advisory drafts, members,
  saved routes, disruptions, subscriptions, transactions, invoices, API
  keys and audit entries.
- The rules check `request.auth.token.orgId` against the record. Paid
  features also check `organizations/{orgId}.entitlements` with one `get()`.
- Area-scoped data (zones, roads, stations, centers) checks
  `assignedArea` / `areas`, so a Naujan officer cannot edit Calapan data.
- `tests/rules/firestore.rules.test.ts` covers these cases, and
  `tests/integration/saas.test.ts` covers the backend's own checks.

## Backend checks

Every privileged action is decided on the server, never by the UI.

- **Authorization:** `requireAuth`, `requireRole`, `requireOrgAdmin`,
  `canManageArea`, plus live entitlement checks on paid endpoints.
- **Validation:** strict input validation (`shared/validation.ts`):
  - types, lengths and enums;
  - coordinates restricted to the service area;
  - unknown fields ignored.
- **Rate limits:** in memory per instance for bursts, and in Firestore for
  abuse-sensitive writes (reports, checkout, org creation, invites, fleet
  checks). The limits per endpoint are in [API.md](API.md).
- **Uploads:**
  - Images are checked by **magic bytes**, and only JPEG, PNG and WebP are
    accepted (4 MB maximum), so SVG or HTML can never be stored as an "image".
  - Uploads are signed server-side to Cloudinary; the client never sees the
    Cloudinary secret.
  - A photo is public only after its report is verified.
- **Payments:** webhook signatures are verified, events are idempotent,
  and amounts and live mode are checked ([PAYMENTS.md](PAYMENTS.md)).
- **Machine endpoints:** sensors use `x-sensor-token` and the cron job uses
  `CRON_SECRET`, both compared in constant time. API keys are stored only
  as SHA-256 hashes.
- **Audit log:** role changes, plan edits, settings, billing events,
  verifications, alerts and demo tools are all written to `audit_logs`
  (who, what, when, and the details of the change).

## Secrets

- **Only `VITE_*` values reach the browser.** These are the Firebase web
  config, which is public by design, and the VAPID public key.
- **Backend-only secrets:** the Groq, Gemini, Cloudinary, PayMongo, Xendit
  and ORS keys, the service account, `CRON_SECRET` and `SENSOR_INGEST_TOKEN`.
- **Nothing secret is committed.** `.env`, service-account files and
  emulator data are gitignored. `.env.example` has no values.
- **Demo passwords.** Demo account passwords come from
  `DEMO_ACCOUNT_PASSWORD`. They are never hard-coded, including in the tests.
- **`/api/health`** reports only *whether* each integration is configured.

## HTTP hardening

`netlify.toml` and `vercel.json` set:
- HSTS (Netlify);
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- a restrictive `Permissions-Policy`;
- CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'`.

The API allows cross-origin calls only from `ALLOWED_ORIGINS`.

## Data-integrity rules for safety information

- **Only verified records change official data.** Clients cannot write
  `community_reports`; only DRRM verification changes `floodZones` and
  `road_conditions`, and only those feed routing.
- **Simulated flags are protected.** Clients cannot create records flagged
  `simulated`, and cannot clear the flag on existing ones
  (`notSimulatedByClient` and `simulatedUnchanged` in the rules).
- **Only staff confirm SOS.** SOS acknowledgements can be written only by
  LGU staff and record who acknowledged; "responder confirmed" is never
  self-reported.
- **Evacuation capacity is shown as verified only when an LGU marked it**
  `occupancyVerified`.

## Known limitations

- **The admin scripts are powerful.** They use a service account with full
  access; run them only on a trusted machine.
- **Anonymous sessions can be recreated by clearing storage**, so per-guest
  limits are backed by per-IP limits. A determined abuser with many IPs can
  still submit spam. Moderation, duplicate and suspicious-report flags exist
  for that reason, and reports never reach the map unverified.
- **In-memory rate limits are per serverless instance.** The Firestore-backed
  limits are the authoritative ones.
- **No CAPTCHA or App Check is enabled yet.** Firebase App Check (reCAPTCHA
  Enterprise or v3) is a recommended next step before public launch.
