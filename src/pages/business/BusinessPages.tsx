import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { deleteDoc, doc } from "firebase/firestore";
import DashboardLayout from "../../components/layout/DashboardLayout";
import UpgradeNotice from "../../components/billing/UpgradeNotice";
import { ColumnChart, BarList } from "../../components/charts/Charts";
import { Badge, Callout, ConfirmButton, DataTable, EmptyState, Freshness, PageHeader, Readout, Spinner, Tabs, formatDateTime, formatDistance, formatDuration, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useMyOrg } from "../../hooks/useOrg";
import { useDisruptions, useRouteHistory, useSavedRoutes } from "../../hooks/useFleet";
import { db } from "../../firebase";
import { api, errorMessage } from "../../lib/api";
import { downloadCsv, toCsv } from "../../lib/csv";
import { TRAVEL_MODE_LABELS } from "../../../shared/routing";
import { manilaDateKey, toMillis } from "../../../shared/time";
import type { SavedRoute } from "../../../shared/types";

const ROUTE_TONE = { safe: "safe", caution: "caution", unsafe: "danger", unknown: "neutral" } as const;
const ROUTE_TEXT = { safe: "Clear", caution: "Flooded but passable", unsafe: "Blocked", unknown: "Not checked" };

function useFleetGate() {
  const { entitled, loading } = useMyOrg();
  return { allowed: entitled("fleetMonitoring"), loading };
}

function Gate({ children }: { children: React.ReactNode }) {
  const { allowed, loading } = useFleetGate();
  const { orgId } = useAuth();
  if (!orgId) return <Callout tone="neutral">Set up a business account first — <Link to="/get-started?type=business">get started</Link>.</Callout>;
  if (loading) return <Spinner />;
  if (!allowed) return <UpgradeNotice feature="fleetMonitoring" plan="Business Pro" billingPath="/business/billing" />;
  return <>{children}</>;
}

async function runCheck(orgId: string, routeId?: string) {
  return api<{ checked: number; newDisruptions: number; results: { name: string; status: string; disruptions: number }[] }>("/fleet/check", { body: { orgId, routeId }, timeoutMs: 120_000 });
}

