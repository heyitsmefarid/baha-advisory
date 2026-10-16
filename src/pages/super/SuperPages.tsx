import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import DashboardLayout from "../../components/layout/DashboardLayout";
import { BarList, LineChart } from "../../components/charts/Charts";
import { Badge, Callout, ConfirmButton, DataTable, Field, Freshness, Modal, PageHeader, Readout, Segmented, SkeletonRows, Spinner, Tabs, formatDateTime, useToast } from "../../components/ui";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useFirestoreDoc } from "../../hooks/useFirestoreDoc";
import { usePlans } from "../../hooks/usePlans";
import { db } from "../../firebase";
import { api, errorMessage } from "../../lib/api";
import { SUB_STATUS } from "../../lib/labels";
import { useMetrics } from "./superData";
import { APP_ROLES, ROLE_LABELS } from "../../../shared/roles";
import { AREA_NAMES } from "../../../shared/areas";
import { effectiveStatus } from "../../../shared/billing";
import { formatPhp, PAID_FEATURE_LABELS, PAID_FEATURES, validatePlan, type FeatureAvailability, type SubscriptionPlan } from "../../../shared/plans";
import type { AuditLogEntry, Organization, OrgApplication, PaymentTransaction, PlatformAiSettings, PlatformGeneralSettings, Subscription, UserProfile } from "../../../shared/types";

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const usd = (v: number) => `$${v.toFixed(v < 1 ? 4 : 2)}`;

// =============================================================================
// Overview & revenue
// =============================================================================

export function SuperOverviewPage() {
  const { data: m, error, loading, reload } = useMetrics(30);
  return (
    <DashboardLayout kind="super">
      <PageHeader title="Platform overview" subtitle="Live platform KPIs. Real revenue counts only verified live payments; sandbox/demo money is always reported separately." actions={<button className="btn-secondary" onClick={reload}>Refresh</button>} />
      {error && <Callout tone="danger">{error}</Callout>}
      {loading && !m ? <SkeletonRows /> : m && (
        <>
          <h3 className="section-heading">Real revenue (live payments)</h3>
          <div className="readout-strip">
            <Readout value={formatPhp(m.revenue.real.mrrPhp)} label="MRR" tone="tide" />
            <Readout value={formatPhp(m.revenue.real.arrPhp)} label="ARR (MRR × 12)" tone="tide" />
            <Readout value={m.revenue.real.activeSubscriptions} label="Paying subscriptions" />
            <Readout value={pct(m.revenue.real.churn.rate)} label="Churn (30 days)" hint={`${m.revenue.real.churn.churned} of ${m.revenue.real.churn.base}`} />
            <Readout value={formatPhp(m.revenue.real.collected12m)} label="Collected (12 months)" />
          </div>
          {m.revenue.real.activeSubscriptions === 0 && (
            <Callout tone="neutral">No live payments yet. Figures stay at ₱0 until a real provider (PayMongo/Xendit) confirms a payment — demo subscriptions never count.</Callout>
          )}
          <h3 className="section-heading">Sandbox / demo subscriptions</h3>
          <div className="readout-strip readout-strip--sim">
            <Readout value={formatPhp(m.revenue.demo.mrrPhp)} label="Demo MRR (not real)" />
            <Readout value={m.revenue.demo.activeSubscriptions} label="Demo subscriptions" />
            <Readout value={formatPhp(m.revenue.demo.collected12m)} label="Sandbox payments (12 months)" />
          </div>
          <div className="grid-2">
            <div className="panel">
              <h3 className="panel__title">Users & organizations</h3>
              <div className="readout-strip readout-strip--flat">
                <Readout value={m.users.total} label="Registered users" />
                <Readout value={m.organizations.total} label="Organizations" />
                <Readout value={m.organizations.paying} label="With active plans" />
                <Readout value={m.organizations.pendingApplications} label="Pending applications" tone={m.organizations.pendingApplications ? "caution" : "neutral"} />
              </div>
              <BarList title="Users by role" data={Object.entries(m.users.byRole).filter(([, v]) => v > 0).map(([k, v]) => ({ label: ROLE_LABELS[k as keyof typeof ROLE_LABELS] ?? k, value: v }))} />
              {m.organizations.pendingApplications > 0 && <Link to="/super/organizations?tab=applications">Review applications</Link>}
            </div>
            <div className="panel">
              <h3 className="panel__title">AI (last {m.windowDays} days)</h3>
              <div className="readout-strip readout-strip--flat">
                <Readout value={m.ai.calls} label="AI calls (incl. fallbacks)" />
                <Readout value={usd(m.ai.estCostUsd)} label="Estimated cost (list price)" />
              </div>
              <LineChart title="AI calls per day by provider" labels={m.ai.byDay.map((d) => d.day.slice(5))} series={[{ name: "Groq", color: "var(--series-1)", values: m.ai.byDay.map((d) => d.groq) }, { name: "Gemini", color: "var(--series-2)", values: m.ai.byDay.map((d) => d.gemini) }]} height={180} />
              <p className="tiny">{m.ai.note}</p>
            </div>
          </div>
          <p className="tiny">Generated <Freshness at={m.generatedAt} prefix="" />. Projections live on the <Link to="/business-model">business model</Link> page, never in these figures.</p>
        </>
      )}
    </DashboardLayout>
  );
}

