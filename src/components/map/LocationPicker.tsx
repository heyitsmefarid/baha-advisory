import React, { useState } from "react";
import { Circle, Marker } from "react-leaflet";
import BaseMap, { ClickToPick, FitBounds } from "./BaseMap";
import { pinIcon } from "./markers";
import { Callout } from "../ui";

export interface PickedLocation {
  point: [number, number];
  source: "gps" | "manual";
  accuracyM: number | null;
}

/**
 * GPS-or-map location picker. GPS needs explicit permission; the person
 * can always place the pin manually instead (and adjust a GPS fix).
 */
export default function LocationPicker({
  value,
  onChange,
  height = 260,
}: {
  value: PickedLocation | null;
  onChange: (v: PickedLocation) => void;
  height?: number;
}) {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gps = () => {
    if (!("geolocation" in navigator)) return setError("Location isn't available on this device — tap the map instead.");
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ point: [pos.coords.latitude, pos.coords.longitude], source: "gps", accuracyM: Math.round(pos.coords.accuracy) });
      },
      () => {
        setLocating(false);
        setError("Location permission was denied. Tap the map to place the pin.");
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 }
    );
  };

  return (
    <div className="location-picker">
      <div className="btn-row">
        <button type="button" className="btn-secondary" onClick={gps} disabled={locating}>
          {locating ? "Locating…" : "◎ Use my current location"}
        </button>
        <span className="tiny">or tap the map to place the pin</span>
      </div>
      {error && <Callout tone="caution">{error}</Callout>}
      <div className="location-picker__map" style={{ height }}>
        <BaseMap className="leaflet-map">
          <ClickToPick onPick={(p) => onChange({ point: p, source: "manual", accuracyM: null })} />
          {value && (
            <>
              <Marker position={value.point} icon={pinIcon("#d64545", "!")} />
              {value.accuracyM && value.accuracyM < 2000 && (
                <Circle center={value.point} radius={value.accuracyM} pathOptions={{ color: "#0e7490", weight: 1, fillOpacity: 0.1 }} />
              )}
              <FitBounds points={[value.point]} fitKey={value.point.join(",")} />
            </>
          )}
        </BaseMap>
      </div>
      {value && (
        <p className="tiny mono">
          {value.point[0].toFixed(5)}, {value.point[1].toFixed(5)} · {value.source === "gps" ? `GPS ±${value.accuracyM} m` : "placed on map"}
        </p>
      )}
    </div>
  );
}
