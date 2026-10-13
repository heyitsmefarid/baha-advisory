import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, query, where } from "firebase/firestore";
import AdminLayout from "../../components/admin/AdminLayout";
import { Badge, Readout } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useZonesByArea } from "../../hooks/useFloodZones";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useJurisdictionCollection } from "../../hooks/useJurisdictionCollection";
import { useActiveAlerts } from "../../hooks/useAlerts";
import { db } from "../../firebase";
import { api } from "../../lib/api";
import { canManageArea } from "../../../shared/roles";
import type { CommunityReport, FloodRiskPrediction, Incident, SosRequest } from "../../../shared/types";

const LEVEL_TONE = { low: "safe", moderate: "caution", high: "danger", critical: "closed" } as const;

export default function DashboardPage() {
  const { role, assignedArea, areas, orgId } = useAuth();
  const isAdmin = role === "admin";
  const claims = { role, assignedArea, areas };
  const { data: zones, loading } = useZonesByArea(assignedArea, isAdmin);
  const active = zones.filter((z) => z.status === "active");
  const rising = active.filter((z) => z.trend === "rising").length;
  const closed = active.filter((z) => z.roadPassability === "closed").length;

  const reports = useJurisdictionCollection<CommunityReport>(
    "community_reports",
    () => [where("status", "in", ["pending", "needs_info"])],
    (id, d) => ({ id, ...(d as Omit<CommunityReport, "id">) }),
    []
  );
  const sos = useJurisdictionCollection<SosRequest>("sos_requests", () => [where("status", "in", ["open", "acknowledged"])], (id, d) => ({ id, ...(d as Omit<SosRequest, "id">) }), []);
  const incidents = useFirestoreCollection<Incident>(
    () => (orgId ? query(collection(db, "incidents"), where("orgId", "==", orgId)) : null),
    (id, d) => ({ id, ...(d as Omit<Incident, "id">) }),
    [orgId]
  );
  const alerts = useActiveAlerts();
  const [risk, setRisk] = useState<FloodRiskPrediction[]>([]);
  useEffect(() => {
    api<{ predictions: FloodRiskPrediction[] }>("/risk", { anonymous: true }).then((r) => setRisk(r.predictions)).catch(() => undefined);
  }, []);

  const mine = <T extends { area: string }>(x: T) => canManageArea(claims, x.area);
  const pendingMine = reports.data.filter(mine);
  const sosMine = sos.data.filter(mine);
  const openIncidents = incidents.data.filter((i) => i.status !== "resolved");
  const riskMine = risk.filter(mine).sort((a, b) => b.score - a.score);

  return (
    <AdminLayout>
      <h2>Dashboard</h2>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="stat-cards">
            <div className="stat-card">
              <span className="stat-card__value">{active.length}</span>
              <span className="stat-card__label">Active zones</span>
            </div>
            <div className="stat-card stat-card--warn">
              <span className="stat-card__value">{rising}</span>
              <span className="stat-card__label">Rising</span>
            </div>
            <div className="stat-card stat-card--danger">
              <span className="stat-card__value">{closed}</span>
              <span className="stat-card__label">Closed roads</span>
            </div>
          </div>

          <div className="readout-strip">
            <Readout value={<Link to="/admin/verification">{pendingMine.length}</Link>} label="Reports to verify" tone={pendingMine.length ? "caution" : "neutral"} />
            <Readout value={<Link to="/admin/sos">{sosMine.filter((s) => s.status === "open").length}</Link>} label="Unacknowledged SOS" tone={sosMine.some((s) => s.status === "open") ? "danger" : "neutral"} />
            <Readout value={<Link to="/admin/incidents">{openIncidents.length}</Link>} label="Open incidents" />
            <Readout value={<Link to="/admin/advisories">{alerts.data.filter(mine).length}</Link>} label="Active alerts" />
          </div>

          {riskMine.length > 0 && (
            <div className="panel">
              <div className="panel__head">
                <h3 className="panel__title">Experimental risk outlook — your areas</h3>
                <Link to="/risk" className="tiny">Details</Link>
              </div>
              <div className="row">
                {riskMine.map((r) => (
                  <span key={r.id} className="risk-chip">
                    <strong>{r.area}</strong> <Badge tone={LEVEL_TONE[r.level]}>{r.level}</Badge> <span className="mono small">{r.score}</span>
                  </span>
                ))}
              </div>
              <p className="tiny">Not an official forecast — a transparent, rule-based indicator.</p>
            </div>
          )}

          <h3 className="section-heading">Active zones in your area</h3>
          <div className="zone-table">
            {active.map((z) => (
              <div key={z.id} className="zone-table__row">
                <strong>
                  {z.name} {z.simulated && <Badge tone="sim">Simulated</Badge>}
                </strong>
                <div>{z.waterLevelM.toFixed(2)}m</div>
                <div>{z.trend}</div>
                <div>{z.roadPassability.replace("_", " ")}</div>
              </div>
            ))}
            {active.length === 0 && <p className="muted">No active zones right now.</p>}
          </div>
        </>
      )}
    </AdminLayout>
  );
}