export function RevenuePage() {
  const { data: m, error } = useMetrics(30);
  const [view, setView] = useState<"real" | "demo">("real");
  return (
    <DashboardLayout kind="super">
      <PageHeader title="Revenue" subtitle="Collected payments and recurring revenue by plan." actions={<Segmented label="Revenue view" value={view} onChange={setView} options={[{ id: "real", label: "Real" }, { id: "demo", label: "Sandbox / demo" }]} />} />
      {error && <Callout tone="danger">{error}</Callout>}
      {!m ? <SkeletonRows /> : (
        <>
          {view === "demo" && <Callout tone="neutral" title="Sandbox figures">Demo and test-mode payments — no real money. Shown for demonstration only.</Callout>}
          <div className="readout-strip">
            <Readout value={formatPhp(m.revenue[view].mrrPhp)} label="MRR" tone="tide" />
            <Readout value={formatPhp(m.revenue[view].arrPhp)} label="ARR" tone="tide" />
            <Readout value={pct(m.revenue[view].churn.rate)} label="Churn (30 days)" />
            <Readout value={`${m.payments.paid} / ${m.payments.failed} / ${m.payments.pending}`} label="Payments paid / failed / pending (all)" />
          </div>
          <div className="grid-2">
            <div className="panel">
              <h3 className="panel__title">Collected per month (₱)</h3>
              <LineChart
                title="Collected per month"
                labels={m.revenue.monthly.map((x) => x.month.slice(2))}
                series={view === "real" ? [{ name: "Real", color: "var(--series-1)", values: m.revenue.monthly.map((x) => x.realPhp) }] : [{ name: "Sandbox", color: "var(--series-3)", values: m.revenue.monthly.map((x) => x.demoPhp) }]}
                area
              />
            </div>
            <div className="panel">
              <h3 className="panel__title">MRR by plan</h3>
              {Object.keys(m.revenue[view].byPlan).length ? (
                <BarList title="MRR by plan" data={Object.entries(m.revenue[view].byPlan).map(([k, v]) => ({ label: `${k.replace("_", " ")} (${v.count})`, value: v.mrrPhp }))} format={(v) => formatPhp(v)} />
              ) : <p className="small muted">No active subscriptions in this view.</p>}
            </div>
          </div>
        </>
      )}
    </DashboardLayout>
  );
}

// =============================================================================
// Organizations & applications
// =============================================================================

function ManualSubscriptionModal({ org, onClose }: { org: Organization | null; onClose: () => void }) {
  const { plans } = usePlans();
  const toast = useToast();
  const [planId, setPlanId] = useState("lgu_pro");
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [amount, setAmount] = useState(5000);
  const [isDemo, setIsDemo] = useState(true);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!org) return;
    setBusy(true);
    try {
      const res = await api<{ outcome: string }>(`/admin/orgs/${org.id}/manual-subscription`, { body: { planId, billingCycle: cycle, amountPhp: amount, isDemo, reference } });
      toast(`Recorded — ${res.outcome}.`, "safe");
      onClose();
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!org} title={`Record a contract — ${org?.name ?? ""}`} onClose={onClose} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button onClick={submit} disabled={busy}>{busy ? <Spinner /> : "Record payment"}</button></>}>
      <p className="small">For contracts paid outside online checkout (e.g. an LGU purchase order paid by bank transfer). Mark demonstration contracts as demo so they never count as real revenue.</p>
      <div className="field-row">
        <Field label="Plan"><select value={planId} onChange={(e) => setPlanId(e.target.value)}>{plans.filter((p) => p.segment !== "citizen").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Cycle"><select value={cycle} onChange={(e) => setCycle(e.target.value as "monthly" | "annual")}><option value="monthly">Monthly</option><option value="annual">Annual</option></select></Field>
        <Field label="Amount paid (₱)"><input type="number" min={1} value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
      </div>
      <Field label="Reference (PO / OR number)"><input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} /></Field>
      <label className="check-row"><input type="checkbox" checked={isDemo} onChange={(e) => setIsDemo(e.target.checked)} /> Demo / not real money</label>
    </Modal>
  );
}

