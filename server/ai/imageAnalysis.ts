import { parseJsonReply } from "./providers";
import { runImageTask, type AiTextResult } from "./service";
import { IMAGE_ANALYSIS_SYSTEM, imageAnalysisPrompt } from "./prompts";
import type { AiCaller } from "./quota";
import { severityFromDepth } from "../../shared/reports";
import type { DepthLabel, SeveritySuggestion } from "../../shared/types";

export const IMAGE_DISCLAIMER =
  "AI suggestion only. A photo cannot determine actual water depth, road safety or official flood status — a DRRM officer must verify this report.";

const DEPTHS: DepthLabel[] = ["none", "ankle", "gutter", "half_knee", "knee", "waist", "chest_or_higher", "unknown"];
const SEVERITIES: SeveritySuggestion[] = ["none", "low", "moderate", "high", "severe", "unknown"];

export interface FloodImageAnalysis {
  imageAnalyzed: boolean;
  floodVisible: boolean | null;
  waterLevelEstimate: DepthLabel;
  severitySuggestion: SeveritySuggestion;
  roadObstruction: { present: boolean | null; types: string[] };
  hazards: string[];
  vehiclesStranded: boolean | null;
  consistencyWithDescription: "consistent" | "inconsistent" | "unclear" | "not_checked";
  consistencyNotes: string;
  imageQuality: "good" | "poor" | "not_a_flood_photo" | "unknown";
  confidence: number;
  rationale: string;
  disclaimer: string;
}

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fb;
const boolOrNull = (v: unknown) => (typeof v === "boolean" ? v : null);
const strList = (v: unknown, max = 5) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 60)).slice(0, max) : [];

/** Validates/clamps whatever the model returned into a safe, typed shape. */
export function normalizeAnalysis(raw: Record<string, unknown> | null): FloodImageAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const obstruction = (raw.roadObstruction ?? {}) as Record<string, unknown>;
  const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence) ? Math.min(1, Math.max(0, raw.confidence)) : 0;
  return {
    imageAnalyzed: true,
    floodVisible: boolOrNull(raw.floodVisible),
    waterLevelEstimate: oneOf(raw.waterLevelEstimate, DEPTHS, "unknown"),
    severitySuggestion: oneOf(raw.severitySuggestion, SEVERITIES, "unknown"),
    roadObstruction: { present: boolOrNull(obstruction.present), types: strList(obstruction.types) },
    hazards: strList(raw.hazards),
    vehiclesStranded: boolOrNull(raw.vehiclesStranded),
    consistencyWithDescription: oneOf(raw.consistencyWithDescription, ["consistent", "inconsistent", "unclear"] as const, "unclear"),
    consistencyNotes: typeof raw.consistencyNotes === "string" ? raw.consistencyNotes.slice(0, 200) : "",
    imageQuality: oneOf(raw.imageQuality, ["good", "poor", "not_a_flood_photo", "unknown"] as const, "unknown"),
    confidence,
    rationale: typeof raw.rationale === "string" ? raw.rationale.slice(0, 300) : "",
    disclaimer: IMAGE_DISCLAIMER,
  };
}

/** Result when no AI analysis happened — says so plainly, never pretends. */
export function notAnalyzed(reason: string, reportedDepth: DepthLabel): FloodImageAnalysis {
  return {
    imageAnalyzed: false,
    floodVisible: null,
    waterLevelEstimate: "unknown",
    severitySuggestion: severityFromDepth(reportedDepth),
    roadObstruction: { present: null, types: [] },
    hazards: [],
    vehiclesStranded: null,
    consistencyWithDescription: "not_checked",
    consistencyNotes: "",
    imageQuality: "unknown",
    confidence: 0,
    rationale: `No automated photo assessment was made (${reason}). Severity shown is based on the reporter's own depth estimate.`,
    disclaimer: IMAGE_DISCLAIMER,
  };
}

export async function analyzeFloodImage(input: {
  image: { mime: string; base64: string };
  description: string;
  depthLabel: DepthLabel;
  caller: AiCaller;
}): Promise<{ analysis: FloodImageAnalysis; meta: AiTextResult }> {
  const meta = await runImageTask({
    system: IMAGE_ANALYSIS_SYSTEM,
    prompt: imageAnalysisPrompt(input.description, input.depthLabel),
    image: input.image,
    caller: input.caller,
  });
  if (meta.provider === "simulated" || !meta.text) {
    return { analysis: notAnalyzed(meta.fallbackReason ?? "AI unavailable", input.depthLabel), meta };
  }
  const parsed = normalizeAnalysis(parseJsonReply(meta.text));
  if (!parsed) return { analysis: notAnalyzed("the AI reply could not be read", input.depthLabel), meta };
  return { analysis: parsed, meta };
}
