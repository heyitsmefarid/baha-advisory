import React, { useMemo } from "react";
import { collection, collectionGroup, limit, orderBy, query, Timestamp, where } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import UpgradeNotice from "../../components/billing/UpgradeNotice";
import { BarList, ColumnChart } from "../../components/charts/Charts";
import { Callout, PageHeader, Readout, SkeletonRows } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useMyOrg } from "../../hooks/useOrg";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useJurisdictionCollection } from "../../hooks/useJurisdictionCollection";
import { db } from "../../firebase";
import { downloadCsv, toCsv } from "../../lib/csv";
import { canManageArea } from "../../../shared/roles";
import { tuplesFromFirestore } from "../../../shared/geoFirestore";
import { toMillis } from "../../../shared/time";
import type { FloodZone } from "../../types";
import type { CommunityReport, PublicAlert, ZoneHistoryEntry } from "../../types";

const DAY = 86_400_000;

/**
 * Historical flood analytics. Basic (free): last 30 days of counts.
 * Advanced (LGU Pro): 90-day trends, breakdowns and CSV exports.
 */
export default function AnalyticsPage() {
  const { role, assignedArea, areas, appRole } = useAuth();
  const { entitled } = useMyOrg();
  const claims = { role, assignedArea, areas };
  const advanced = entitled("advancedAnalytics") || appRole === "super_admin" || role === "admin";
  const days = advanced ? 90 : 30;
  const since = Timestamp.fromMillis(Date.now() - days * DAY);

  const zones = useFirestoreCollection<FloodZone>(
    () => query(collection(db, "floodZones"), where("updatedAt", ">=", since)),
    (id, d) => {
      const z = { id, ...(d as Omit<FloodZone, "id">) };
      if (z.geometry?.type === "polygon") z.geometry = { ...z.geometry, coordinates: tuplesFromFirestore(z.geometry.coordinates as never) };
      return z;
    },
    [days]
  );
  const history = useFirestoreCollection<ZoneHistoryEntry>(
    () => query(collectionGroup(db, "updates"), where("timestamp", ">=", since), orderBy("timestamp", "desc"), limit(2000)),
    (id, d) => ({ id, zoneId: "", ...(d as Omit<ZoneHistoryEntry, "id" | "zoneId">) }),
    [days]
  );
  const reports = useJurisdictionCollection<CommunityReport>(
    "community_reports",
    () => [where("createdAt", ">=", since)],
    (id, d) => ({ id, ...(d as Omit<CommunityReport, "id">) }),
    [days],
    2000,
  );
  const alerts = useFirestoreCollection<PublicAlert>(
    () => query(collection(db, "alerts"), where("createdAt", ">=", since), limit(1000)),
    (id, d) => ({ id, ...(d as Omit<PublicAlert, "id">) }),
    [days]
  );

  const mineZones = zones.data.filter((z) => canManageArea(claims, z.area));
  const mineReports = reports.data.filter((r) => canManageArea(claims, r.area));
  const mineAlerts = alerts.data.filter((a) => canManageArea(claims, a.area));
  const zoneIds = new Set(mineZones.map((z) => z.name));
  const created = history.data.filter((h) => h.action === "created" && (zoneIds.has(h.zoneName) || appRole === "super_admin" || role === "admin"));

  const weekly = useMemo(() => {
    const weeks = Math.ceil(days / 7);
    return Array.from({ length: weeks }, (_, i) => {
      const end = Date.now() - (weeks - 1 - i) * 7 * DAY;
      const start = end - 7 * DAY;
      const n = created.filter((h) => {
        const t = toMillis(h.timestamp) ?? 0;
        return t > start && t <= end;
      }).length;
      return { label: new Date(start + DAY).toLocaleDateString("en-PH", { month: "short", day: "numeric" }), value: n };
    });
  }, [created, days]);

  const byArea = useMemo(() => {
    const m = new Map<string, number>();
    mineZones.forEach((z) => m.set(z.area, (m.get(z.area) ?? 0) + 1));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [mineZones]);

  const byStatus = useMemo(() => {
    const m = new Map<string, number>();
    mineReports.forEach((r) => m.set(r.status, (m.get(r.status) ?? 0) + 1));
    return [...m.entries()].map(([label, value]) => ({ label: label.replace("_", " "), value }));
  }, [mineReports]);

  const verifyTimes = mineReports
    .filter((r) => r.status === "verified" && r.verifiedAt)
    .map((r) => ((toMillis(r.verifiedAt) ?? 0) - (toMillis(r.createdAt) ?? 0)) / 60_000)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  const medianVerify = verifyTimes.length ? Math.round(verifyTimes[Math.floor(verifyTimes.length / 2)]) : null;
  const peak = mineZones.reduce((m, z) => Math.max(m, z.waterLevelM), 0);
  const simulated = mineZones.some((z) => z.simulated) || mineReports.some((r) => r.simulated);
  const loading = zones.loading || reports.loading;

  return (
    <AdminLayout>
      <PageHeader
        title="Analytics"
        subtitle={`Flood activity in your jurisdiction over the last ${days} days.`}
        actions={
          advanced ? (
            <button className="btn-secondary" onClick={() => downloadCsv(`flood-zones-${days}d.csv`, toCsv(mineZones, [
              { header: "name", value: (z) => z.name }, { header: "area", value: (z) => z.area }, { header: "status", value: (z) => z.status },
              { header: "water_level_m", value: (z) => z.waterLevelM }, { header: "road_passability", value: (z) => z.roadPassability },
              { header: "source", value: (z) => z.source ?? "drrm" }, { header: "updated_at", value: (z) => new Date(toMillis(z.updatedAt) ?? 0).toISOString() },
              { header: "simulated", value: (z) => Boolean(z.simulated) },
            ]))}>Export zones (CSV)</button>
          ) : undefined
        }
      />
      {!advanced && <UpgradeNotice feature="advancedAnalytics" plan="LGU Pro" billingPath="/admin/billing" />}
      {simulated && <Callout tone="neutral">Includes SIMULATED demonstration records.</Callout>}
      {loading ? <SkeletonRows /> : (
        <>
          <div className="readout-strip">
            <Readout value={created.length} label="New flood zones" />
            <Readout value={`${peak.toFixed(2)} m`} label="Deepest recorded" tone={peak >= 0.94 ? "closed" : peak >= 0.48 ? "danger" : "caution"} />
            <Readout value={mineReports.length} label="Community reports" />
            <Readout value={medianVerify != null ? `${medianVerify} min` : "—"} label="Median time to verify" tone="tide" />
            <Readout value={mineAlerts.length} label="Alerts issued" />
          </div>
          {advanced ? (
            <div className="grid-2">
              <div className="panel">
                <h3 className="panel__title">New flood zones per week</h3>
                <ColumnChart title="New flood zones per week" data={weekly} />
              </div>
              <div className="panel">
                <h3 className="panel__title">Zones by area</h3>
                {byArea.length ? <BarList title="Flood zones by area" data={byArea} /> : <p className="small muted">No zones in this period.</p>}
              </div>
              <div className="panel">
                <h3 className="panel__title">Community reports by outcome</h3>
                {byStatus.length ? <BarList title="Reports by outcome" data={byStatus} /> : <p className="small muted">No reports in this period.</p>}
              </div>
            </div>
          ) : (
            <p className="small muted">Upgrade to LGU Pro for 90-day trends, area breakdowns and exports.</p>
          )}
        </>
      )}
    </AdminLayout>
  );
}