export function OrganizationsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<"orgs" | "applications">(() => (new URLSearchParams(window.location.search).get("tab") === "applications" ? "applications" : "orgs"));
  const orgs = useFirestoreCollection<Organization>(() => query(collection(db, "organizations")), (id, d) => ({ id, ...(d as Omit<Organization, "id">) }), []);
  const apps = useFirestoreCollection<OrgApplication>(() => query(collection(db, "org_applications"), orderBy("createdAt", "desc"), limit(100)), (id, d) => ({ id, ...(d as Omit<OrgApplication, "id">) }), []);
  const [manualFor, setManualFor] = useState<Organization | null>(null);
  const [addonsFor, setAddonsFor] = useState<Organization | null>(null);
  const decide = (id: string, decision: "approve" | "reject") =>
    api(`/admin/applications/${id}/decide`, { body: { decision } }).then(() => toast(`Application ${decision === "approve" ? "approved" : "rejected"}.`, "safe")).catch((e) => toast(errorMessage(e), "danger"));
  const settings = (orgId: string, body: Record<string, unknown>) =>
    api(`/admin/orgs/${orgId}/settings`, { body }).then(() => toast("Organization updated.", "safe")).catch((e) => toast(errorMessage(e), "danger"));
  const pending = apps.data.filter((a) => a.status === "pending");

  return (
    <DashboardLayout kind="super">
      <PageHeader title="Organizations" subtitle="LGUs, businesses and enterprises. LGU and enterprise accounts are created only after you approve their application." />
      <Tabs label="Organizations" value={tab} onChange={setTab} tabs={[{ id: "orgs", label: "Organizations", count: orgs.data.length }, { id: "applications", label: "Applications", count: pending.length }]} />
      {tab === "orgs" ? (
        <DataTable
          rows={orgs.data}
          rowKey={(o) => o.id}
          columns={[
            { key: "n", header: "Organization", render: (o) => (<div><strong>{o.name}</strong><div className="tiny">{o.type}{o.parentOrgId ? ` · branch of ${o.parentOrgId}` : ""}{o.jurisdictionAreas?.length ? ` · ${o.jurisdictionAreas.join(", ")}` : ""}</div></div>) },
            { key: "p", header: "Plan", render: (o) => (<span className="row">{o.planId ?? "—"} <Badge tone={SUB_STATUS[o.subscriptionStatus ?? "none"].tone}>{SUB_STATUS[o.subscriptionStatus ?? "none"].label}</Badge></span>) },
            { key: "a", header: "Add-ons", render: (o) => <span className="tiny">{(o.addOns ?? []).join(", ") || "—"}</span> },
            { key: "s", header: "Status", render: (o) => <Badge tone={o.status === "active" ? "safe" : "danger"}>{o.status}</Badge> },
            { key: "d", header: "", render: (o) => (o.isDemo ? <Badge tone="sim">Demo</Badge> : null) },
            {
              key: "x",
              header: "",
              render: (o) => (
                <span className="row">
                  <button className="btn-ghost btn-sm" onClick={() => setManualFor(o)}>Record contract</button>
                  <button className="btn-ghost btn-sm" onClick={() => setAddonsFor(o)}>Add-ons</button>
                  <ConfirmButton className="btn-ghost btn-sm" confirmLabel={o.status === "active" ? "Suspend" : "Reactivate"} onConfirm={() => settings(o.id, { status: o.status === "active" ? "suspended" : "active" })}>
                    {o.status === "active" ? "Suspend" : "Reactivate"}
                  </ConfirmButton>
                </span>
              ),
            },
          ]}
        />
      ) : (
        <DataTable
          rows={apps.data}
          rowKey={(a) => a.id}
          empty="No applications."
          columns={[
            { key: "o", header: "Applicant", render: (a) => (<div><strong>{a.orgName}</strong><div className="tiny">{a.applicantName} · {a.applicantEmail}{a.position ? ` · ${a.position}` : ""}</div></div>) },
            { key: "t", header: "Type", render: (a) => a.type },
            { key: "j", header: "Jurisdiction / message", render: (a) => <span className="tiny">{a.jurisdictionAreas.join(", ")}{a.message ? ` — ${a.message}` : ""}</span> },
            { key: "s", header: "Status", render: (a) => <Badge tone={a.status === "approved" ? "safe" : a.status === "rejected" ? "neutral" : "caution"}>{a.status}</Badge> },
            { key: "d", header: "Submitted", render: (a) => <span className="tiny">{formatDateTime(a.createdAt)}</span> },
            {
              key: "x",
              header: "",
              render: (a) =>
                a.status === "pending" ? (
                  <span className="row">
                    <ConfirmButton className="btn-safe btn-sm" confirmLabel="Approve — grants admin role" onConfirm={() => decide(a.id, "approve")}>Approve</ConfirmButton>
                    <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Reject" onConfirm={() => decide(a.id, "reject")}>Reject</ConfirmButton>
                  </span>
                ) : null,
            },
          ]}
        />
      )}
      <ManualSubscriptionModal org={manualFor} onClose={() => setManualFor(null)} />
      <Modal open={!!addonsFor} title={`Add-ons — ${addonsFor?.name ?? ""}`} onClose={() => setAddonsFor(null)}>
        <p className="small">Optional features (marked "add-on" on a plan) unlock for this organization while its subscription is active.</p>
        {addonsFor &&
          PAID_FEATURES.map((f) => (
            <label key={f} className="check-row">
              <input
                type="checkbox"
                defaultChecked={(addonsFor.addOns ?? []).includes(f)}
                onChange={(e) => {
                  const next = new Set(addonsFor.addOns ?? []);
                  e.target.checked ? next.add(f) : next.delete(f);
                  setAddonsFor({ ...addonsFor, addOns: [...next] });
                  settings(addonsFor.id, { addOns: [...next] });
                }}
              />
              {PAID_FEATURE_LABELS[f]}
            </label>
          ))}
      </Modal>
    </DashboardLayout>
  );
}

