import { getDb } from "../lib/firebaseAdmin";
import { loadOfficialData } from "../lib/hazards";
import { getGeneralSettings } from "../lib/settings";
import { haversineM, toPt, type Pt } from "../../shared/geo";
import { formatWaterLevel } from "../../shared/passability";
import { PASSABILITY_LABELS } from "../../shared/flood";
import { formatAge, toMillis } from "../../shared/time";
import type { Advisory, EvacuationCenter, FloodRiskPrediction, PublicAlert } from "../../shared/types";

export interface GroundingContext {
  text: string;
  refs: string[];
  zones: number;
  centers: { name: string; status: string; distanceM: number | null; occupancy: string; contact: string; simulated: boolean }[];
  alerts: { title: string; severity: string; simulated: boolean }[];
  zoneLines: string[];
  hotlines: { label: string; number: string }[];
}

let centerCache: { at: number; rows: EvacuationCenter[] } | null = null;

/**
 * Builds the VERIFIED DATA block the chatbot must ground its answers in:
 * active DRRM flood zones and road conditions, public alerts, published
 * advisories, verified evacuation centers (nearest first when a location
 * is shared), the latest experimental risk levels and hotlines.
 */
export async function buildGroundingContext(location: Pt | null): Promise<GroundingContext> {
  const db = getDb();
  const now = Date.now();
  const [{ zones, roads }, alertsSnap, advSnap, riskSnap, settings] = await Promise.all([
    loadOfficialData(),
    db.collection("alerts").where("active", "==", true).orderBy("createdAt", "desc").limit(8).get(),
    db.collection("advisories").where("status", "==", "published").orderBy("publishedAt", "desc").limit(4).get(),
    db.collection("flood_risk_predictions").limit(20).get(),
    getGeneralSettings(),
  ]);
  if (!centerCache || now - centerCache.at > 60_000) {
    const snap = await db.collection("evacuation_centers").where("verified", "==", true).get();
    centerCache = { at: now, rows: snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EvacuationCenter, "id">) })) };
  }

  const refs: string[] = [];
  const lines: string[] = [`Current time: ${new Date(now).toLocaleString("en-PH", { timeZone: "Asia/Manila" })} (Philippine time).`];

  const sortedZones = [...zones]
    .map((z) => ({ z, d: location && z.geometry.type === "polygon" ? haversineM(location, z.geometry.coordinates[0]) : null }))
    .sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || b.z.waterLevelM - a.z.waterLevelM)
    .slice(0, 12);
  const zoneLines = sortedZones.map(({ z, d }) => {
    refs.push(`floodZones/${z.id}`);
    const passable = Object.entries(z.passability).filter(([, v]) => v).map(([k]) => k).join(", ") || "none";
    return `- ${z.simulated ? "[SIMULATED] " : ""}${z.name} (${z.area}): ${formatWaterLevel(z.waterLevelM)}, ${z.trend}, road ${PASSABILITY_LABELS[z.roadPassability]}; passable for: ${passable}; updated ${formatAge(toMillis(z.updatedAt), now)}${d != null ? `; ~${(d / 1000).toFixed(1)} km from user` : ""}.`;
  });
  lines.push(zoneLines.length ? `ACTIVE FLOOD ZONES (DRRM-verified):\n${zoneLines.join("\n")}` : "ACTIVE FLOOD ZONES: none currently published.");

  const roadLines = roads.filter((r) => r.status !== "open").slice(0, 8).map((r) => {
    refs.push(`road_conditions/${r.id}`);
    return `- ${r.simulated ? "[SIMULATED] " : ""}${r.name} (${r.area}): ${r.status.toUpperCase()} — ${r.reason}; updated ${formatAge(toMillis(r.updatedAt), now)}.`;
  });
  if (roadLines.length) lines.push(`ROAD CONDITIONS:\n${roadLines.join("\n")}`);

  const alerts = alertsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<PublicAlert, "id">) }))
    .filter((a) => (toMillis(a.expiresAt) ?? 0) > now);
  if (alerts.length) {
    lines.push(
      `PUBLIC ALERTS:\n${alerts.map((a) => { refs.push(`alerts/${a.id}`); return `- ${a.simulated ? "[SIMULATED] " : ""}[${a.severity}] ${a.title}: ${a.body} (${formatAge(toMillis(a.createdAt), now)})`; }).join("\n")}`
    );
  }

  const advisories = advSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Advisory, "id">) }));
  if (advisories.length) {
    lines.push(
      `OFFICIAL ADVISORIES:\n${advisories.map((a) => { refs.push(`advisories/${a.id}`); return `- ${a.simulated ? "[SIMULATED] " : ""}${a.title} (${a.areas.join(", ")}, ${formatAge(toMillis(a.publishedAt), now)}): ${a.body.slice(0, 300)}`; }).join("\n")}`
    );
  }

  const centers = centerCache.rows
    .map((c) => ({ c, d: location ? haversineM(location, toPt(c.location)) : null }))
    .sort((a, b) => (a.d ?? 0) - (b.d ?? 0))
    .slice(0, 6)
    .map(({ c, d }) => {
      refs.push(`evacuation_centers/${c.id}`);
      const occupancy =
        c.occupancyVerified && c.capacity != null && c.occupancy != null
          ? `${c.occupancy}/${c.capacity} occupants (verified ${formatAge(toMillis(c.occupancyUpdatedAt), now)})`
          : "occupancy not verified";
      return { name: c.name, status: c.status, distanceM: d, occupancy, contact: c.contact?.phone ?? "", simulated: Boolean(c.simulated) };
    });
  if (centers.length) {
    lines.push(
      `VERIFIED EVACUATION CENTERS${location ? " (nearest first)" : ""}:\n${centers
        .map((c) => `- ${c.simulated ? "[SIMULATED] " : ""}${c.name}: ${c.status.toUpperCase()}, ${c.occupancy}${c.contact ? `, contact ${c.contact}` : ""}${c.distanceM != null ? `, ~${(c.distanceM / 1000).toFixed(1)} km` : ""}.`)
        .join("\n")}`
    );
  }

  const risks = riskSnap.docs.map((d) => d.data() as FloodRiskPrediction).filter((r) => r.level === "high" || r.level === "critical");
  if (risks.length) {
    lines.push(`EXPERIMENTAL RISK OUTLOOK (not an official forecast): ${risks.map((r) => `${r.area}: ${r.level}`).join("; ")}.`);
  }
  lines.push(`HOTLINES: ${settings.emergencyHotlines.map((h) => `${h.label} ${h.number}`).join("; ")}.`);
  if (!location) lines.push("The user has not shared their location.");

  return {
    text: lines.join("\n\n"),
    refs,
    zones: zones.length,
    centers,
    alerts: alerts.map((a) => ({ title: a.title, severity: a.severity, simulated: Boolean(a.simulated) })),
    zoneLines,
    hotlines: settings.emergencyHotlines,
  };
}
