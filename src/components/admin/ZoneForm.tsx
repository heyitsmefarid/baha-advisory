import React, { useEffect, useState } from "react";
import { MapContainer, TileLayer, Polygon } from "react-leaflet";
import PolygonDrawer from "./PolygonDrawer";
import {
  FloodZone,
  FloodZoneInput,
  RoadPassability,
  VehicleKey,
  VEHICLE_LABELS,
  PASSABILITY_LABELS,
  Trend,
} from "../../types";
import { suggestPassability, suggestRoadPassability } from "../../utils/passability";
import { DEFAULT_CENTER, DEFAULT_ZOOM, ORIENTAL_MINDORO_BOUNDS } from "../../firebase";
import { useGeographicScope } from "../../contexts/GeographicScopeContext";
import { legacyAreaToMunicipality, MINDORO_REGION_PSGC } from "../../../shared/geography";

interface Props {
  initial?: FloodZone | null;
  area: string;
  onSubmit: (input: FloodZoneInput) => Promise<void>;
  onCancel?: () => void;
}

const emptyGeometry: [number, number][] = [];

export default function ZoneForm({ initial, area, onSubmit, onCancel }: Props) {
  const geographic = useGeographicScope();
  const [name, setName] = useState(initial?.name ?? "");
  const [coords, setCoords] = useState<[number, number][]>(
    initial?.geometry.type === "polygon" ? initial.geometry.coordinates : emptyGeometry
  );
  const [waterLevelM, setWaterLevelM] = useState(initial?.waterLevelM ?? 0.3);
  const [trend, setTrend] = useState<Trend>(initial?.trend ?? "steady");
  const [trendDeltaM, setTrendDeltaM] = useState(initial?.trendDeltaM ?? 0);
  const [roadPassability, setRoadPassability] = useState<RoadPassability>(
    initial?.roadPassability ?? suggestRoadPassability(0.3)
  );
  const [passability, setPassability] = useState(
    initial?.passability ?? suggestPassability(0.3)
  );
  const [passabilityTouched, setPassabilityTouched] = useState(false);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Auto-suggest passability whenever water level changes, unless the
  // editor has manually overridden a toggle (plan: "auto-suggested from
  // water level, editable").
  useEffect(() => {
    if (!passabilityTouched) {
      setPassability(suggestPassability(waterLevelM));
      setRoadPassability(suggestRoadPassability(waterLevelM));
    }
  }, [waterLevelM, passabilityTouched]);

  const toggleVehicle = (key: VehicleKey) => {
    setPassabilityTouched(true);
    setPassability((p) => ({ ...p, [key]: !p[key] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) return setFormError("Zone name is required.");
    if (coords.length < 3) return setFormError("Draw a polygon or drop a pin on the map.");
    const municipality = geographic.municipality ?? legacyAreaToMunicipality(area);
    if (!municipality?.provincePsgcCode) return setFormError("Select a supported municipality or city before publishing.");

    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        geometry: { type: "polygon", coordinates: coords },
        waterLevelM,
        trend,
        trendDeltaM,
        roadPassability,
        passability,
        notes: notes.trim(),
        status: "active",
        area,
        regionPsgcCode: MINDORO_REGION_PSGC,
        provincePsgcCode: municipality.provincePsgcCode,
        municipalityPsgcCode: municipality.psgcCode,
        barangayPsgcCode: geographic.barangay?.municipalityPsgcCode === municipality.psgcCode ? geographic.barangay.psgcCode : null,
        locationAssignment: {
          method: geographic.municipality ? "manual" : "migrated",
          confidence: geographic.barangay ? "high" : "medium",
          sourceVersion: municipality.sourceVersion,
          assignedAt: Date.now(),
          assignedBy: "lgu-form",
        },
      });
    } catch (err) {
      console.error("Zone save failed:", err);
      setFormError("Could not save this zone. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="zone-form" onSubmit={handleSubmit}>
      <div className="zone-form__map">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={DEFAULT_ZOOM}
          minZoom={8}
          maxBounds={ORIENTAL_MINDORO_BOUNDS}
          maxBoundsViscosity={1.0}
          className="leaflet-map leaflet-map--form"
        >
          <TileLayer
            attribution='&copy; OpenStreetMap contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <PolygonDrawer onDrawn={setCoords} />
          {coords.length >= 3 && <Polygon positions={coords} pathOptions={{ color: "#1c5fa8" }} />}
        </MapContainer>
        <p className="zone-form__hint">
          Use the drawing tools on the map to outline the flooded area, or drop a pin for a point location.
        </p>
      </div>

      <div className="zone-form__fields">
        <label>
          Zone name
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Marikina River — near San Mateo" />
        </label>

        <label>
          Water level (m)
          <input
            type="number"
            step={0.05}
            min={0}
            value={waterLevelM}
            onChange={(e) => setWaterLevelM(Number(e.target.value))}
          />
        </label>

        <div className="zone-form__row">
          <label>
            Trend
            <select value={trend} onChange={(e) => setTrend(e.target.value as Trend)}>
              <option value="rising">Rising</option>
              <option value="falling">Falling</option>
              <option value="steady">Steady</option>
            </select>
          </label>
          <label>
            Δ last hour (m)
            <input
              type="number"
              step={0.05}
              value={trendDeltaM}
              onChange={(e) => setTrendDeltaM(Number(e.target.value))}
            />
          </label>
        </div>

        <label>
          Road passability
          <select
            value={roadPassability}
            onChange={(e) => {
              setPassabilityTouched(true);
              setRoadPassability(e.target.value as RoadPassability);
            }}
          >
            {(Object.keys(PASSABILITY_LABELS) as RoadPassability[]).map((k) => (
              <option key={k} value={k}>
                {PASSABILITY_LABELS[k]}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="zone-form__label">Per-vehicle passability (auto-suggested, editable)</span>
          <div className="vehicle-toggle-grid">
            {(Object.keys(VEHICLE_LABELS) as VehicleKey[]).map((key) => (
              <label key={key} className="vehicle-toggle">
                <input
                  type="checkbox"
                  checked={passability[key]}
                  onChange={() => toggleVehicle(key)}
                />
                {VEHICLE_LABELS[key]}
              </label>
            ))}
          </div>
        </div>

        <label>
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Free-text observations for the public and other editors…"
          />
        </label>

        {formError && <p className="error-text">{formError}</p>}

        <div className="zone-form__actions">
          {onCancel && (
            <button type="button" className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" disabled={submitting}>
            {submitting ? "Publishing…" : initial ? "Save changes" : "Publish zone"}
          </button>
        </div>
      </div>
    </form>
  );
}
