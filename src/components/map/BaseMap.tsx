import React, { ReactNode, useEffect } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { DEFAULT_CENTER, DEFAULT_ZOOM, ORIENTAL_MINDORO_BOUNDS } from "../../firebase";

export const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Shared map container: OSM tiles, province bounds, no default zoom buttons on touch. */
export default function BaseMap({
  center = DEFAULT_CENTER,
  zoom = DEFAULT_ZOOM,
  className = "leaflet-map",
  children,
  zoomControl = true,
}: {
  center?: [number, number];
  zoom?: number;
  className?: string;
  children?: ReactNode;
  zoomControl?: boolean;
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      minZoom={8}
      maxBounds={ORIENTAL_MINDORO_BOUNDS}
      maxBoundsViscosity={0.9}
      className={className}
      zoomControl={zoomControl}
    >
      <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILES} />
      {children}
    </MapContainer>
  );
}

/** Calls onPick with the clicked location. */
export function ClickToPick({ onPick, enabled = true }: { onPick: (p: [number, number]) => void; enabled?: boolean }) {
  useMapEvents({
    click(e) {
      if (enabled) onPick([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

/** Fits the map to a set of points whenever `fitKey` changes. */
export function FitBounds({ points, fitKey, maxZoom = 16 }: { points: [number, number][]; fitKey: string; maxZoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.flyTo(points[0], Math.max(map.getZoom(), 14), { duration: 0.6 });
      return;
    }
    map.flyToBounds(L.latLngBounds(points).pad(0.15), { maxZoom, duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);
  return null;
}

/** Leaflet needs a nudge when its container changes size (panels, sheets). */
export function InvalidateOnResize({ watch }: { watch: unknown }) {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 220);
    return () => clearTimeout(t);
  }, [watch, map]);
  return null;
}
