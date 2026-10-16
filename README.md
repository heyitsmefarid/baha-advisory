# Bahadvisory

Flood safety for Oriental Mindoro: a live, DRRM-verified flood map with
flood-aware navigation, community reporting, alerts, an evacuation finder
and an offline mode. **Every public-safety feature is free, forever.**
LGUs, businesses and enterprises can subscribe for analytics, fleet
monitoring, incident management and data integrations.

Bahadvisory runs on a **₱0 infrastructure budget**:
- Firebase's free Spark plan (Auth + Firestore);
- a serverless backend on Netlify's free tier;
- free-tier AI (Groq and Gemini);
- OpenStreetMap.

## What it does

| | Feature | Free? |
|---|---|---|
| 🗺️ | **Live flood map**: DRRM-verified zones, road passability per vehicle, water-level stations, centers, alerts, each with its age | Always |
| 🧭 | **Flood-aware navigation**: real roads, routes around verified floods by vehicle type, turn-by-turn steps, AI explanation in English or Filipino | Always |
| 📸 | **Community reports**: photo, location and depth; Gemini suggests a severity; DRRM staff verify before anything reaches the map | Always |
| 🔔 | **Location alerts**: for saved home, school and work locations; in-app history plus web push | Always |
| 🏫 | **Evacuation finder**: verified centers ranked by safe road time, SOS, hotlines | Always |
| 📴 | **Offline kit**: works without signal, shows how old saved data is, sends offline reports later | Always |
| 🌧️ | **Experimental flood-risk outlook**: transparent rules based on rainfall, gauges and flood history (not a validated forecast) | Always |
| 💬 | **Baha AI assistant**: answers grounded on verified records | 10 per day free |
| 📊 | LGU Pro: analytics, incident management, staff, higher AI limits | ₱5,000 / month |
| 🚚 | Business Pro: fleet route monitoring and disruption alerts | ₱2,000 / month |
| 🏢 | Enterprise: multi-branch, data API, custom integrations | Custom |

## Quick start (local, no credentials)

```bash
npm install
cp .env.example .env    # set VITE_USE_EMULATORS=true and DEMO_ACCOUNT_PASSWORD=<anything>
npm run dev:emulators   # terminal 1 (needs a Java runtime)
npm run seed -- --emulator
npm run dev             # terminal 2 → http://localhost:5173
```

Sign in as `citizen@demo.bahadvisory.test`, `lgu.staff@…`,
`business.admin@…`, `super@…` and others (all listed in
[docs/DEMO.md](docs/DEMO.md)) with your `DEMO_ACCOUNT_PASSWORD`. **All demo
data is simulated and labelled as such.**

## Documentation

| Doc | Contents |
|---|---|
| [SETUP.md](docs/SETUP.md) | Local setup, tests, and a real Firebase project in 12 steps (Spark plan) |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Netlify (primary) or Vercel, webhooks, cron, sensors, Cloudinary, FCM, launch checklist |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the pieces fit, key flows, design principles |
| [DATA_MODEL.md](docs/DATA_MODEL.md) | Collections, ID strategy, permissions, indexes, how the original model was reconstructed |
| [API.md](docs/API.md) | Every backend endpoint |
| [AI.md](docs/AI.md) | Groq and Gemini usage, quotas, fallbacks, cost tracking, privacy |
| [PAYMENTS.md](docs/PAYMENTS.md) | Plans, checkout, webhooks, sandbox mode, going-live checklist |
| [SECURITY.md](docs/SECURITY.md) | Roles, tenant isolation, rules, backend checks, secrets |
| [DEMO.md](docs/DEMO.md) | Hackathon demo script (12 steps) and demo accounts |
| [STATUS.md](docs/STATUS.md) | **What is verified, what needs credentials, known limitations** |

## Scripts

| Command | |
|---|---|
| `npm run dev` | App and API on one port (Vite + backend middleware) |
| `npm run dev:emulators` | Firebase Auth and Firestore emulators (data kept in `.emulator-data/`) |
| `npm run build` | Type-check everything and build to `dist/` |
| `npm test` | Unit tests |
| `npm run test:emulator` | Security-rule and API integration tests on the emulators |
| `npm run test:e2e` / `test:e2e:offline` | Browser tests: the 12-step demo flow, and PWA/offline |
| `npm run seed` | Plans, settings and (optionally) labelled demo data; idempotent |
| `npm run create-account` | Create a staff or admin account with a role (prints a password-setup link) |
| `npm run export-firestore` / `import-firestore` | JSON backup and restore (import never overwrites unless `--overwrite`) |

## Creating staff accounts (stays on the free Spark plan)

The browser can never set its own Firebase Auth custom claims (`role`,
`orgId`, `assignedArea`); only the Admin SDK can. Cloud Functions would
need the Blaze plan, so Bahadvisory does this in two free ways:

1. **The backend** (a Netlify Function) handles everyday cases. Org admins
   invite staff from their dashboard, and the Super Admin manages roles at
   `/super/users`.
2. **Local scripts** run from your own machine with a service account. They
   are used to bootstrap the first Super Admin:

   ```bash
   # Service account: Firebase Console → Project settings → Service accounts →
   # Generate new private key. Put it in .env (FIREBASE_SERVICE_ACCOUNT=…) — never commit it.
   npm run create-account -- --production --email you@example.com --name "Your Name" --role super_admin
   ```

The original DRRM script still works for the legacy `drrm_editor` and
`admin` roles:

```bash
node scripts/createDrrmAccount.js --name "Full Name" --email user@example.com --role drrm_editor --area "Calapan City"
```

It reads `serviceAccountKey.json` from the project root (gitignored). It
creates the user with a random temporary password, which is printed once and
never stored. It then sets the claims, writes `users/{uid}`, and prints a
password-reset link to send to the person. `create-account` goes further: it
prints only a password-setup link and never creates a password at all.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, react-leaflet (OpenStreetMap), custom service worker |
| Data | Firebase Auth and Cloud Firestore (security rules enforce all access) |
| Backend | Web-standard request handlers in `server/`, deployed as Netlify Functions (or Vercel) |
| Routing | OSRM or OpenRouteService, with Bahadvisory's own hazard evaluation and detour search |
| AI | Groq (text) and Google Gemini (images), server-side only |
| Payments | PayMongo or Xendit, plus a sandbox mode |
| Photos | Cloudinary free tier (Firebase Storage would need Blaze) |
