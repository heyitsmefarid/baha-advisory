# Setup

There are two ways to run Bahadvisory:

- **[A. Local, no credentials](#a-local-development-no-credentials)**. This uses the
  Firebase Emulator Suite. Nothing is created in the cloud and nothing costs money.
  Start here.
- **[B. A real Firebase project](#b-a-real-firebase-project-steps-112)**. Follow steps
  1–12, all on the free Spark plan.

## Prerequisites

- **Node.js 20 or newer** (developed on Node 24).
- **Firebase CLI**: `npm i -g firebase-tools` (developed with 15.x).
- **A Java runtime (JDK).** The Firestore and Auth emulators need one; a
  recent JDK such as Java 21 works. Android Studio's bundled runtime is fine:
  point `JAVA_HOME` at its `jbr` folder.
- **Chrome or Edge**, only for the browser end-to-end tests (`npm run test:e2e`).

> **Antivirus or corporate proxies that inspect HTTPS** (for example Avast
> "Web Shield") make Node reject certificates, which breaks the Firebase CLI,
> OSRM and Open-Meteo calls. To fix it, export that product's root certificate
> as PEM and start Node with `NODE_EXTRA_CA_CERTS=/path/to/root.pem`. For Java
> or Gradle tools, import the certificate into a truststore. Do not turn off
> TLS verification.

## A. Local development (no credentials)

```bash
npm install
cp .env.example .env
```

In `.env`, set:

```ini
VITE_USE_EMULATORS=true
DEMO_ACCOUNT_PASSWORD=<choose any local password>
CRON_SECRET=<any random string>
SENSOR_INGEST_TOKEN=<any random string>
```

Then start everything:

```bash
npm run dev:emulators            # terminal 1: Auth :9099, Firestore :8080, UI :4000
npm run seed -- --emulator       # once: plans, settings and labelled demo data
npm run dev                      # terminal 2: app and API on http://localhost:5173
```

- **Data persistence:** emulator data is saved to `.emulator-data/` (gitignored) when
  you stop the emulators.
- **Demo accounts:** sign in as any account in [DEMO.md](DEMO.md#demo-accounts) with
  your `DEMO_ACCOUNT_PASSWORD`.
- **Optional integrations** stay off until you add their keys: AI, Cloudinary,
  payments and push. Every one of them has a labelled fallback, and
  `GET /api/health` shows which are active.

### Tests

```bash
npm run typecheck                # both tsconfig projects
npm test                         # unit tests (routing, AI, risk, billing, projection)
npm run test:emulator            # Firestore rules + API integration (starts its own emulators)
npm run test:e2e                 # 12-step demo in a real browser (needs dev server + seeded emulators)
npm run build && npx vite preview --port 4173
npm run test:e2e:offline         # PWA/offline checks against the production build
```

If the emulators are already running, `npm run test:emulator:attached`
reuses them. It needs `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` set. The tests use their own
project ID (`demo-bahadvisory-test`), so they never touch your dev data.

## B. A real Firebase project (steps 1–12)

Everything here works on the **Spark (free) plan**. No step needs Blaze.

### 1. Creating a new Firebase project
1. In the [Firebase console](https://console.firebase.google.com), choose
   **Add project**.
2. Name it, for example `bahadvisory-prod`. Google Analytics is optional.
3. Keep the **Spark** plan.

### 2. Registering the web application
1. Go to **Project settings → General → Your apps → Web (`</>`)**.
2. Register an app named "Bahadvisory web". Hosting is not needed.
3. Copy the config values. They go into the `VITE_FIREBASE_*` variables in step 9.

### 3. Enabling Firebase Authentication
1. Open **Build → Authentication → Get started**.
2. Enable **Email/Password**.
3. Enable **Anonymous**. Guests use it to send flood reports, chat with the
   AI and raise SOS without creating an account.

### 4. Creating the Firestore database
1. Open **Build → Firestore Database → Create database**.
2. Choose **Production mode**; the project's rules are deployed in step 6.
3. Pick a location, for example `asia-southeast1` (Singapore) to stay close to
   the Philippines. **The location cannot be changed later.**

### 5. Configuring Firestore indexes
```bash
firebase login
firebase use --add            # select your project; alias it "default"
firebase deploy --only firestore:indexes
```
This deploys the composite indexes, the collection-group overrides and the
TTL policies in `firestore.indexes.json`. Index builds take a few minutes;
watch them in the console.

### 6. Deploying security rules
```bash
firebase deploy --only firestore:rules
```
Before deploying any rule change, run `npm run test:emulator` (38 rule
tests and 19 API tests).

### 7. Setting up authorized domains
In **Authentication → Settings → Authorized domains**, add the domain the app
is served from, for example `bahadvisory.netlify.app` or your custom domain.
`localhost` is already listed.

### 8. Configuring Firebase Cloud Messaging (push alerts)
1. Go to **Project settings → Cloud Messaging → Web configuration → Web Push
   certificates → Generate key pair**.
2. Put the public key in `VITE_FIREBASE_VAPID_KEY`.

The backend sends pushes through the Admin SDK (FCM HTTP v1, free) using the
service account from step 10. Push uses the app's own service worker
(`/sw.js`), so it only works in production builds. In-app alerts work
without FCM.

### 9. Connecting the React application
In `.env`, or in your host's build environment, set these, then rebuild:
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
  `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`,
  `VITE_FIREBASE_MESSAGING_SENDER_ID` and `VITE_FIREBASE_APP_ID`, from step 2;
- `VITE_USE_EMULATORS=false`.

These values are public by design; the security rules protect the data.

### 10. Configuring backend environment variables
1. Go to **Project settings → Service accounts → Generate new private key**.
2. **Never commit the downloaded file.**
3. Give it to the backend in one of two ways:
   - `FIREBASE_SERVICE_ACCOUNT`: the JSON, raw or base64; or
   - `FIREBASE_PROJECT_ID` + `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY`
     (smaller; preferred on Netlify, see [DEPLOYMENT.md](DEPLOYMENT.md)).

Then set the rest. Every variable is described in `.env.example`.

| Variable | Needed for |
|---|---|
| `APP_BASE_URL` | Checkout success and cancel redirects |
| `CRON_SECRET` | The daily billing job |
| `SENSOR_INGEST_TOKEN` | Water-level sensors (optional) |
| `GROQ_API_KEY`, `GEMINI_API_KEY` | AI ([AI.md](AI.md)) |
| `CLOUDINARY_*` | Report photos (otherwise stored inline, demo-grade) |
| `PAYMENT_PROVIDER` and the provider keys | Real payments ([PAYMENTS.md](PAYMENTS.md)) |
| `ORS_API_KEY` | Native polygon avoidance and the truck profile (optional) |

### 11. Running database initialization scripts
These are run from your machine and read the service account from `.env`.

```bash
# Plans and platform settings only (safe on a production database):
npm run seed -- --production --plans-only

# Optional, for a hackathon or demo project only: labelled demo data and demo accounts
npm run seed -- --production --demo

# First real Super Admin (prints a password-setup link; no password is chosen or stored):
npm run create-account -- --production --email you@example.com --name "Your Name" --role super_admin
```

What the seed script guarantees:
- **Idempotent:** fixed IDs, safe to re-run.
- **Plan edits survive:** plans are created only if missing, so the Super
  Admin's price changes are kept.
- **Narrow reset:** `--reset-demo` deletes only records flagged `simulated` or
  `isDemo` and `@demo.bahadvisory.test` users.
- **Labelled data:** every demo record is marked "Simulated" or "(Demo)" in the UI.

After the first Super Admin exists:
- LGU and Enterprise organizations apply from `/get-started`, and the Super
  Admin approves them at `/super/organizations`.
- Org admins invite their own staff.
- The original `node scripts/createDrrmAccount.js --name … --email … --role drrm_editor --area "…"`
  still works for legacy DRRM accounts.

### 12. Testing the complete application
1. `curl https://<your-site>/api/health`. `firebaseAdmin` should be `true`,
   and the integrations you configured should be `true`.
2. Open the site signed out. The map, navigation, evacuation finder, alerts
   and reporting should all work without an account.
3. Sign in as the Super Admin and approve a test LGU organization.
4. Sign in as an LGU staff member and verify a test report. Check that it
   appears on the map and that navigation routes around it.
5. Run a sandbox checkout (`PAYMENTS_DEMO_ENABLED=true`). Then follow the
   provider test-mode checklist in [PAYMENTS.md](PAYMENTS.md#going-live-checklist).
6. To repeat the full demo against this project, run the browser tests with
   `E2E_BASE_URL=https://<your-site> npm run test:e2e`. This needs demo data.
