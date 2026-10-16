/**
 * Community-report heuristics (pure). These only *flag* reports for DRRM
 * moderators — nothing here auto-verifies or auto-rejects a report.
 */
import { haversineM, toPt } from "./geo";
import type { DepthLabel, LatLng, ReportStatus, SeveritySuggestion } from "./types";
import { DEPTH_LABEL_METERS } from "./types";

export const DUPLICATE_RADIUS_M = 200;
export const DUPLICATE_WINDOW_MIN = 180;
export const DUPLICATE_MIN_SCORE = 0.35;

const DEPTH_ORDER: DepthLabel[] = ["none", "ankle", "gutter", "half_knee", "knee", "waist", "chest_or_higher"];

export function depthRank(d: DepthLabel): number | null {
  const i = DEPTH_ORDER.indexOf(d);
  return i < 0 ? null : i;
}

export interface RecentReport {
  id: string;
  location: LatLng;
  createdAtMs: number;
  depthLabel: DepthLabel;
  status: ReportStatus;
}

export interface DuplicateCandidate {
  id: string;
  score: number;
  distanceM: number;
  minutesApart: number;
}

/**
 * Nearby reports from roughly the same time and depth. Score blends
 * proximity (60%), time (30%) and depth agreement (10%).
 */
export function findDuplicateCandidates(
  report: { location: LatLng; observedAtMs: number; depthLabel: DepthLabel },
  recent: RecentReport[],
  max = 3
): DuplicateCandidate[] {
  const p = toPt(report.location);
  const out: DuplicateCandidate[] = [];
  for (const r of recent) {
    if (r.status === "rejected") continue;
    const distanceM = haversineM(p, toPt(r.location));
    const minutesApart = Math.abs(report.observedAtMs - r.createdAtMs) / 60_000;
    if (distanceM > DUPLICATE_RADIUS_M || minutesApart > DUPLICATE_WINDOW_MIN) continue;
    const a = depthRank(report.depthLabel);
    const b = depthRank(r.depthLabel);
    const depthAgree = a == null || b == null ? 0.5 : Math.abs(a - b) <= 1 ? 1 : 0;
    const score = (1 - distanceM / DUPLICATE_RADIUS_M) * 0.6 + (1 - minutesApart / DUPLICATE_WINDOW_MIN) * 0.3 + depthAgree * 0.1;
    if (score >= DUPLICATE_MIN_SCORE) out.push({ id: r.id, score: Math.round(score * 100) / 100, distanceM: Math.round(distanceM), minutesApart: Math.round(minutesApart) });
  }
  return out.sort((x, y) => y.score - x.score).slice(0, max);
}

export interface AiSignals {
  imageAnalyzed: boolean;
  floodVisible: boolean | null;
  depthEstimate: DepthLabel;
  imageQuality?: "good" | "poor" | "not_a_flood_photo" | "unknown";
  confidence: number;
}

export const SUSPICIOUS_FLAG_LABELS: Record<string, string> = {
  description_too_short: "Very short description",
  observed_time_old: "Observation is more than 12 hours old",
  high_submission_rate: "Reporter submitted many reports in the last hour",
  guest_reporter: "Submitted from a guest (unregistered) session",
  low_location_accuracy: "Low GPS accuracy (over 500 m)",
  ai_no_flood_visible: "AI did not see flooding in the photo",
  ai_depth_mismatch: "AI depth estimate differs from the reported depth",
  ai_not_flood_photo: "AI thinks the photo may not show a flood scene",
};

export function suspiciousFlags(input: {
  description: string;
  observedAtMs: number;
  nowMs: number;
  reportsLastHour: number;
  isGuest: boolean;
  locationAccuracyM: number | null;
  depthLabel: DepthLabel;
  ai: AiSignals | null;
}): string[] {
  const flags: string[] = [];
  if (input.description.trim().length < 12) flags.push("description_too_short");
  if (input.nowMs - input.observedAtMs > 12 * 3600_000) flags.push("observed_time_old");
  if (input.reportsLastHour >= 5) flags.push("high_submission_rate");
  if (input.isGuest) flags.push("guest_reporter");
  if (input.locationAccuracyM != null && input.locationAccuracyM > 500) flags.push("low_location_accuracy");
  const ai = input.ai;
  if (ai?.imageAnalyzed) {
    if (ai.imageQuality === "not_a_flood_photo" && ai.confidence >= 0.5) flags.push("ai_not_flood_photo");
    else if (ai.floodVisible === false && ai.confidence >= 0.6) flags.push("ai_no_flood_visible");
    const a = depthRank(input.depthLabel);
    const b = depthRank(ai.depthEstimate);
    if (a != null && b != null && Math.abs(a - b) >= 2 && ai.confidence >= 0.5) flags.push("ai_depth_mismatch");
  }
  return flags;
}

/** Severity suggestion from a depth label (MMDA-gauge aligned). */
export function severityFromDepth(d: DepthLabel): SeveritySuggestion {
  switch (d) {
    case "none":
      return "none";
    case "ankle":
    case "gutter":
      return "low";
    case "half_knee":
      return "moderate";
    case "knee":
      return "high";
    case "waist":
    case "chest_or_higher":
      return "severe";
    default:
      return "unknown";
  }
}

export function depthMeters(d: DepthLabel): number | null {
  return DEPTH_LABEL_METERS[d];
}

export const DEPTH_LABELS: DepthLabel[] = ["ankle", "gutter", "half_knee", "knee", "waist", "chest_or_higher", "unknown"];
