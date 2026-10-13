import React from "react";
import { Marker, Popup, Tooltip } from "react-leaflet";
import { Link } from "react-router-dom";
import { orderBy, where } from "firebase/firestore";
import { useScopedPublicData } from "../../hooks/useScopedPublicData";
import { reportIcon, shelterIcon, stationIcon } from "./markers";
import ReportPhoto from "../reports/ReportPhoto";
import { EVAC_STATUS } from "../../lib/labels";
import { toPt } from "../../../shared/geo";
import { formatAge, toMillis } from "../../../shared/time";
import { DEPTH_LABEL_TEXT, type CommunityReport, type EvacuationCenter, type WaterLevelStation } from "../../../shared/types";

const REPORT_CONSTRAINTS = [where("status", "==", "verified"), orderBy("createdAt", "desc")];
const CENTER_CONSTRAINTS = [where("verified", "==", true)];
const STATION_CONSTRAINTS = [where("active", "==", true)];

export function useVerifiedReports() {
  return useScopedPublicData<CommunityReport>({ collectionName: "community_reports", constraints: REPORT_CONSTRAINTS, hardLimit: 60, mapDoc: (id, d) => ({ id, ...(d as Omit<CommunityReport, "id">) }) });
}

export function useVerifiedCenters() {
  return useScopedPublicData<EvacuationCenter>({ collectionName: "evacuation_centers", constraints: CENTER_CONSTRAINTS, hardLimit: 300, mapDoc: (id, d) => ({ id, ...(d as Omit<EvacuationCenter, "id">) }) });
}

export function useStations() {
  return useScopedPublicData<WaterLevelStation>({ collectionName: "water_level_stations", constraints: STATION_CONSTRAINTS, hardLimit: 200, mapDoc: (id, d) => ({ id, ...(d as Omit<WaterLevelStation, "id">) }) });
}

export function stationLevelColor(s: WaterLevelStation): { color: string; label: string } {
  const lvl = s.lastLevelM;
  if (lvl == null) return { color: "#7d90a6", label: "No reading" };
  if (lvl >= s.thresholds.criticalM) return { color: "#7a1f2b", label: "Critical" };
  if (lvl >= s.thresholds.alarmM) return { color: "#d64545", label: "Alarm" };
  if (lvl >= s.thresholds.alertM) return { color: "#e08a1e", label: "Alert" };
  return { color: "#1f9d55", label: "Normal" };
}

export function ReportsLayer({ reports }: { reports: CommunityReport[] }) {
  return (
    <>
      {reports.map((r) => (
        <Marker key={r.id} position={toPt(r.location)} icon={reportIcon()}>
          <Popup maxWidth={260}>
            <div className="map-popup">
              <ReportPhoto reportId={r.id} photoUrl={r.photoUrl} storage={r.photoStorage} alt="Verified flood photo" className="map-popup__photo" />
              <strong>Verified community report{r.simulated ? " (simulated)" : ""}</strong>
              <p>{r.description}</p>
              <span className="tiny">
                {DEPTH_LABEL_TEXT[r.depthLabel]} · verified {formatAge(toMillis(r.verifiedAt))}
              </span>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

export function CentersLayer({ centers }: { centers: EvacuationCenter[] }) {
  return (
    <>
      {centers.map((c) => (
        <Marker key={c.id} position={toPt(c.location)} icon={shelterIcon(EVAC_STATUS[c.status].color)}>
          <Popup maxWidth={260}>
            <div className="map-popup">
              <strong>{c.name}</strong>
              {c.simulated && <span className="tiny"> (simulated)</span>}
              <p>
                {EVAC_STATUS[c.status].label}
                {c.occupancyVerified && c.capacity != null && c.occupancy != null ? ` · ${c.occupancy}/${c.capacity} (verified)` : ""}
              </p>
              <Link to={`/navigate?to=${c.location.lat},${c.location.lng}&toName=${encodeURIComponent(c.name)}&mode=walk`}>Directions</Link>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}

export function StationsLayer({ stations }: { stations: WaterLevelStation[] }) {
  return (
    <>
      {stations.map((s) => {
        const st = stationLevelColor(s);
        return (
          <Marker key={s.id} position={toPt(s.location)} icon={stationIcon(st.color)}>
            <Tooltip direction="top" offset={[0, -24]}>
              <strong>{s.name}</strong>
              <br />
              {s.lastLevelM != null ? `${s.lastLevelM.toFixed(2)} m — ${st.label}` : "No reading"} · {formatAge(toMillis(s.lastReadingAt))}
              {s.source === "simulated" ? " · simulated" : ""}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}