// =============================================================================
// Users
// =============================================================================

export function SuperUsersPage() {
  const toast = useToast();
  const users = useFirestoreCollection<UserProfile>(() => query(collection(db, "users"), limit(500)), (id, d) => ({ ...(d as Omit<UserProfile, "uid">), uid: id }), []);
  const orgs = useFirestoreCollection<Organization>(() => query(collection(db, "organizations")), (id, d) => ({ id, ...(d as Omit<Organization, "id">) }), []);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<UserProfile | null>(null);
  const [role, setRole] = useState("citizen");
  const [orgId, setOrgId] = useState("");
  const [area, setArea] = useState("");
  const filtered = users.data.filter((u) => `${u.name} ${u.email} ${u.role}`.toLowerCase().includes(search.toLowerCase()));
  const save = async () => {
    if (!editing) return;
    try {
      await api(`/admin/users/${editing.uid}/role`, { body: { role, orgId: orgId || null, assignedArea: area || null, name: editing.name, email: editing.email } });
      toast("Role updated. The user's sessions were revoked so the change applies immediately.", "safe");
      setEditing(null);
    } catch (err) {
      toast(errorMessage(err), "danger");
    }
  };
  return (
    <DashboardLayout kind="super">
      <PageHeader title="Users" subtitle="Roles are custom claims set by the server; users can never grant themselves privileges." />
      <div className="filter-bar"><input placeholder="Search name, email or role…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <DataTable
        rows={filtered}
        rowKey={(u) => u.uid}
        columns={[
          { key: "n", header: "User", render: (u) => (<div><strong>{u.name || "—"}</strong><div className="tiny">{u.email}</div></div>) },
          { key: "r", header: "Role", render: (u) => <Badge tone={u.role === "citizen" ? "neutral" : "tide"}>{u.role}</Badge> },
          { key: "o", header: "Organization", render: (u) => <span className="tiny">{u.orgId ?? "—"}{u.assignedArea ? ` · ${u.assignedArea}` : ""}</span> },
          { key: "c", header: "Joined", render: (u) => <span className="tiny">{formatDateTime(u.createdAt)}</span> },
          { key: "x", header: "", render: (u) => <button className="btn-ghost btn-sm" onClick={() => { setEditing(u); setRole(u.role ?? "citizen"); setOrgId(u.orgId ?? ""); setArea(u.assignedArea ?? ""); }}>Change role</button> },
        ]}
      />
      <Modal open={!!editing} title={`Change role — ${editing?.email ?? ""}`} onClose={() => setEditing(null)} footer={<><button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><ConfirmButton className="" confirmLabel="Apply role change" onConfirm={save}>Save</ConfirmButton></>}>
        <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value)}>{APP_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></Field>
        <Field label="Organization (for org roles)"><select value={orgId} onChange={(e) => setOrgId(e.target.value)}><option value="">— none —</option>{orgs.data.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.type})</option>)}</select></Field>
        <Field label="Assigned area (LGU roles)"><select value={area} onChange={(e) => setArea(e.target.value)}><option value="">— none —</option>{AREA_NAMES.map((a) => <option key={a}>{a}</option>)}</select></Field>
      </Modal>
    </DashboardLayout>
  );
}

