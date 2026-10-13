import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import { Badge, Callout, PageHeader, Spinner, useToast } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { usePlatform } from "../contexts/PlatformContext";
import { api, errorMessage } from "../lib/api";

interface Health {
  integrations: Record<string, boolean>;
}

const DEMO_DOMAIN = "demo.bahadvisory.test";

const STEPS: { title: string; who: string; where: string; link: string; show: string; real: string }[] = [
  { title: "A citizen checks the flood map", who: "No account (public)", where: "Map", link: "/", show: "Situation strip, animated DRRM zones, road closures, verified reports, evacuation centers, data freshness.", real: "Seeded zones are SIMULATED and labelled." },
  { title: "The citizen reports flooding with a photo", who: `citizen@${DEMO_DOMAIN}`, where: "Report", link: "/report", show: "GPS or map pin, MMDA depth gauge, photo (EXIF stripped), offline draft queue.", real: "Real submission through the backend." },
  { title: "Gemini analyzes the photo", who: "(automatic)", where: "Report result card", link: "/report", show: "Flood visible, depth estimate, obstruction, consistency, confidence — with the uncertainty disclaimer.", real: "Live Gemini when GEMINI_API_KEY is set; otherwise clearly marked 'Not analyzed by AI'." },
  { title: "An LGU officer verifies the report", who: `lgu.staff@${DEMO_DOMAIN}`, where: "Report verification", link: "/admin/verification", show: "AI card, duplicate & suspicious flags, jurisdiction check, 'Create a new flood zone' + 'Alert nearby residents'.", real: "Only this step can change official data." },
  { title: "The verified report updates the map & passability", who: "Any", where: "Map", link: "/", show: "New zone tagged 'created from a community report', per-vehicle passability.", real: "Live Firestore update." },
  { title: "Navigation finds an alternative route", who: "Any", where: "Navigate", link: "/navigate?from=13.4194,121.1978&fromName=Calapan%20Port&to=13.3742,121.1702&toName=Bucayao&mode=car", show: "Fastest route marked blocked, recommended detour, warnings, freshness; automatic recalculation when a verified update lands.", real: "Real OSM roads via OSRM/ORS. Use the demo tool below to place a simulated closure on the route." },
  { title: "Groq explains the route & drafts an advisory", who: `lgu.admin@${DEMO_DOMAIN}`, where: "Navigate → 'Explain simply' · Advisories & alerts → 'Draft with Baha AI'", link: "/admin/advisories", show: "Plain-language explanation from the route's facts; bilingual advisory draft from verified records.", real: "Live Groq when GROQ_API_KEY is set; otherwise a labelled template built from the same facts." },
  { title: "Nearby users receive a flood warning", who: `citizen@${DEMO_DOMAIN}`, where: "Alerts", link: "/alerts", show: "Publishing the advisory/alert matches the citizen's saved Lalud home; in-app alert + history; push where FCM is configured.", real: "In-app delivery is live; web push needs FCM credentials + VAPID key." },
  { title: "The evacuation finder picks a verified center", who: "Any", where: "Evacuate", link: "/evacuation", show: "'Find the nearest safe center' ranks open centers by safe road time; verified occupancy only; SOS with responder confirmation.", real: "Seeded centers are SIMULATED." },
  { title: "LGU Pro incident analytics", who: `lgu.admin@${DEMO_DOMAIN}`, where: "Analytics · Incidents", link: "/admin/analytics", show: "Weekly flood trend, area breakdown, verification time, AI incident summary, exports.", real: "History is SIMULATED seed data." },
  { title: "Business Pro route-disruption monitoring", who: `business.admin@${DEMO_DOMAIN}`, where: "Business fleet", link: "/business", show: "'Check all routes now' re-plans saved delivery routes and opens disruptions; planner; exports.", real: "Real routing against current (simulated) hazards." },
  { title: "Super Admin: subscriptions, revenue, AI usage", who: `super@${DEMO_DOMAIN}`, where: "Platform admin", link: "/super", show: "Real vs sandbox MRR/ARR, churn, plans editor, AI calls & estimated cost, audit log.", real: "Real revenue stays ₱0 until a live payment; sandbox shown separately." },
];

