import React, { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import DashboardLayout from "../../components/layout/DashboardLayout";
import UpgradeNotice from "../../components/billing/UpgradeNotice";
import { Badge, Callout, ConfirmButton, DataTable, Field, Freshness, PageHeader, Readout, Spinner, formatDateTime, useToast } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useMyOrg } from "../../hooks/useOrg";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { db } from "../../firebase";
import { api, errorMessage } from "../../lib/api";
import { downloadCsv, toCsv } from "../../lib/csv";
import { SUB_STATUS } from "../../lib/labels";
import { PAID_FEATURE_LABELS, PAID_FEATURES, PUBLIC_SAFETY_FEATURES, PUBLIC_SAFETY_LABELS } from "../../../shared/plans";
import { toMillis } from "../../../shared/time";
import type { ApiKeyRecord, CommunityReport, EvacuationCenter, FloodRiskPrediction } from "../../../shared/types";

interface Branch {
  id: string;
  name: string;
  status: string;
  members: number;
  savedRoutes: number;
  createdAt: unknown;
}

function useBranches() {
  const { orgId } = useAuth();
  const [branches, setBranches] = useState<Branch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    if (!orgId) return;
    api<{ branches: Branch[] }>(`/orgs/${orgId}/branches`).then((r) => setBranches(r.branches)).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [orgId]);
  return { branches, error, reload: load };
}

