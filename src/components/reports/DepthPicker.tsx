import React from "react";
import { DEPTH_LABEL_TEXT, type DepthLabel } from "../../../shared/types";
import { DEPTH_LABELS } from "../../../shared/reports";

const BAR: Record<DepthLabel, number> = {
  none: 0,
  ankle: 10,
  gutter: 18,
  half_knee: 24,
  knee: 40,
  waist: 62,
  chest_or_higher: 82,
  unknown: 0,
};

/**
 * Depth selector styled as the MMDA flood gauge people already know —
 * each option shows how high the water reaches.
 */
export default function DepthPicker({ value, onChange }: { value: DepthLabel; onChange: (d: DepthLabel) => void }) {
  return (
    <div className="depth-picker" role="radiogroup" aria-label="Estimated water depth">
      {DEPTH_LABELS.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          className={`depth-opt ${value === d ? "depth-opt--on" : ""} ${d === "unknown" ? "depth-opt--unknown" : ""}`}
          onClick={() => onChange(d)}
        >
          <span className="depth-opt__gauge" aria-hidden="true">
            <span className="depth-opt__water" style={{ height: `${BAR[d]}%` }} />
          </span>
          <span className="depth-opt__label">{DEPTH_LABEL_TEXT[d]}</span>
        </button>
      ))}
    </div>
  );
}
