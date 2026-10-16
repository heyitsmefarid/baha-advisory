import React, { useId, useState } from "react";
import { searchPlaces, formatCoords, type PlaceResult } from "../../services/geocodeService";
import { useSavedLocations } from "../../hooks/useUserData";
import { Spinner } from "../ui";

export interface Place {
  label: string;
  point: [number, number];
  source: "gps" | "search" | "saved" | "map" | "link";
}

const SAVED_ICON: Record<string, string> = { home: "⌂", school: "✎", work: "▣", other: "★" };

/**
 * Location field with four ways to set it: GPS, place search (Nominatim,
 * on submit only), saved places, or tapping the map.
 */
export default function PlaceInput({
  label,
  value,
  onChange,
  onPickOnMap,
  picking,
  allowGps = true,
  extraOptions = [],
}: {
  label: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  onPickOnMap: () => void;
  picking: boolean;
  allowGps?: boolean;
  extraOptions?: Place[];
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useSavedLocations();

  const runSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (text.trim().length < 3) return setError("Type at least 3 characters.");
    setBusy(true);
    setError(null);
    try {
      const r = await searchPlaces(text);
      setResults(r);
      if (r.length === 0) setError("No places found. Try a barangay or landmark name, or pick on the map.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const useGps = () => {
    if (!("geolocation" in navigator)) return setError("Location isn't available on this device.");
    setBusy(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        onChange({
          label: `My location (±${Math.round(pos.coords.accuracy)} m)`,
          point: [pos.coords.latitude, pos.coords.longitude],
          source: "gps",
        });
      },
      () => {
        setBusy(false);
        setError("Location permission was denied. Search for a place or pick it on the map.");
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    );
  };

  if (value) {
    return (
      <div className="place-field">
        <span className="field__label">{label}</span>
        <div className="place-chip">
          <span className="place-chip__text">
            {value.label}
            <span className="tiny mono">{formatCoords(value.point[0], value.point[1])}</span>
          </span>
          <button type="button" className="icon-btn" onClick={() => onChange(null)} aria-label={`Clear ${label}`}>
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="place-field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <form className="place-search" onSubmit={runSearch}>
        <input
          id={id}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search a place, barangay or landmark"
          autoComplete="off"
          enterKeyHint="search"
        />
        <button type="submit" className="btn-secondary" disabled={busy}>
          {busy ? <Spinner /> : "Search"}
        </button>
      </form>
      <div className="place-actions">
        {allowGps && (
          <button type="button" className="chip-btn" onClick={useGps}>
            ◎ My location
          </button>
        )}
        <button type="button" className={`chip-btn ${picking ? "chip-btn--solid" : ""}`} onClick={onPickOnMap} aria-pressed={picking}>
          {picking ? "Tap the map…" : "⊕ Pick on map"}
        </button>
        {saved.data.map((s) => (
          <button
            key={s.id}
            type="button"
            className="chip-btn"
            onClick={() => onChange({ label: s.name, point: [s.location.lat, s.location.lng], source: "saved" })}
          >
            {SAVED_ICON[s.label] ?? "★"} {s.name}
          </button>
        ))}
        {extraOptions.map((o) => (
          <button key={o.label} type="button" className="chip-btn" onClick={() => onChange(o)}>
            {o.label}
          </button>
        ))}
      </div>
      {error && <p className="field__error">{error}</p>}
      {results && results.length > 0 && (
        <ul className="place-results" role="listbox" aria-label={`${label} results`}>
          {results.map((r) => (
            <li key={`${r.lat},${r.lng}`}>
              <button
                type="button"
                role="option"
                aria-selected="false"
                onClick={() => {
                  onChange({ label: r.label, point: [r.lat, r.lng], source: "search" });
                  setResults(null);
                  setText("");
                }}
              >
                {r.label}
              </button>
            </li>
          ))}
          <li className="tiny place-results__attrib">Search by OpenStreetMap Nominatim</li>
        </ul>
      )}
    </div>
  );
}