export function EnterpriseOverviewPage() {
  const { org } = useMyOrg();
  const { branches } = useBranches();
  const { orgId } = useAuth();
  const keys = useFirestoreCollection<ApiKeyRecord>(() => (orgId ? query(collection(db, "organizations", orgId, "api_keys"), where("revoked", "==", false)) : null), (id, d) => ({ id, ...(d as Omit<ApiKeyRecord, "id">) }), [orgId]);
  const st = SUB_STATUS[org?.subscriptionStatus ?? "none"];
  return (
    <DashboardLayout kind="enterprise">
      <PageHeader title={org?.name ?? "Enterprise"} subtitle="Multi-branch flood intelligence, data API and custom integrations." />
      <div className="readout-strip">
        <Readout value={st.label} label="Subscription" tone={st.tone} />
        <Readout value={branches?.length ?? "—"} label="Branches" />
        <Readout value={keys.data.length} label="Active API keys" tone="tide" />
        <Readout value={org?.planId ? org.planId.replace("_", " ") : "—"} label="Plan" />
      </div>
      <div className="grid-2">
        <div className="panel">
          <h3 className="panel__title">Included capabilities</h3>
          <ul className="list-plain entitlement-list">
            {PUBLIC_SAFETY_FEATURES.map((f) => <li key={f}><Badge tone="safe">Free</Badge> {PUBLIC_SAFETY_LABELS[f]}</li>)}
            {PAID_FEATURES.map((f) => (
              <li key={f}>{org?.entitlements?.[f] ? <Badge tone="tide">Active</Badge> : <Badge tone="neutral">Not active</Badge>} {PAID_FEATURE_LABELS[f]}</li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h3 className="panel__title">Custom integrations</h3>
          <p className="small">Enterprise contracts can include integrations with ERP, dispatch, or GIS systems using the Bahadvisory data API and webhooks. Integration work is quoted per system.</p>
          <p className="tiny">Contact the platform team through your account manager to scope an integration.</p>
        </div>
      </div>
    </DashboardLayout>
  );
}

export function BranchesPage() {
  const { orgId } = useAuth();
  const { entitled } = useMyOrg();
  const { branches, error, reload } = useBranches();
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/branches`, { body: { name } });
      toast("Branch created.", "safe");
      setName("");
      reload();
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(false);
    }
  };
  return (
    <DashboardLayout kind="enterprise">
      <PageHeader title="Branches & jurisdictions" subtitle="Each branch is a separate organization with its own staff, routes and isolated data; it inherits your Enterprise plan." />
      {!entitled("multiBranch") ? (
        <UpgradeNotice feature="multiBranch" plan="Enterprise" billingPath="/enterprise/billing" />
      ) : (
        <div className="panel">
          <div className="row">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Branch name (e.g. Isla Group — Pinamalayan)" maxLength={160} style={{ maxWidth: 360 }} />
            <button onClick={create} disabled={busy || name.trim().length < 3}>{busy ? <Spinner /> : "Create branch"}</button>
          </div>
        </div>
      )}
      {error && <Callout tone="danger">{error}</Callout>}
      {branches === null ? <Spinner /> : (
        <DataTable
          rows={branches}
          rowKey={(b) => b.id}
          empty="No branches yet."
          columns={[
            { key: "n", header: "Branch", render: (b) => <strong>{b.name}</strong> },
            { key: "s", header: "Status", render: (b) => <Badge tone={b.status === "active" ? "safe" : "neutral"}>{b.status}</Badge> },
            { key: "m", header: "Members", className: "num", render: (b) => b.members },
            { key: "r", header: "Saved routes", className: "num", render: (b) => b.savedRoutes },
            { key: "c", header: "Created", render: (b) => <span className="tiny">{formatDateTime(b.createdAt)}</span> },
          ]}
        />
      )}
    </DashboardLayout>
  );
}

export function ApiAccessPage() {
  const { orgId, appRole } = useAuth();
  const { entitled } = useMyOrg();
  const toast = useToast();
  const keys = useFirestoreCollection<ApiKeyRecord>(() => (orgId ? query(collection(db, "organizations", orgId, "api_keys"), orderBy("createdAt", "desc")) : null), (id, d) => ({ id, ...(d as Omit<ApiKeyRecord, "id">) }), [orgId]);
  const [label, setLabel] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const isAdmin = ["enterprise_admin", "business_admin", "super_admin"].includes(appRole);
  const base = typeof window !== "undefined" ? `${window.location.origin}/api/v1` : "/api/v1";

  const create = async () => {
    try {
      const res = await api<{ key: string }>(`/orgs/${orgId}/api-keys`, { body: { label } });
      setFresh(res.key);
      setLabel("");
    } catch (err) {
      toast(errorMessage(err), "danger");
    }
  };

  return (
    <DashboardLayout kind="enterprise">
      <PageHeader title="API access" subtitle="Pull DRRM-verified flood zones, road conditions, alerts, evacuation centers and the experimental risk outlook into your own systems." />
      {!entitled("apiAccess") ? (
        <UpgradeNotice feature="apiAccess" plan="Enterprise (or the Business Pro add-on)" billingPath="/enterprise/billing" />
      ) : (
        <>
          {isAdmin && (
            <div className="panel">
              <div className="row">
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Key label (e.g. Dispatch system)" maxLength={80} style={{ maxWidth: 320 }} />
                <button onClick={create} disabled={label.trim().length < 2}>Create API key</button>
              </div>
              {fresh && (
                <Callout tone="caution" title="Copy your key now">
                  It won't be shown again. Store it in your server's secret manager, never in a browser or mobile app.
                  <input readOnly value={fresh} onFocus={(e) => e.target.select()} className="mono" />
                </Callout>
              )}
            </div>
          )}
          <DataTable
            rows={keys.data}
            rowKey={(k) => k.id}
            empty="No API keys yet."
            columns={[
              { key: "l", header: "Label", render: (k) => <strong>{k.label}</strong> },
              { key: "p", header: "Key", render: (k) => <span className="mono">{k.prefix}…</span> },
              { key: "s", header: "Status", render: (k) => (k.revoked ? <Badge tone="neutral">Revoked</Badge> : <Badge tone="safe">Active</Badge>) },
              { key: "u", header: "Last used", render: (k) => (k.lastUsedAt ? <Freshness at={k.lastUsedAt} prefix="" /> : "Never") },
              { key: "a", header: "", render: (k) => (!k.revoked && isAdmin ? <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Revoke key" onConfirm={() => api(`/orgs/${orgId}/api-keys/${k.id}`, { method: "DELETE" }).then(() => toast("Key revoked.", "safe"))}>Revoke</ConfirmButton> : null) },
            ]}
          />
          <div className="panel">
            <h3 className="panel__title">Endpoints</h3>
            <pre className="code-block">{`curl -H "x-api-key: $BAHADVISORY_KEY" ${base}/flood-zones
GET ${base}/flood-zones          # active zones + road conditions
GET ${base}/alerts               # active public alerts
GET ${base}/evacuation-centers   # verified centers (verified occupancy only)
GET ${base}/risk                 # experimental risk outlook (not an official forecast)`}</pre>
            <p className="tiny">Rate limit: 120 requests/minute per key. Every response includes metadata; records with simulated=true are demo data.</p>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}

export function CustomReportsPage() {
  const { entitled } = useMyOrg();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(null);
    }
  };
  const reports = [
    {
      key: "zones",
      title: "Flood zone history",
      desc: "Every DRRM flood zone (active and cleared) with level, passability and area.",
      run: async () => {
        const snap = await getDocs(query(collection(db, "floodZones"), limit(2000)));
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Record<string, unknown>[];
        downloadCsv("flood-zones.csv", toCsv(rows, [
          { header: "id", value: (r) => r.id }, { header: "name", value: (r) => r.name }, { header: "area", value: (r) => r.area },
          { header: "status", value: (r) => r.status }, { header: "water_level_m", value: (r) => r.waterLevelM }, { header: "road_passability", value: (r) => r.roadPassability },
          { header: "updated_at", value: (r) => new Date(toMillis(r.updatedAt) ?? 0).toISOString() }, { header: "simulated", value: (r) => Boolean(r.simulated) },
        ]));
      },
    },
    {
      key: "reports",
      title: "Verified community reports",
      desc: "Citizen flood reports verified by DRRM (no personal data).",
      run: async () => {
        const snap = await getDocs(query(collection(db, "community_reports"), where("status", "==", "verified"), orderBy("createdAt", "desc"), limit(2000)));
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommunityReport, "id">) }));
        downloadCsv("verified-reports.csv", toCsv(rows, [
          { header: "id", value: (r) => r.id }, { header: "area", value: (r) => r.area }, { header: "depth", value: (r) => r.depthLabel },
          { header: "lat", value: (r) => r.location.lat }, { header: "lng", value: (r) => r.location.lng }, { header: "road", value: (r) => r.roadName },
          { header: "observed_at", value: (r) => new Date(toMillis(r.observedAt) ?? 0).toISOString() }, { header: "simulated", value: (r) => Boolean(r.simulated) },
        ]));
      },
    },
    {
      key: "centers",
      title: "Evacuation centers",
      desc: "Verified centers with status and verified occupancy.",
      run: async () => {
        const snap = await getDocs(query(collection(db, "evacuation_centers"), where("verified", "==", true)));
        const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EvacuationCenter, "id">) }));
        downloadCsv("evacuation-centers.csv", toCsv(rows, [
          { header: "name", value: (r) => r.name }, { header: "area", value: (r) => r.area }, { header: "status", value: (r) => r.status },
          { header: "capacity", value: (r) => (r.occupancyVerified ? r.capacity : "") }, { header: "occupancy", value: (r) => (r.occupancyVerified ? r.occupancy : "") },
          { header: "lat", value: (r) => r.location.lat }, { header: "lng", value: (r) => r.location.lng }, { header: "simulated", value: (r) => Boolean(r.simulated) },
        ]));
      },
    },
    {
      key: "risk",
      title: "Risk outlook snapshot",
      desc: "Latest experimental risk scores per municipality (not an official forecast).",
      run: async () => {
        const snap = await getDocs(collection(db, "flood_risk_predictions"));
        const rows = snap.docs.map((d) => d.data() as FloodRiskPrediction);
        downloadCsv("risk-outlook.csv", toCsv(rows, [
          { header: "area", value: (r) => r.area }, { header: "score", value: (r) => r.score }, { header: "level", value: (r) => r.level },
          { header: "data_completeness", value: (r) => r.dataCompleteness }, { header: "model", value: (r) => r.modelVersion },
          { header: "computed_at", value: (r) => new Date(toMillis(r.computedAt) ?? 0).toISOString() }, { header: "experimental", value: () => true },
        ]));
      },
    },
  ];
  return (
    <DashboardLayout kind="enterprise">
      <PageHeader title="Custom reports" subtitle="Download operational datasets as CSV for your own analysis and records." />
      {!entitled("advancedAnalytics") ? (
        <UpgradeNotice feature="advancedAnalytics" plan="Enterprise" billingPath="/enterprise/billing" />
      ) : (
        <div className="grid-2">
          {reports.map((r) => (
            <div key={r.key} className="panel">
              <h3 className="panel__title">{r.title}</h3>
              <p className="small">{r.desc}</p>
              <button className="btn-secondary" disabled={busy !== null} onClick={() => run(r.key, r.run)}>{busy === r.key ? <Spinner /> : "Download CSV"}</button>
            </div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
