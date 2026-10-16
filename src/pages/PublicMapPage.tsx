import React, { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import AppShell from "../components/layout/AppShell";
import { useGeolocation } from "../hooks/useGeolocation";
import { useOfficialHazards } from "../hooks/useOfficialData";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useActiveAlerts } from "../hooks/useAlerts";
import ZoneOverlay from "../components/map/ZoneOverlay";
import AreaClusterMarker from "../components/map/AreaClusterMarker";
import LocationsSidebar from "../components/map/LocationsSidebar";
import ZoneDetailPanel from "../components/map/ZoneDetailPanel";
import Legend from "../components/map/Legend";
import RecenterButton from "../components/map/RecenterButton";
import HazardLayer from "../components/map/HazardLayer";
import { CentersLayer, ReportsLayer, StationsLayer, useStations, useVerifiedCenters, useVerifiedReports } from "../components/map/PublicLayers";
import TutorialOverlay from "../components/TutorialOverlay";
import ChatPanel from "../components/chat/ChatPanel";
import { Freshness, Readout } from "../components/ui";
import { FloodZone } from "../types";
import { DEFAULT_ZOOM, ORIENTAL_MINDORO_BOUNDS } from "../firebase";
import { OSM_ATTRIBUTION, OSM_TILES } from "../components/map/BaseMap";
import { toMillis } from "../../shared/time";

type Layer = "water" | "flooded" | "passability";
type Overlay = "roads" | "reports" | "centers" | "stations";

const OVERLAY_LABELS: Record<Overlay, string> = {
  roads: "Road closures",
  reports: "Verified reports",
  centers: "Evacuation centers",
  stations: "River gauges",
};

// Below this zoom, group zones into per-area badges instead of drawing
// every individual pin/polygon — keeps the province-wide view readable.
const CLUSTER_ZOOM_THRESHOLD = 11;

function FlyToPosition({ position }: { position: [number, number] }) {
  const map = useMap();
  React.useEffect(() => {
    map.flyTo(position, map.getZoom(), { duration: 0.8 });
  }, [position, map]);
  return null;
}

function ZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoomChange(map.getZoom()) });
  React.useEffect(() => {
    onZoomChange(map.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

function FlyToArea({ target }: { target: { center: [number, number]; nonce: number } | null }) {
  const map = useMap();
  React.useEffect(() => {
    if (target) map.flyTo(target.center, CLUSTER_ZOOM_THRESHOLD + 2, { duration: 0.8 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.nonce]);
  return null;
}

/**
 * On first load, once we know geolocation didn't give us a position to
 * center on, zoom/pan the map to fit the actual active flood zones instead
 * of leaving the visitor staring at the static province-wide default
 * center — so the pins are visible right away instead of being some
 * unrelated spot on the map. Runs once (guarded by `didFit`) so later
 * zone updates don't keep yanking the view around.
 */
function FitToZones({ zones, enabled }: { zones: FloodZone[]; enabled: boolean }) {
  const map = useMap();
  const didFit = useRef(false);

  React.useEffect(() => {
    if (didFit.current || !enabled || zones.length === 0) return;
    const points = zones.map((z) =>
      z.geometry.type === "circle" ? z.geometry.center : z.geometry.coordinates[0]
    );
    if (points.length === 0) return;
    const bounds = L.latLngBounds(points as [number, number][]);
    map.flyToBounds(bounds.pad(0.4), { maxZoom: 13, duration: 0.8 });
    didFit.current = true;
  }, [zones, enabled, map]);

  return null;
}

export default function PublicMapPage() {
  const official = useOfficialHazards();
  const zones = official.zones;
  const { loading, error } = official;
  const alerts = useActiveAlerts();
  const reports = useVerifiedReports();
  const centers = useVerifiedCenters();
  const stations = useStations();
  const { status, position, locate } = useGeolocation();
  const [selected, setSelected] = useState<FloodZone | null>(null);
  const [activeLayers] = useState<Record<Layer, boolean>>({
    water: true,
    flooded: true,
    passability: true,
  });
  const [overlays, setOverlays] = useState<Record<Overlay, boolean>>({ roads: true, reports: true, centers: true, stations: false });
  const [layersOpen, setLayersOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [hasCentered, setHasCentered] = useState(false);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [sidebarOpen, setSidebarOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 640);
  const [flyTarget, setFlyTarget] = useState<{ center: [number, number]; nonce: number } | null>(null);

  // Attempt geolocation once on first load.
  React.useEffect(() => {
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    if (!hasCentered && (status === "granted" || status === "denied" || status === "unavailable")) {
      setHasCentered(true);
    }
  }, [status, hasCentered]);

  const zonesByArea = useMemo(() => {
    const grouped: Record<string, FloodZone[]> = {};
    for (const zone of zones) {
      (grouped[zone.area] ??= []).push(zone);
    }
    return grouped;
  }, [zones]);

  const flyToArea = (area: string, center: [number, number]) => {
    setFlyTarget({ center, nonce: Date.now() });
  };

  const selectZoneFromList = (zone: FloodZone) => {
    const center =
      zone.geometry.type === "circle" ? zone.geometry.center : zone.geometry.coordinates[0];
    setFlyTarget({ center, nonce: Date.now() });
    setSelected(zone);
  };

  // Clustering disabled — zones always render as individual scattered pins,
  // even when zoomed out.
  const showClusters = false;

  // A zero from a list that is still loading, or served offline from the
  // device cache, may only mean nothing was saved — show it as unknown,
  // never as "0 flood zones".
  const online = useOnlineStatus();
  const isUnknown = (n: number, r: { loading: boolean; fromCache: boolean }) => n === 0 && (r.loading || (!online && r.fromCache));
  const count = (n: number, r: { loading: boolean; fromCache: boolean }) => (isUnknown(n, r) ? "—" : n);
  const unknownHint = (n: number, r: { loading: boolean; fromCache: boolean }) =>
    isUnknown(n, r) ? (online ? "Loading…" : "Not saved offline") : undefined;

  const situation = useMemo(() => {
    const rising = zones.filter((z) => z.trend === "rising").length;
    const closedRoads = official.roads.filter((r) => r.status === "closed").length + zones.filter((z) => z.roadPassability === "closed").length;
    const openCenters = centers.data.filter((c) => c.status === "open" || c.status === "standby").length;
    const newest = Math.max(0, ...zones.map((z) => toMillis(z.updatedAt) ?? 0), ...official.roads.map((r) => toMillis(r.updatedAt) ?? 0));
    const anySimulated = zones.some((z) => z.simulated) || official.roads.some((r) => r.simulated);
    return { rising, closedRoads, openCenters, newest: newest || null, anySimulated };
  }, [zones, official.roads, centers.data]);

  const criticalAlert = alerts.data.find((a) => a.severity === "critical" || a.severity === "high");

  return (
    <AppShell fullBleed>
      <div className="public-map-page__body">
        <div className="map-wrap">
          {error && <div className="map-error">{error}</div>}
          <MapContainer
            center={position}
            zoom={DEFAULT_ZOOM}
            minZoom={8}
            maxBounds={ORIENTAL_MINDORO_BOUNDS}
            maxBoundsViscosity={1.0}
            className="leaflet-map"
            zoomControl={false}
          >
            <TileLayer attribution={OSM_ATTRIBUTION} url={OSM_TILES} />
            {status === "granted" && <FlyToPosition position={position} />}
            <FitToZones zones={zones} enabled={hasCentered && status !== "granted"} />
            <ZoomWatcher onZoomChange={setZoom} />
            <FlyToArea target={flyTarget} />

            {overlays.roads && <HazardLayer zones={[]} roads={official.roads} />}
            {overlays.centers && <CentersLayer centers={centers.data} />}
            {overlays.reports && <ReportsLayer reports={reports.data} />}
            {overlays.stations && <StationsLayer stations={stations.data} />}

            {activeLayers.flooded &&
              (showClusters
                ? Object.entries(zonesByArea).map(([area, areaZones]) => (
                    <AreaClusterMarker key={area} area={area} zones={areaZones} onClick={flyToArea} />
                  ))
                : zones.map((zone) => (
                    <ZoneOverlay
                      key={zone.id}
                      zone={zone}
                      selected={selected?.id === zone.id}
                      onSelect={setSelected}
                      showWaterLevel={activeLayers.water}
                      showPassability={activeLayers.passability}
                    />
                  )))}
          </MapContainer>

          {/* Situation strip — live counts, gauge-style, with data freshness. */}
          <div className="situation-strip" role="status" aria-label="Current flood situation">
            <Readout
              value={count(zones.length, official)}
              label="Active flood zones"
              tone={zones.length ? "caution" : isUnknown(0, official) ? "neutral" : "safe"}
              hint={situation.rising ? `${situation.rising} rising` : unknownHint(zones.length, official)}
            />
            <Readout value={count(situation.closedRoads, official)} label="Closed roads" tone={situation.closedRoads ? "closed" : "neutral"} hint={unknownHint(situation.closedRoads, official)} />
            <Readout value={count(situation.openCenters, centers)} label="Open centers" tone="tide" hint={unknownHint(situation.openCenters, centers)} />
            <Readout value={count(alerts.data.length, alerts)} label="Active alerts" tone={alerts.data.length ? "danger" : "neutral"} hint={unknownHint(alerts.data.length, alerts)} />
            <div className="situation-strip__meta">
              {situation.newest ? <Freshness at={situation.newest} prefix="DRRM update" /> : <span className="freshness">No active updates</span>}
              {situation.anySimulated && <span className="badge badge--sim">Includes simulated data</span>}
            </div>
          </div>

          {criticalAlert && (
            <Link to="/alerts" className={`alert-ribbon alert-ribbon--${criticalAlert.severity}`}>
              <strong>{criticalAlert.title}</strong>
              <span>{criticalAlert.simulated ? "Simulated · " : ""}See alerts near you</span>
            </Link>
          )}

          <div className="map-layers">
            <button type="button" className="chip-btn map-layers__toggle" aria-expanded={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
              Layers
            </button>
            {layersOpen && (
              <div className="map-layers__panel">
                {(Object.keys(OVERLAY_LABELS) as Overlay[]).map((k) => (
                  <label key={k} className="check-row">
                    <input type="checkbox" checked={overlays[k]} onChange={() => setOverlays((o) => ({ ...o, [k]: !o[k] }))} />
                    {OVERLAY_LABELS[k]}
                  </label>
                ))}
                <Link to="/risk" className="tiny">Open the flood-risk outlook</Link>
              </div>
            )}
          </div>

          <div className="map-fabs">
            <Link to="/report" className="map-fab map-fab--report">Report flooding</Link>
            <Link to="/navigate" className="map-fab">Safe route</Link>
            <button type="button" className="map-fab" onClick={() => setChatOpen(true)}>Ask Baha AI</button>
          </div>

          {chatOpen && (
            <aside className="chat-drawer" aria-label="Baha AI assistant">
              <div className="spread chat-drawer__head">
                <strong>Ask Baha AI</strong>
                <button type="button" className="icon-btn" onClick={() => setChatOpen(false)} aria-label="Close assistant">×</button>
              </div>
              <ChatPanel compact />
            </aside>
          )}

          <RecenterButton onClick={locate} status={status} />
          <Legend />
          {loading && <div className="map-loading-chip">Loading live zones…</div>}

          <LocationsSidebar
            zonesByArea={zonesByArea}
            open={sidebarOpen}
            onToggle={() => setSidebarOpen((v) => !v)}
            onSelectArea={(area) => {
              const areaZones = zonesByArea[area];
              if (!areaZones?.length) return;
              const [latSum, lngSum] = areaZones.reduce(
                ([lat, lng], z) => {
                  const c = z.geometry.type === "circle" ? z.geometry.center : z.geometry.coordinates[0];
                  return [lat + c[0], lng + c[1]];
                },
                [0, 0]
              );
              flyToArea(area, [latSum / areaZones.length, lngSum / areaZones.length]);
            }}
            onSelectZone={selectZoneFromList}
          />
        </div>

        <ZoneDetailPanel zone={selected} onClose={() => setSelected(null)} />
        <TutorialOverlay />
      </div>
    </AppShell>
  );
}
