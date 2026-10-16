import React from "react";
import {
  FloodZone,
  MMDA_CLASS_LABELS,
  PASSABILITY_COLORS,
  PASSABILITY_LABELS,
  VEHICLE_LABELS,
  VehicleKey,
} from "../../types";
import { formatWaterLevel, getHeroAccent, getWaterLevelBand } from "../../utils/passability";
import { Freshness } from "../ui";

interface Props {
  zone: FloodZone | null;
  onClose: () => void;
}

const VEHICLE_ICONS: Record<VehicleKey, string> = {
  bike: "🚲",
  motor: "🏍️",
  fourWheel: "🚗",
  suvPickup: "🚙",
  truck: "🚚",
};

function trendLabel(zone: FloodZone) {
  const sign = zone.trendDeltaM > 0 ? "+" : "";
  const arrow = zone.trend === "rising" ? "↑" : zone.trend === "falling" ? "↓" : "→";
  return `${arrow} ${sign}${zone.trendDeltaM.toFixed(2)}m / hr`;
}

/** Photo hero — background flood photo tinted by severity, with the zone
 *  name/area and level reading overlaid. Replaces the plain vertical tube
 *  gauge and folds the old white header bar into the image so there's no
 *  blank space above the photo. */
function FloodHero({
  waterLevelM,
  name,
  area,
  onClose,
}: {
  waterLevelM: number;
  name: string;
  area: string;
  onClose: () => void;
}) {
  const band = getWaterLevelBand(waterLevelM);
  const accent = getHeroAccent(band);
  return (
    <div className="flood-hero" style={{ backgroundImage: "url(/img/bg-for-area.png)" }}>
      <div className="flood-hero__tint" style={{ background: accent.tint }} />

      <div className="flood-hero__header">
        <div>
          <h3 className="flood-hero__title">{name}</h3>
          <span className="flood-hero__area">{area}</span>
        </div>
        <button className="flood-hero__close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="flood-hero__content" style={{ color: accent.text }}>
        <div className="flood-hero__value">{waterLevelM.toFixed(2)}m</div>
        <div className="flood-hero__label">
          <span aria-hidden="true">〜</span> {band.laymanLabel}
        </div>
      </div>
    </div>
  );
}

export default function ZoneDetailPanel({ zone, onClose }: Props) {
  if (!zone) return null;
  const band = getWaterLevelBand(zone.waterLevelM);

  return (
    <div className="zone-panel">
      <div className="zone-panel__body">
        <FloodHero
          waterLevelM={zone.waterLevelM}
          name={zone.name}
          area={zone.area}
          onClose={onClose}
        />

        <div className="zone-panel__stats">
          <div className="stat">
            <span className="stat__label">Level</span>
            <span className="stat__value">
              {formatWaterLevel(zone.waterLevelM)}
              <span className="stat__sub">{band.label}</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">MMDA classification</span>
            <span className="stat__value">
              <span className="stat__code">{band.mmdaClass}</span>
              <span className="stat__sub">{MMDA_CLASS_LABELS[band.mmdaClass]}</span>
            </span>
          </div>
          <div className="stat">
            <span className="stat__label">Trend</span>
            <span className="stat__value">{trendLabel(zone)}</span>
          </div>
          <div className="stat">
            <span className="stat__label">Road status</span>
            <span
              className="stat__badge"
              style={{ background: PASSABILITY_COLORS[zone.roadPassability] }}
            >
              {PASSABILITY_LABELS[zone.roadPassability]}
            </span>
          </div>
        </div>

        <div className="zone-panel__section">
          <h4>Vehicle passability</h4>
          <div className="vehicle-grid">
            {(Object.keys(VEHICLE_LABELS) as VehicleKey[]).map((key) => (
              <div
                key={key}
                className={`vehicle-chip ${
                  zone.passability[key] ? "vehicle-chip--ok" : "vehicle-chip--no"
                }`}
              >
                <span>{VEHICLE_ICONS[key]}</span>
                <span>{VEHICLE_LABELS[key]}</span>
                <span className="vehicle-chip__status">
                  {zone.passability[key] ? "Passable" : "Not passable"}
                </span>
                <span className="vehicle-chip__mark" aria-hidden="true">
                  {zone.passability[key] ? "✓" : "✕"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {zone.notes && (
          <div className="zone-panel__section">
            <h4>DRRM notes</h4>
            <p className="zone-panel__notes">{zone.notes}</p>
          </div>
        )}

        {zone.forecast && zone.forecast.length > 0 && (
          <div className="zone-panel__section">
            <h4>Forecast</h4>
            <ul className="forecast-list">
              {zone.forecast.map((f, i) => (
                <li key={i}>
                  {new Date(f.time).toLocaleString()} — {formatWaterLevel(f.projectedLevelM)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {zone.simulated && (
          <p className="zone-panel__sim">Simulated demonstration data — not a real flood report.</p>
        )}
        {zone.source === "community_report" && (
          <p className="zone-panel__updated">Created from a community report verified by DRRM.</p>
        )}
        <p className="zone-panel__updated">
          Updated by {zone.updatedByName ?? "DRRM"} · <Freshness at={zone.updatedAt} prefix="" />
        </p>
      </div>
    </div>
  );
}