export function BusinessOverviewPage() {
  const { orgId } = useAuth();
  const { org } = useMyOrg();
  const routes = useSavedRoutes();
  const active = useDisruptions(true);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const lastCheck = Math.max(0, ...routes.data.map((r) => toMillis(r.lastCheckedAt) ?? 0)) || null;

  const checkAll = async () => {
    if (!orgId) return;
    setBusy(true);
    try {
      const res = await runCheck(orgId);
      toast(`Checked ${res.checked} route(s) — ${res.newDisruptions} new disruption(s).`, res.newDisruptions ? "caution" : "safe");
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DashboardLayout kind="business">
      <PageHeader
        title={org?.name ?? "Fleet overview"}
        subtitle="Your delivery routes, checked against DRRM-verified flooding and road closures."
        actions={<button onClick={checkAll} disabled={busy || !routes.data.length}>{busy ? <><Spinner /> Checking…</> : "Check all routes now"}</button>}
      />
      <Gate>
        <div className="readout-strip">
          <Readout value={routes.data.length} label="Saved routes" />
          <Readout value={routes.data.filter((r) => r.lastStatus === "unsafe").length} label="Blocked routes" tone="danger" />
          <Readout value={active.data.length} label="Active disruptions" tone={active.data.length ? "caution" : "safe"} />
          <Readout value={lastCheck ? <Freshness at={lastCheck} prefix="" /> : "—"} label="Last check" />
        </div>
        {routes.data.length === 0 ? (
          <EmptyState title="No saved routes yet" action={<Link className="chip-btn chip-btn--solid" to="/business/planner">Plan a route</Link>}>
            Save your regular delivery runs and Bahadvisory will flag any verified flooding on them.
          </EmptyState>
        ) : (
          <DataTable
            rows={routes.data}
            rowKey={(r) => r.id}
            columns={[
              { key: "n", header: "Route", render: (r) => (<div><strong>{r.name}</strong><div className="tiny">{r.stops.length} stops · {TRAVEL_MODE_LABELS[r.vehicle]}</div></div>) },
              { key: "s", header: "Status", render: (r) => <Badge tone={ROUTE_TONE[r.lastStatus ?? "unknown"]}>{ROUTE_TEXT[r.lastStatus ?? "unknown"]}</Badge> },
              { key: "d", header: "Distance / time", render: (r) => <span className="mono small">{formatDistance(r.lastDistanceM)} · {formatDuration(r.lastDurationS)}</span> },
              { key: "x", header: "Disruptions", className: "num", render: (r) => r.activeDisruptions ?? 0 },
              { key: "c", header: "Checked", render: (r) => (r.lastCheckedAt ? <Freshness at={r.lastCheckedAt} prefix="" /> : "—") },
            ]}
          />
        )}
        {active.data.length > 0 && (
          <div className="panel">
            <h3 className="panel__title">Active disruptions</h3>
            <ul className="list-plain">
              {active.data.slice(0, 8).map((d) => (
                <li key={d.id} className="draft-row">
                  <span className="small"><Badge tone={d.severity === "blocked" ? "danger" : "caution"}>{d.severity}</Badge> <strong>{d.routeName}</strong> — {d.hazardName}</span>
                  <Freshness at={d.detectedAt} prefix="detected" />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Gate>
    </DashboardLayout>
  );
}

export function SavedRoutesPage() {
  const { orgId, appRole, currentUser } = useAuth();
  const routes = useSavedRoutes();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <DashboardLayout kind="business">
      <PageHeader title="Saved routes" subtitle="Recurring delivery runs. Check one to re-plan it against the latest verified road conditions." actions={<Link className="chip-btn chip-btn--solid" to="/business/planner">New route</Link>} />
      <Gate>
        <DataTable
          rows={routes.data}
          rowKey={(r) => r.id}
          empty="No saved routes yet."
          columns={[
            { key: "n", header: "Route", render: (r: SavedRoute) => (<div><strong>{r.name}</strong><div className="tiny">{r.stops.map((s) => s.label).join(" → ")}</div></div>) },
            { key: "v", header: "Vehicle", render: (r) => TRAVEL_MODE_LABELS[r.vehicle] },
            { key: "s", header: "Status", render: (r) => <Badge tone={ROUTE_TONE[r.lastStatus ?? "unknown"]}>{ROUTE_TEXT[r.lastStatus ?? "unknown"]}</Badge> },
            {
              key: "a",
              header: "",
              render: (r) => (
                <span className="row">
                  <button className="btn-secondary btn-sm" disabled={busy !== null} onClick={async () => {
                    setBusy(r.id);
                    try {
                      const res = await runCheck(orgId!, r.id);
                      toast(`${r.name}: ${ROUTE_TEXT[(res.results[0]?.status as keyof typeof ROUTE_TEXT) ?? "unknown"]}`, "info");
                    } catch (err) {
                      toast(errorMessage(err), "danger");
                    } finally {
                      setBusy(null);
                    }
                  }}>{busy === r.id ? <Spinner /> : "Check now"}</button>
                  <Link className="chip-btn" to={`/business/planner?route=${r.id}`}>Open</Link>
                  {(r.createdBy === currentUser?.uid || appRole === "business_admin" || appRole === "enterprise_admin") && (
                    <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Delete route" onConfirm={() => deleteDoc(doc(db, "organizations", orgId!, "saved_routes", r.id))}>Delete</ConfirmButton>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Gate>
    </DashboardLayout>
  );
}

export function DisruptionsPage() {
  const [tab, setTab] = useState<"active" | "resolved">("active");
  const list = useDisruptions(tab === "active");
  return (
    <DashboardLayout kind="business">
      <PageHeader title="Route disruptions" subtitle="Verified flooding or closures detected on your saved routes. Disruptions resolve automatically when a re-check finds the route clear." />
      <Gate>
        <Tabs label="Disruptions" value={tab} onChange={setTab} tabs={[{ id: "active", label: "Active" }, { id: "resolved", label: "Resolved" }]} />
        <DataTable
          rows={list.data}
          rowKey={(d) => d.id}
          empty={tab === "active" ? "No active disruptions." : "Nothing resolved yet."}
          columns={[
            { key: "r", header: "Route", render: (d) => <strong>{d.routeName}</strong> },
            { key: "h", header: "Hazard", render: (d) => d.hazardName },
            { key: "s", header: "Severity", render: (d) => <Badge tone={d.severity === "blocked" ? "danger" : "caution"}>{d.severity}</Badge> },
            { key: "t", header: "Detected", render: (d) => <span className="tiny">{formatDateTime(d.detectedAt)}</span> },
            { key: "e", header: "Resolved", render: (d) => <span className="tiny">{d.resolvedAt ? formatDateTime(d.resolvedAt) : "—"}</span> },
          ]}
        />
      </Gate>
    </DashboardLayout>
  );
}

export function BusinessAnalyticsPage() {
  const history = useRouteHistory();
  const disrupted = useDisruptions(false);
  const activeD = useDisruptions(true);
  const days = 14;
  const perDay = useMemo(() => {
    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i--) keys.push(manilaDateKey(Date.now() - i * 86_400_000));
    return keys.map((k) => ({
      label: k.slice(5),
      value: history.data.filter((h) => manilaDateKey(toMillis(h.at) ?? 0) === k && h.status !== "safe").length,
      note: `${history.data.filter((h) => manilaDateKey(toMillis(h.at) ?? 0) === k).length} checks`,
    }));
  }, [history.data]);
  const byRoute = useMemo(() => {
    const m = new Map<string, number>();
    [...disrupted.data, ...activeD.data].forEach((d) => m.set(d.routeName, (m.get(d.routeName) ?? 0) + 1));
    return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [disrupted.data, activeD.data]);
  const avoided = history.data.reduce((s, h) => s + h.avoidedHazards, 0);

  return (
    <DashboardLayout kind="business">
      <PageHeader
        title="Analytics & exports"
        subtitle="Operational impact of flooding on your routes."
        actions={
          <button className="btn-secondary" onClick={() => downloadCsv("bahadvisory-route-history.csv", toCsv(history.data, [
            { header: "time", value: (h) => new Date(toMillis(h.at) ?? 0).toISOString() },
            { header: "route", value: (h) => h.routeName },
            { header: "vehicle", value: (h) => h.vehicle },
            { header: "status", value: (h) => h.status },
            { header: "distance_m", value: (h) => Math.round(h.distanceM) },
            { header: "duration_s", value: (h) => Math.round(h.durationS) },
            { header: "hazards_avoided", value: (h) => h.avoidedHazards },
          ]))}>Export route history (CSV)</button>
        }
      />
      <Gate>
        <div className="readout-strip">
          <Readout value={history.data.length} label="Route checks" />
          <Readout value={history.data.filter((h) => h.status === "unsafe").length} label="Checks with a blocked route" tone="danger" />
          <Readout value={avoided} label="Flood hazards avoided" tone="tide" />
          <Readout value={disrupted.data.length + activeD.data.length} label="Disruptions recorded" />
        </div>
        <div className="grid-2">
          <div className="panel">
            <h3 className="panel__title">Disrupted checks per day (last {days} days)</h3>
            <ColumnChart title="Disrupted route checks per day" data={perDay} />
          </div>
          <div className="panel">
            <h3 className="panel__title">Disruptions by route</h3>
            {byRoute.length ? <BarList title="Disruptions by route" data={byRoute} /> : <p className="small muted">No disruptions recorded.</p>}
          </div>
        </div>
      </Gate>
    </DashboardLayout>
  );
}