// =============================================================================
// Subscriptions & payments
// =============================================================================

export function SubscriptionsPage() {
  const [tab, setTab] = useState<"subs" | "payments">("subs");
  const [kind, setKind] = useState<"all" | "real" | "demo">("all");
  const subs = useFirestoreCollection<Subscription>(() => query(collection(db, "subscriptions"), limit(300)), (id, d) => ({ id, ...(d as Omit<Subscription, "id">) }), []);
  const txs = useFirestoreCollection<PaymentTransaction>(() => query(collection(db, "payment_transactions"), orderBy("createdAt", "desc"), limit(300)), (id, d) => ({ id, ...(d as Omit<PaymentTransaction, "id">) }), []);
  const isReal = (r: { isDemo: boolean; livemode?: boolean }) => !r.isDemo && r.livemode !== false;
  const keep = <T extends { isDemo: boolean; livemode?: boolean }>(r: T) => kind === "all" || (kind === "real" ? isReal(r) : !isReal(r));
  return (
    <DashboardLayout kind="super">
      <PageHeader title="Subscriptions & payments" actions={<Segmented label="Filter" value={kind} onChange={setKind} options={[{ id: "all", label: "All" }, { id: "real", label: "Real" }, { id: "demo", label: "Sandbox / demo" }]} />} />
      <Tabs label="Billing records" value={tab} onChange={setTab} tabs={[{ id: "subs", label: "Subscriptions" }, { id: "payments", label: "Payments" }]} />
      {tab === "subs" ? (
        <DataTable
          rows={subs.data.filter(keep)}
          rowKey={(s) => s.id}
          columns={[
            { key: "o", header: "Organization", render: (s) => <span className="mono small">{s.orgId}</span> },
            { key: "p", header: "Plan", render: (s) => `${s.planId} · ${s.billingCycle}` },
            { key: "s", header: "Status (live)", render: (s) => { const st = effectiveStatus(s, Date.now()); return <Badge tone={SUB_STATUS[st].tone}>{SUB_STATUS[st].label}</Badge>; } },
            { key: "m", header: "MRR", className: "num", render: (s) => formatPhp(s.mrrPhp) },
            { key: "e", header: "Period end", render: (s) => <span className="tiny">{formatDateTime(s.currentPeriodEnd)}</span> },
            { key: "k", header: "Kind", render: (s) => (isReal(s) ? <Badge tone="safe">Real</Badge> : <Badge tone="sim">Sandbox/demo</Badge>) },
          ]}
        />
      ) : (
        <DataTable
          rows={txs.data.filter(keep)}
          rowKey={(t) => t.id}
          columns={[
            { key: "d", header: "Created", render: (t) => <span className="tiny">{formatDateTime(t.createdAt)}</span> },
            { key: "o", header: "Organization", render: (t) => <span className="mono small">{t.orgId}</span> },
            { key: "x", header: "Description", render: (t) => <span className="small">{t.description}</span> },
            { key: "a", header: "Amount", className: "num", render: (t) => formatPhp(t.amountPhp) },
            { key: "s", header: "Status", render: (t) => <Badge tone={t.status === "paid" ? "safe" : t.status === "pending" ? "caution" : "danger"}>{t.status}</Badge> },
            { key: "p", header: "Provider", render: (t) => <span className="tiny">{t.provider}{t.livemode ? " (live)" : ""}</span> },
            { key: "k", header: "Kind", render: (t) => (isReal(t) ? <Badge tone="safe">Real</Badge> : <Badge tone="sim">Sandbox/demo</Badge>) },
            { key: "i", header: "", render: (t) => (t.invoiceId ? <Link to={`/billing/invoice/${t.invoiceId}`}>Receipt</Link> : t.failureReason ? <span className="tiny">{t.failureReason}</span> : null) },
          ]}
        />
      )}
    </DashboardLayout>
  );
}

