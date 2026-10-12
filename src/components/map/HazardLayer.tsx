import React from "react";
import { Circle, Polygon, Polyline, Tooltip } from "react-leaflet";
import { FloodZone, PASSABILITY_COLORS, PASSABILITY_LABELS } from "../../types";
import type { RoadCondition } from "../../../shared/types";
import { roadPath } from "../../hooks/useOfficialData";
import { formatWaterLevel } from "../../utils/passability";
import { hazardEffect, type Hazard, type TravelMode } from "../../../shared/routing";
import { formatAge, toMillis } from "../../../shared/time";

/**
 * Lightweight static rendering of verified hazards for operational maps
 * (navigation, evacuation, dashboards). The public map keeps its animated
 * ZoneOverlay. When `mode` is given, hazards blocking that travel mode are
 * outlined heavier.
 */
export default function HazardLayer({
  zones,
  roads,
  hazards,
  mode,
}: {
  zones: FloodZone[];
  roads: RoadCondition[];
  hazards?: Hazard[];
  mode?: TravelMode;
}) {
  const blocking = new Set(
    mode && hazards ? hazards.filter((h) => hazardEffect(h, mode).effect === "blocked").map((h) => h.id) : []
  );
  return (
    <>
      {zones.map((z) => {
        const color = PASSABILITY_COLORS[z.roadPassability];
        const blocks = blocking.has(`zone:${z.id}`);
        const opts = { color, weight: blocks ? 3.5 : 2, fillColor: color, fillOpacity: blocks ? 0.4 : 0.22, dashArray: blocks ? undefined : "4 4" };
        const tip = (
          <Tooltip direction="top" opacity={1}>
            <strong>{z.name}</strong>
            {z.simulated ? " (simulated)" : ""}
            <br />
            {formatWaterLevel(z.waterLevelM)} · {PASSABILITY_LABELS[z.roadPassability]}
            {blocks ? " · blocks your route" : ""}
            <br />
            <span style={{ opacity: 0.75 }}>Updated {formatAge(toMillis(z.updatedAt))}</span>
          </Tooltip>
        );
        return z.geometry.type === "circle" ? (
          <Circle key={z.id} center={z.geometry.center} radius={z.geometry.radiusM} pathOptions={opts}>
            {tip}
          </Circle>
        ) : (
          <Polygon key={z.id} positions={z.geometry.coordinates} pathOptions={opts}>
            {tip}
          </Polygon>
        );
      })}
      {roads.map((r) => {
        const color = r.status === "closed" ? PASSABILITY_COLORS.closed : PASSABILITY_COLORS.caution;
        return (
          <Polyline
            key={r.id}
            positions={roadPath(r)}
            pathOptions={{ color, weight: 7, opacity: 0.85, dashArray: r.status === "closed" ? "2 10" : "10 8", lineCap: "round" }}
          >
            <Tooltip direction="top" opacity={1} sticky>
              <strong>{r.name}</strong>
              {r.simulated ? " (simulated)" : ""}
              <br />
              {r.status === "closed" ? "Road closed" : "Caution"} — {r.reason}
              <br />
              <span style={{ opacity: 0.75 }}>Updated {formatAge(toMillis(r.updatedAt))}</span>
            </Tooltip>
          </Polyline>
        );
      })}
    </>
  );
}
