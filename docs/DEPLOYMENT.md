# Deployment

The production shape is a static SPA plus serverless functions. Netlify's
free tier is the primary target, and Vercel is a supported alternative.
Firebase stays on Spark: only Auth and Firestore are used, and rules and
indexes are deployed with the Firebase CLI ([SETUP.md](SETUP.md), steps 5–6).

## Netlify (primary)

`netlify.toml` already defines the build, the functions and the headers:

| Item | Value |
|---|---|
| Build command | `npm run build` (both type checks, then the Vite build) |
| Publish directory | `dist` |
| Functions | `netlify/functions/api.mts` handles `/api/*` (`config.path`); `netlify/functions/daily.mts` is a **scheduled function** (`@daily`) for billing maintenance |
| Headers | `sw.js` is never cached, so updates roll out; hashed assets are immutable; HSTS, `nosniff`, a referrer policy, a permissions policy, and CSP `frame-ancestors 'none'` |

Steps:
1. **Create the site.** Choose **New site → Import from Git**, pick the repo,
   and keep the detected settings.
2. **Add environment variables** under **Site configuration → Environment variables**:
   - **`VITE_*` variables** (build-time, public): give them the **Builds** scope only.
   - **Backend secrets**: give them the **Functions** scope.
   - **Size limit.** Netlify Functions run on AWS Lambda, which limits the
     total size of a function's environment variables (about 4 KB). Use the
     three-field service-account form (`FIREBASE_PROJECT_ID`,
     `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`) rather than the full JSON,
     and avoid base64.
3. **Set `APP_BASE_URL`** to the site URL.
4. **Add the domain to Firebase.** Add the Netlify domain to Firebase
   **Authorized domains**.
5. **Deploy.** Then check `https://<site>/api/health`.

## Vercel (alternative)

`vercel.json` routes `/api/*` to `api/index.ts`, which runs the same router,
and everything else to the SPA. It also defines a cron that calls
`GET /api/cron/daily` at 20:00 UTC, which is 04:00 in Manila. Vercel Cron
sends `Authorization: Bearer <CRON_SECRET>`, and the endpoint accepts that.
Set the same environment variables as for Netlify.

## Scheduled jobs

| Host | How |
|---|---|
| Netlify | `daily.mts` runs automatically. |
| Vercel | The `crons` entry in `vercel.json`. |
| Anything else | Call `POST /api/cron/daily` once a day with header `x-cron-secret: <CRON_SECRET>`. A free external cron service is enough. |

Correctness does not depend on the job. Entitlement checks compute expiry
from `currentPeriodEnd` on every request. The job sends reminders, applies
scheduled downgrades, flips statuses and rolls up revenue.

## Payment webhooks

Register these URLs in the provider dashboards:

| Provider | URL | Events |
|---|---|---|
| PayMongo | `https://<site>/api/billing/webhook/paymongo` | `checkout_session.payment.paid` (expired and failed events are also handled) |
| Xendit | `https://<site>/api/billing/webhook/xendit` | Invoice callbacks (`PAID`, `SETTLED`, `EXPIRED`, `FAILED`) |

Then put the signing secret in `PAYMONGO_WEBHOOK_SECRET`, or the callback
token in `XENDIT_CALLBACK_TOKEN`. See [PAYMENTS.md](PAYMENTS.md).

## Water-level sensors (optional)

Gauges post to `POST https://<site>/api/ingest/water-level` with header
`x-sensor-token: <SENSOR_INGEST_TOKEN>` and body
`{"stationId": "...", "levelM": 2.4, "recordedAtMs": 1760000000000}`.
Readings update stations and the risk model. They never publish public
alerts by themselves.

## Image storage (Cloudinary)

1. Create a free Cloudinary account.
2. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`.

Uploads are signed on the server and go to `CLOUDINARY_FOLDER`. Without
Cloudinary, report photos are stored compressed in `report_media/{id}`
(about 700 KB maximum). That is fine for demos, but not for production volume.

## Push notifications (FCM)

1. Set `VITE_FIREBASE_VAPID_KEY` ([SETUP.md, step 8](SETUP.md#8-configuring-firebase-cloud-messaging-push-alerts)).
2. Give the backend the service account. It sends pushes with the Admin SDK.

Pushes go to tokens stored in `users/{uid}.fcmTokens`, which the client
registers when the user enables alerts.

## Before going live

- [ ] **Geography source:** `npx tsx scripts/geography/importPsgc.ts --check`
  and `npx tsx scripts/geography/importBoundaries.ts --check` pass. Confirm the
  deployed release contains the reviewed `data/geography/sources.json` hashes.
- [ ] **Firebase:** `firebase deploy --only firestore:rules,firestore:indexes`
  against the production project.
- [ ] **No emulators:** `VITE_USE_EMULATORS=false`. The app shows a banner when
  it is pointed at emulators or demo data.
- [ ] **Demo mode decided:** either set `platform_settings/general.demoMode`
  to `false` in Super Admin → Settings, or keep it on deliberately for a
  hackathon. Demo tools only work while it is on.
- [ ] **Sandbox off:** `PAYMENTS_DEMO_ENABLED=false` in production, unless you
  intend to keep sandbox checkout.
- [ ] **Payments:** the provider test-mode checklist in [PAYMENTS.md](PAYMENTS.md) is done.
- [ ] **Hotlines:** confirm the emergency hotlines in Super Admin → Settings
  with the LGU. The seeded list keeps 911.
- [ ] **Data review:** review the seeded evacuation centers, stations and
  thresholds with the DRRM office. **Demo coordinates and capacities are not
  real.**
- [ ] **Coverage wording:** every LGU without a verified integration says
  `no_verified_feed`; do not enable operational-coverage claims from seed data.

## Geographic release order and rollback

1. Export/backup Firestore and save the current source manifest.
2. Deploy `firestore.indexes.json` and `firestore.rules` first; wait for index
   builds to become ready.
3. Run the production geography migration without `--apply`, archive its
   report, and resolve every unexpected `review_required` row.
4. Run with `--apply`, seed the authoritative `geographic_units` mirror, then
   deploy the app/API release.
5. Smoke-test `/overview`, one province, Calapan, an Occidental no-feed LGU,
   an out-of-jurisdiction mutation, and a disconnected Lubang road route.

If the release fails, redeploy the previous app/API first. The PSGC migration
is additive, so legacy display fields remain usable. Restore the pre-migration
database backup only when the data change itself must be reversed; do not
manually delete PSGC fields while newer clients or summaries are running.
