import React, { useState } from "react";
import {
  PASSABILITY_COLORS,
  PASSABILITY_LABELS,
  VEHICLE_LABELS,
  WATER_LEVEL_BANDS,
} from "../../types";

const VEHICLE_ICONS: Record<string, string> = {
  bike: "🚲",
  motor: "🏍️",
  fourWheel: "🚗",
  suvPickup: "🚙",
  truck: "🚚",
};

export default function Legend() {
  // Collapsed by default on phones so it doesn't cover the map controls.
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 640);
  const [waterLevelOpen, setWaterLevelOpen] = useState(false);

  return (
    <div className={`legend-panel ${open ? "" : "legend-panel--collapsed"}`}>
      <button className="legend-panel__toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "Hide legend" : "Legend"}
      </button>
      {open && (
        <div className="legend-panel__body">
          <div className="legend-section">
            <button
              className="legend-section__toggle"
              onClick={() => setWaterLevelOpen((o) => !o)}
              aria-expanded={waterLevelOpen}
            >
              <h4>Water level</h4>
              <span className={`legend-section__chevron ${waterLevelOpen ? "legend-section__chevron--open" : ""}`}>
                ▾
              </span>
            </button>
            {waterLevelOpen && (
              <div className="legend-section__scroll">
                {WATER_LEVEL_BANDS.map((b) => (
                  <div className="legend-row" key={b.label}>
                    <span className="legend-swatch" style={{ background: b.color }} />
                    <span>
                      {b.laymanLabel} <span className="muted">({b.inches}in · {b.mmdaClass})</span>
                    </span>
                  </div>
                ))}
                <p className="legend-footnote">Reference: MMDA Flood Gauge</p>
              </div>
            )}
          </div>
          <div className="legend-section">
            <h4>Road passability</h4>
            {(Object.keys(PASSABILITY_LABELS) as Array<keyof typeof PASSABILITY_LABELS>).map(
              (key) => (
                <div className="legend-row" key={key}>
                  <span
                    className="legend-swatch legend-swatch--ring"
                    style={{ borderColor: PASSABILITY_COLORS[key] }}
                  />
                  <span>{PASSABILITY_LABELS[key]}</span>
                </div>
              )
            )}
          </div>
          <div className="legend-section">
            <h4>Vehicles</h4>
            <div className="legend-row legend-row--wrap">
              {Object.entries(VEHICLE_LABELS).map(([key, label]) => (
                <span className="legend-chip" key={key}>
                  {VEHICLE_ICONS[key]} {label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}