// =============================================================================
// Plans & pricing
// =============================================================================

function PlanEditor({ plan }: { plan: SubscriptionPlan }) {
  const toast = useToast();
  const [draft, setDraft] = useState<SubscriptionPlan>(plan);
  const [busy, setBusy] = useState(false);
  const v = validatePlan(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(plan);
  const num = (val: string) => (val === "" ? null : Number(val));
  const save = async () => {
    setBusy(true);
    try {
      const { id, ...body } = draft;
      const res = await api<{ orgsRecomputed: number }>(`/admin/plans/${id}`, { body });
      toast(`Saved. Entitlements recomputed for ${res.orgsRecomputed} organization(s).`, "safe");
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel">
      <div className="panel__head">
        <h3 className="panel__title">{plan.name} <span className="tiny mono">{plan.id}</span></h3>
        <label className="check-row"><input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} /> Offered</label>
      </div>
      <div className="field-row">
        <Field label="Monthly price (₱, empty = custom)"><input type="number" min={0} value={draft.priceMonthlyPhp ?? ""} disabled={plan.segment === "citizen"} onChange={(e) => setDraft({ ...draft, priceMonthlyPhp: num(e.target.value) })} /></Field>
        <Field label="Annual price (₱, empty = custom)"><input type="number" min={0} value={draft.priceAnnualPhp ?? ""} disabled={plan.segment === "citizen"} onChange={(e) => setDraft({ ...draft, priceAnnualPhp: num(e.target.value) })} /></Field>
      </div>
      <div className="field-row">
        {(["chatPerDay", "chatPerMonth", "imagePerDay", "imagePerMonth"] as const).map((k) => (
          <Field key={k} label={{ chatPerDay: "AI chat / day", chatPerMonth: "AI chat / month", imagePerDay: "Photo AI / day", imagePerMonth: "Photo AI / month" }[k]} hint="Empty = no limit on this window">
            <input type="number" min={0} value={draft.aiLimits[k] ?? ""} onChange={(e) => setDraft({ ...draft, aiLimits: { ...draft.aiLimits, [k]: num(e.target.value) } })} />
          </Field>
        ))}
      </div>
      {plan.segment !== "citizen" && (
        <div className="feature-grid">
          {PAID_FEATURES.map((f) => (
            <label key={f} className="field">
              <span className="field__label">{PAID_FEATURE_LABELS[f]}</span>
              <select value={String(draft.features[f])} onChange={(e) => setDraft({ ...draft, features: { ...draft.features, [f]: (e.target.value === "optional" ? "optional" : e.target.value === "true") as FeatureAvailability } })}>
                <option value="true">Included</option>
                <option value="optional">Add-on</option>
                <option value="false">Not available</option>
              </select>
            </label>
          ))}
        </div>
      )}
      {!v.ok && <Callout tone="danger">{v.errors.join(" ")}</Callout>}
      <div className="btn-row">
        <button onClick={save} disabled={!dirty || !v.ok || busy}>{busy ? <Spinner /> : "Save plan"}</button>
        {dirty && <button className="btn-ghost btn-sm" onClick={() => setDraft(plan)}>Discard changes</button>}
      </div>
    </div>
  );
}

export function PlansPage() {
  const plans = useFirestoreCollection<SubscriptionPlan>(() => query(collection(db, "subscription_plans")), (id, d) => ({ ...(d as SubscriptionPlan), id }), []);
  const sorted = [...plans.data].sort((a, b) => a.sortOrder - b.sortOrder);
  return (
    <DashboardLayout kind="super">
      <PageHeader title="Plans & pricing" subtitle="Changes apply to new checkouts immediately; existing subscriptions keep their price until renewal. Public-safety features can't be put on a plan, and every plan needs finite AI limits." />
      {sorted.map((p) => <PlanEditor key={`${p.id}-${JSON.stringify(p).length}`} plan={p} />)}
    </DashboardLayout>
  );
}

// =============================================================================
// AI usage & cost
// =============================================================================

export function AiUsagePage() {
  const [days, setDays] = useState<"7" | "30" | "90">("30");
  const { data: m, error } = useMetrics(Number(days));
  const ai = useFirestoreDoc<PlatformAiSettings>(() => doc(db, "platform_settings", "ai"), []);
  const toast = useToast();
  const [perMin, setPerMin] = useState<string>("");
  const providers = m ? Object.entries(m.ai.byProvider) : [];
  return (
    <DashboardLayout kind="super">
      <PageHeader title="AI usage & cost" subtitle="Every Groq/Gemini call, fallback and cache hit is logged. Costs are list-price estimates; free-tier usage is billed $0 by the providers." actions={<Segmented label="Window" value={days} onChange={setDays} options={[{ id: "7", label: "7 days" }, { id: "30", label: "30 days" }, { id: "90", label: "90 days" }]} />} />
      {error && <Callout tone="danger">{error}</Callout>}
      {!m ? <SkeletonRows /> : (
        <>
          <div className="readout-strip">
            <Readout value={m.ai.calls} label="Calls" />
            <Readout value={usd(m.ai.estCostUsd)} label="Estimated cost" tone="tide" />
            <Readout value={providers.reduce((s, [, p]) => s + p.errors, 0)} label="Provider errors" tone="caution" />
            <Readout value={providers.reduce((s, [, p]) => s + p.cached, 0)} label="Cache hits" tone="safe" />
          </div>
          <div className="grid-2">
            <div className="panel">
              <h3 className="panel__title">Calls per day</h3>
              <LineChart title="AI calls per day" labels={m.ai.byDay.map((d) => d.day.slice(5))} series={[{ name: "Groq", color: "var(--series-1)", values: m.ai.byDay.map((d) => d.groq) }, { name: "Gemini", color: "var(--series-2)", values: m.ai.byDay.map((d) => d.gemini) }]} />
            </div>
            <div className="panel">
              <h3 className="panel__title">Calls by task</h3>
              {Object.keys(m.ai.byTask).length ? <BarList title="AI calls by task" data={Object.entries(m.ai.byTask).map(([k, v]) => ({ label: k.replace("_", " "), value: v }))} /> : <p className="small muted">No AI calls in this window.</p>}
            </div>
          </div>
          <DataTable
            rows={providers}
            rowKey={([k]) => k}
            empty="No AI calls yet."
            columns={[
              { key: "p", header: "Provider", render: ([k]) => <strong>{k}</strong> },
              { key: "c", header: "Calls", className: "num", render: ([, p]) => p.calls },
              { key: "t", header: "Tokens", className: "num", render: ([, p]) => p.tokens.toLocaleString() },
              { key: "e", header: "Errors", className: "num", render: ([, p]) => p.errors },
              { key: "h", header: "Cached", className: "num", render: ([, p]) => p.cached },
              { key: "u", header: "Est. cost", className: "num", render: ([, p]) => usd(p.costUsd) },
            ]}
          />
        </>
      )}
      <div className="panel">
        <h3 className="panel__title">Controls</h3>
        <p className="small">Per-user burst limit: <strong>{ai.data?.perUserPerMinute ?? 8}</strong> calls/minute · cache TTL {ai.data?.cacheTtlMinutes ?? 360} min.</p>
        <div className="row">
          <input type="number" min={1} max={60} placeholder="Calls per minute" value={perMin} onChange={(e) => setPerMin(e.target.value)} style={{ maxWidth: 180 }} />
          <button className="btn-secondary" disabled={!perMin} onClick={() => api("/admin/settings", { body: { ai: { perUserPerMinute: Number(perMin) } } }).then(() => toast("Saved.", "safe")).catch((e) => toast(errorMessage(e), "danger"))}>Update limit</button>
        </div>
        <p className="tiny">Plan quotas are edited on Plans & pricing. Switch AI off entirely in Features & settings.</p>
      </div>
    </DashboardLayout>
  );
}

// =============================================================================
// Settings & audit
// =============================================================================

export function SettingsPage() {
  const general = useFirestoreDoc<PlatformGeneralSettings>(() => doc(db, "platform_settings", "general"), []);
  const toast = useToast();
  const [msg, setMsg] = useState<string | null>(null);
  const g = general.data;
  const save = (body: Record<string, unknown>) => api("/admin/settings", { body: { general: body } }).then(() => toast("Settings saved.", "safe")).catch((e) => toast(errorMessage(e), "danger"));
  const flags: { key: keyof PlatformGeneralSettings; label: string; hint: string }[] = [
    { key: "demoMode", label: "Demo mode", hint: "Shows the demo banner and demo accounts on the sign-in page." },
    { key: "aiEnabled", label: "AI features", hint: "Master switch for Groq/Gemini. Core features keep working when off." },
    { key: "chatbotEnabled", label: "Baha AI assistant", hint: "" },
    { key: "imageAnalysisEnabled", label: "AI photo analysis", hint: "Reports are still accepted without it." },
    { key: "publicReportingEnabled", label: "Community reporting", hint: "Pause only during abuse; SOS and 911 stay available." },
  ];
  return (
    <DashboardLayout kind="super">
      <PageHeader title="Features & settings" />
      {!g ? <Spinner /> : (
        <div className="grid-2">
          <div className="panel">
            <h3 className="panel__title">Feature switches</h3>
            {flags.map((f) => (
              <label key={f.key} className="check-row setting-row">
                <input type="checkbox" checked={Boolean(g[f.key])} onChange={(e) => save({ [f.key]: e.target.checked })} />
                <span><strong>{f.label}</strong>{f.hint && <span className="tiny"> — {f.hint}</span>}</span>
              </label>
            ))}
          </div>
          <div className="panel">
            <h3 className="panel__title">Maintenance message</h3>
            <textarea rows={2} defaultValue={g.maintenanceMessage ?? ""} onChange={(e) => setMsg(e.target.value)} maxLength={300} placeholder="Shown as a banner to everyone (leave empty to hide)" />
            <button className="btn-secondary btn-sm" onClick={() => save({ maintenanceMessage: msg ?? g.maintenanceMessage ?? "" })}>Save message</button>
            <h3 className="panel__title" style={{ marginTop: "1em" }}>Emergency hotlines</h3>
            <ul className="list-plain small">{g.emergencyHotlines.map((h) => <li key={h.number}>{h.label}: <strong>{h.number}</strong></li>)}</ul>
            <p className="tiny">911 must remain listed. Local DRRMO numbers are set by each LGU.</p>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

export function SuperAuditPage() {
  const [filter, setFilter] = useState("");
  const logs = useFirestoreCollection<AuditLogEntry>(() => query(collection(db, "audit_logs"), orderBy("at", "desc"), limit(300)), (id, d) => ({ id, ...(d as Omit<AuditLogEntry, "id">) }), []);
  const rows = useMemo(() => logs.data.filter((l) => !filter || `${l.action} ${l.actorName} ${l.orgId ?? ""} ${l.targetId}`.toLowerCase().includes(filter.toLowerCase())), [logs.data, filter]);
  return (
    <DashboardLayout kind="super">
      <PageHeader title="Audit logs" subtitle="Append-only record of privileged actions (written server-side only)." />
      <div className="filter-bar"><input placeholder="Filter by action, actor or organization…" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      <DataTable
        rows={rows}
        rowKey={(l) => l.id}
        columns={[
          { key: "t", header: "Time", render: (l) => <span className="tiny">{formatDateTime(l.at)}</span> },
          { key: "a", header: "Action", render: (l) => <span className="mono small">{l.action}</span> },
          { key: "w", header: "Actor", render: (l) => <span className="small">{l.actorName ?? l.actorUid} <span className="tiny">({l.actorRole})</span></span> },
          { key: "g", header: "Target", render: (l) => <span className="tiny mono">{l.targetType}/{l.targetId}</span> },
          { key: "o", header: "Org", render: (l) => <span className="tiny mono">{l.orgId ?? "—"}</span> },
        ]}
      />
    </DashboardLayout>
  );
}
