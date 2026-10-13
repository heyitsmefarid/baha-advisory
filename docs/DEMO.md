# Hackathon demo

There is a 12-step connected workflow across five roles, on clearly labelled
simulated data. The same script is in the app at **`/demo`**, and it is
automated end to end by `npm run test:e2e`. Island navigation and access are
covered separately by `npm run test:e2e:geography`.

## What is real and what is simulated

| Real | Simulated |
|---|---|
| Road routing on OpenStreetMap roads (OSRM) | Every seeded flood zone, road condition, station reading, evacuation center, report, incident, advisory and alert. These are badged **Simulated** or **(Demo)**. |
| Weather and elevation inputs to the risk outlook (Open-Meteo) | The closure placed by the demo tool (`demoScenario`) |
| PSA PSGC Q2 2026 identifiers and hierarchy | Calapan operational records and every other seeded safety record |
| The verification, alert, quota and entitlement logic | All demo subscriptions and payments (`isDemo`, labelled **Sandbox**) |
| | AI output whenever Groq or Gemini keys are missing (labelled "simulated" or "template") |

**Nothing in the demo data is real flood information.** A "Demo
environment" banner is shown while demo mode is on.

Administrative boundaries are neither real nor simulated in this build: no
approved geometry is bundled, so the boundary status is **Unavailable** and
catalog bounding boxes are used only to navigate the map.

## Setup

```bash
npm run dev:emulators                 # terminal 1
npm run seed -- --emulator            # DEMO_ACCOUNT_PASSWORD must be set in .env
npm run dev                           # terminal 2 → http://localhost:5173
```

To reset between runs:
- `npm run seed -- --emulator --reset-demo` rebuilds all demo data;
- the **Remove demo-tool zones** button on `/demo` removes only the
  demo-tool closure.

For a hosted demo, seed a separate demo project with
`npm run seed -- --production --demo`. Do not use a live LGU project.

## Demo accounts

All use the password in `DEMO_ACCOUNT_PASSWORD`. All are on the
`@demo.bahadvisory.test` domain, which cannot receive email.

| Email | Role | Organization / scope |
|---|---|---|
| `citizen@demo.bahadvisory.test` | Citizen | — |
| `citizen2@demo.bahadvisory.test` | Citizen | — |
| `lgu.staff@demo.bahadvisory.test` | LGU Staff | Calapan City DRRMO, assigned to Calapan City |
| `lgu.admin@demo.bahadvisory.test` | LGU Administrator | Calapan City DRRMO (LGU Pro), Calapan City + Baco |
| `naujan.admin@demo.bahadvisory.test` | LGU Administrator | Naujan MDRRMO, **no subscription** (shows paid features locked and tenant isolation) |
| `oriental.province@demo.bahadvisory.test` | Provincial LGU Administrator | Oriental Mindoro PDRRMO; province grant and provincial comparison dashboard |
| `business.admin@demo.bahadvisory.test` | Business Administrator | Mindoro Express Logistics (Business Pro) |
| `business.staff@demo.bahadvisory.test` | Business Staff | Mindoro Express Logistics |
| `enterprise.admin@demo.bahadvisory.test` | Enterprise Administrator | Isla Group of Companies (Enterprise, with a branch) |
| `super@demo.bahadvisory.test` | Platform Super Admin | — |

## Island-wide geographic sequence

1. Open `/` signed out. Select **Occidental Mindoro > Lubang > a barangay**;
   the URL retains all three PSGC filters and the map fits the catalog extent.
2. Switch to **Oriental Mindoro > City of Calapan > a barangay**. This is the
   complete operational demo path; every flood/road/center record remains
   visibly simulated.
3. Open `/overview`: it lists 26 LGUs. Occidental rows without an integrated
   source say **No verified feed** and show an em dash, not zero.
4. Sign in as the provincial demo account and open `/admin/geography`. It can
   refresh Oriental Mindoro but receives 403 for Occidental Mindoro.
5. Sign in as Super Admin to compare both provinces and all 26 LGUs.
6. Request a mainland-Mindoro-to-Lubang road route. The result is HTTP 422
   `no_verified_road_route` with no geometry; the demo never invents a ferry.

The browser script checks the unchanged Calapan demo entry point too. It needs
seeded Auth/Firestore emulators and the same `DEMO_ACCOUNT_PASSWORD` as the
seed command.

## The 12 steps

Four browser windows make this smooth: a guest or citizen window, LGU
staff, LGU admin, and business or super admin. Private windows keep the
sessions separate.

| # | Who | Where | What to show |
|---|---|---|---|
| 1 | Citizen (or guest) | `/` | The live map: active zones, closed roads, open centers and alerts, each with its age. No login or payment is needed. |
| 2 | Citizen | `/report` | Attach a photo, tap **Use my current location**, pick a depth (for example *Knee level*), describe it, and send. |
| 3 | Citizen | the report result | The Gemini analysis card, with the disclaimer "AI suggestion only. A photo cannot determine actual water depth". Without a key it says **Not analyzed by AI**, and the reporter's own estimate is used. |
| 4 | LGU Staff | `/admin/verification` | Open the report. Duplicate and suspicious flags are visible. Choose **create zone** and **Verify**. |
| 5 | Citizen | `/` | The verified report is now on the public map. **Only verified reports change the map and routing.** |
| 6 | LGU Staff | `/demo` → `/navigate` | **Place simulated flood on demo route**, then **Find a safe route** from Calapan Port to Bucayao. The route now says "Avoids 1 verified flood…" on real roads. |
| 7 | LGU Staff | `/navigate` | **Explain simply**: Groq rewrites the computed route in plain English or Filipino. It cannot change the route. |
| 7b | LGU Admin | `/admin/advisories` | **Draft with Baha AI**. Edit, save as draft, then **Publish → Publish now**. |
| 8 | Citizen | `/alerts` | The published advisory arrives as an alert for users near it. Push works too when FCM is configured. Alerts are always free. |
| 9 | Citizen | `/evacuation` | **Find the nearest safe center**: verified centers ranked by safe road time, with the SOS panel and hotlines. |
| 10 | LGU Admin | `/admin/analytics` | LGU Pro analytics: new flood zones per week, zones by area, and community reports by outcome, each with a table view. Compare with `naujan.admin`, where these features are locked. |
| 11 | Business Admin | `/business` | **Check all routes now**: saved fleet routes re-planned against current hazards, with disruptions listed. Then `/business/billing` → **Purchase** → the sandbox checkout → **Payment confirmed**, and a receipt is issued. |
| 12 | Super Admin | `/super` | Real revenue (live payments: ₱0 in the demo) shown **separately from** sandbox revenue; MRR, ARR, churn; AI usage and estimated cost; plan editor at `/super/plans`. `/business-model` holds the revenue simulator, clearly marked hypothetical. |

## Offline (bonus)

1. Open the app online once.
2. Switch to airplane mode and reload. The app still opens and shows an
   **Offline** banner ("may be outdated — not live").
3. `/offline` shows the saved centers, alerts and hotlines with their age.
4. A report sent offline is saved on the device and sent automatically on
   reconnect.

This is automated by `npm run test:e2e:offline` against a production build.

## If something fails during the demo

| What fails | What happens |
|---|---|
| No AI keys, or an AI outage | Every AI step falls back to a labelled template or "not analyzed". The flow continues. |
| The routing server is unreachable | The browser computes the route on the device (`source: device`) using the synced hazards. |
| No internet at the venue | Use the emulator setup on a laptop. Map tiles need the internet unless you viewed them beforehand, since only viewed tiles are cached. |