const INTEGRATIONS: { key: string; label: string; off: string }[] = [
  { key: "groq", label: "Groq (chat, advisories, explanations)", off: "Labelled template / records-only answers" },
  { key: "gemini", label: "Gemini (photo analysis)", off: "Reports accepted, marked 'not analyzed'" },
  { key: "openRouteService", label: "OpenRouteService (truck profile, native avoidance)", off: "Public OSRM + Bahadvisory detour search" },
  { key: "cloudinary", label: "Cloudinary (photo storage)", off: "Compressed inline storage" },
  { key: "paymongo", label: "PayMongo", off: "Sandbox checkout" },
  { key: "xendit", label: "Xendit", off: "Sandbox checkout" },
  { key: "fcm", label: "Firebase Cloud Messaging (push)", off: "In-app alerts only" },
];

export default function DemoGuidePage() {
  const { appRole } = useAuth();
  const platform = usePlatform();
  const toast = useToast();
  const [health, setHealth] = useState<Health | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<Health>("/health", { anonymous: true }).then(setHealth).catch(() => undefined);
  }, []);

  const canTool = platform.demoMode && ["lgu_staff", "lgu_admin", "super_admin"].includes(appRole);

  const placeFlood = async () => {
    setBusy("flood");
    try {
      const res = await api<{ area: string }>("/demo/flood-on-route", {
        body: { origin: { lat: 13.4194, lng: 121.1978 }, destination: { lat: 13.3742, lng: 121.1702 }, mode: "car", waterLevelM: 1.0 },
        timeoutMs: 60_000,
      });
      toast(`Simulated closure placed on the route (${res.area}). Open step 6 to see the detour.`, "safe");
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy("reset");
    try {
      const res = await api<{ removed: number }>("/demo/reset", { method: "POST" });
      toast(`Removed ${res.removed} demo-tool zone(s).`, "safe");
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <AppShell>
      <PageHeader title="Demo guide" subtitle="A connected, end-to-end walkthrough for judges. Everything runs on the real system; seeded records are labelled Simulated." />
      <Callout tone="neutral" title="Demo accounts">
        Sign in with any <code>*@{DEMO_DOMAIN}</code> account below. The password is the <code>DEMO_ACCOUNT_PASSWORD</code> used when the demo was seeded (never stored in code).
      </Callout>

      <div className="panel">
        <h3 className="panel__title">What's live right now</h3>
        {!health ? (
          <p className="small"><Spinner /> Checking the backend…</p>
        ) : (
          <ul className="list-plain integration-list">
            {INTEGRATIONS.map((i) => (
              <li key={i.key}>
                {health.integrations[i.key] ? <Badge tone="safe">Live</Badge> : <Badge tone="neutral">Fallback</Badge>} <strong>{i.label}</strong>
                {!health.integrations[i.key] && <span className="tiny"> — {i.off}</span>}
              </li>
            ))}
            <li>{health.integrations.emulator ? <Badge tone="sim">Emulator</Badge> : <Badge tone="safe">Firebase project</Badge>} <strong>Database</strong></li>
          </ul>
        )}
      </div>

      <ol className="demo-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="demo-step">
            <span className="demo-step__n mono">{i + 1}</span>
            <div>
              <strong>{s.title}</strong>
              <p className="small">{s.show}</p>
              <p className="tiny">
                Account: <span className="mono">{s.who}</span> · Where: {s.where} · <em>{s.real}</em>
              </p>
              <Link className="chip-btn" to={s.link}>Open</Link>
            </div>
          </li>
        ))}
      </ol>

      <div className="panel">
        <h3 className="panel__title">Scenario tools</h3>
        {canTool ? (
          <>
            <p className="small">Places a SIMULATED closed flood zone on the midpoint of the real road route from Calapan Port to Bucayao, so step 6 shows a genuine detour.</p>
            <div className="btn-row">
              <button onClick={placeFlood} disabled={busy !== null}>{busy === "flood" ? <Spinner /> : "Place simulated flood on demo route"}</button>
              {(appRole === "lgu_admin" || appRole === "super_admin") && (
                <button className="btn-secondary" onClick={reset} disabled={busy !== null}>{busy === "reset" ? <Spinner /> : "Remove demo-tool zones"}</button>
              )}
            </div>
          </>
        ) : (
          <p className="small muted">Sign in as a demo LGU officer or the Super Admin (with demo mode on) to use scenario tools.</p>
        )}
        <p className="tiny">
          Sandbox billing: sign in as <span className="mono">business.admin@{DEMO_DOMAIN}</span> → Subscription → buy a service or change plan → complete the sandbox checkout → receipt. Super Admin sees it under sandbox revenue only.
        </p>
      </div>
    </AppShell>
  );
}
