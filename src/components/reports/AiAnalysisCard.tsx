import React from "react";
import { Badge } from "../ui";
import { DEPTH_LABEL_TEXT, type DepthLabel, type SeveritySuggestion } from "../../../shared/types";
import { SEVERITY_SUGGESTION } from "../../lib/labels";

export interface AiView {
  provider: string;
  imageAnalyzed: boolean;
  floodVisible: boolean | null;
  depthEstimate: DepthLabel;
  severitySuggestion: SeveritySuggestion;
  roadObstruction: boolean | null;
  consistency: string;
  confidence: number;
  hazards?: string[];
  rationale?: string;
  consistencyNotes?: string;
}

export const AI_DISCLAIMER =
  "AI suggestion only. A photo cannot determine actual water depth, road safety or official flood status — DRRM verification decides.";

/** Gemini photo assessment, always shown with its uncertainty and disclaimer. */
export default function AiAnalysisCard({ ai, compact = false }: { ai: AiView; compact?: boolean }) {
  const sev = SEVERITY_SUGGESTION[ai.severitySuggestion] ?? SEVERITY_SUGGESTION.unknown;
  if (!ai.imageAnalyzed) {
    return (
      <div className="ai-card ai-card--none">
        <div className="ai-card__head">
          <Badge tone="neutral">{ai.provider === "simulated" || !ai.provider ? "Not analyzed by AI" : "AI analysis unavailable"}</Badge>
          <span className="tiny">Severity from reporter's estimate: {sev.label}</span>
        </div>
        {!compact && ai.rationale && <p className="tiny">{ai.rationale}</p>}
      </div>
    );
  }
  const pct = Math.round(ai.confidence * 100);
  return (
    <div className="ai-card">
      <div className="ai-card__head">
        <Badge tone="tide">Gemini photo analysis</Badge>
        <Badge tone={sev.tone}>Suggested severity: {sev.label}</Badge>
        <span className={`ai-confidence ${pct < 50 ? "ai-confidence--low" : ""}`} title="Model-reported confidence; not a validated accuracy figure">
          confidence {pct}%
        </span>
      </div>
      <dl className="ai-card__facts">
        <div>
          <dt>Flood visible</dt>
          <dd>{ai.floodVisible == null ? "Unclear" : ai.floodVisible ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Depth (estimate)</dt>
          <dd>{DEPTH_LABEL_TEXT[ai.depthEstimate] ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Road obstruction</dt>
          <dd>{ai.roadObstruction == null ? "Unclear" : ai.roadObstruction ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt>Matches description</dt>
          <dd>{ai.consistency.replace("_", " ")}</dd>
        </div>
      </dl>
      {!compact && ai.hazards && ai.hazards.length > 0 && <p className="small">Visible hazards: {ai.hazards.join(", ")}</p>}
      {!compact && ai.rationale && <p className="small ai-card__why">{ai.rationale}</p>}
      {!compact && ai.consistencyNotes && <p className="tiny">{ai.consistencyNotes}</p>}
      <p className="tiny ai-card__disclaimer">{AI_DISCLAIMER}</p>
    </div>
  );
}
