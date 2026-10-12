import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import { LineChart } from "../components/charts/Charts";
import { Callout, DataTable, PageHeader, Readout } from "../components/ui";
import { usePlans } from "../hooks/usePlans";
import { DEFAULT_ASSUMPTIONS, project, type ProjectionAssumptions } from "../../shared/projection";
import { formatPhp } from "../../shared/plans";

type Key = keyof ProjectionAssumptions;

const GROUPS: { title: string; fields: { key: Key; label: string; step: number; min: number; max: number; hint?: string }[] }[] = [
  {
    title: "Customer acquisition",
    fields: [
      { key: "lguPerMonth", label: "New LGUs per month", step: 0.25, min: 0, max: 20 },
      { key: "lguMax", label: "Reachable LGUs (cap)", step: 5, min: 1, max: 1700, hint: "15 in Oriental Mindoro; ~1,600 cities & municipalities nationwide" },
      { key: "businessPerMonth", label: "New businesses per month", step: 1, min: 0, max: 100 },
      { key: "enterprisePerQuarter", label: "New enterprise contracts per quarter", step: 0.25, min: 0, max: 10 },
      { key: "monthlyChurnPct", label: "Monthly churn (%)", step: 0.5, min: 0, max: 30 },
    ],
  },
  {
    title: "Pricing (₱ per month)",
    fields: [
      { key: "lguPrice", label: "LGU Pro", step: 500, min: 0, max: 100000 },
      { key: "businessPrice", label: "Business Pro", step: 250, min: 0, max: 50000 },
      { key: "enterprisePrice", label: "Enterprise (avg contract)", step: 1000, min: 0, max: 500000 },
    ],
  },
  {
    title: "One-time revenue (₱)",
    fields: [
      { key: "lguInstallFee", label: "LGU installation fee", step: 1000, min: 0, max: 500000 },
      { key: "trainingFee", label: "Staff training package", step: 1000, min: 0, max: 200000 },
      { key: "trainingAttachRate", label: "LGUs buying training (0–1)", step: 0.05, min: 0, max: 1 },
      { key: "integrationFee", label: "Enterprise integration fee", step: 5000, min: 0, max: 1000000 },
    ],
  },
  {
    title: "Costs",
    fields: [
      { key: "staffCost", label: "Team & operations (₱/month)", step: 5000, min: 0, max: 2000000 },
      { key: "hostingBase", label: "Base hosting (₱/month)", step: 500, min: 0, max: 200000, hint: "₱0 on Firebase Spark + Netlify free tier" },
      { key: "hostingPerCustomer", label: "Hosting per customer (₱/month)", step: 10, min: 0, max: 5000 },
      { key: "aiCostPerCustomer", label: "AI cost per customer (₱/month)", step: 10, min: 0, max: 5000, hint: "After free tiers; depends on usage limits" },
      { key: "cacPerCustomer", label: "Acquisition cost per customer (₱)", step: 500, min: 0, max: 200000 },
      { key: "paymentFeePct", label: "Payment provider fees (%)", step: 0.1, min: 0, max: 10 },
    ],
  },
];

export default function BusinessModelPage() {
  const { plans } = usePlans();
  const [a, setA] = useState<ProjectionAssumptions>(() => {
    const lgu = plans.find((p) => p.id === "lgu_pro");
    const biz = plans.find((p) => p.id === "business_pro");
    return { ...DEFAULT_ASSUMPTIONS, lguPrice: lgu?.priceMonthlyPhp ?? DEFAULT_ASSUMPTIONS.lguPrice, businessPrice: biz?.priceMonthlyPhp ?? DEFAULT_ASSUMPTIONS.businessPrice };
  });
  const [showTable, setShowTable] = useState(false);
  const r = useMemo(() => project(a), [a]);
  const set = (k: Key, v: number) => setA((s) => ({ ...s, [k]: Number.isFinite(v) ? v : 0 }));
  const labels = r.rows.map((x) => `M${x.month}`);
  const at = (m: number) => r.rows[Math.min(r.rows.length, m) - 1];

  return (
    <AppShell>
      <PageHeader
        title="Business model"
        subtitle="Free for citizens, paid by the organizations that run and depend on disaster operations: LGUs (B2G) and businesses (B2B)."
      />

      <div className="grid-2">
        <div className="panel">
          <h3 className="panel__title">Who pays — and who never does</h3>
          <dl className="kv kv--stack">
            <div><dt>Citizens</dt><dd>Free, always: live flood map, flood-safe navigation, alerts, community reporting, evacuation finder, SOS and a daily AI quota.</dd></div>
            <div><dt>LGUs / DRRM offices (B2G)</dt><dd>LGU Pro subscription for verification, incident management, AI advisories, analytics and staff — plus installation and training.</dd></div>
            <div><dt>Businesses (B2B)</dt><dd>Business Pro for fleet route monitoring, disruption alerts, analytics and exports; data API as an add-on.</dd></div>
            <div><dt>Enterprises</dt><dd>Custom contracts: multi-branch, data API, custom integrations and reports.</dd></div>
          </dl>
        </div>
        <div className="panel">
          <h3 className="panel__title">Revenue streams</h3>
          <ul className="list-plain plan-card__list">
            {plans.filter((p) => (p.priceMonthlyPhp ?? 1) > 0).map((p) => (
              <li key={p.id}>{p.name}: {p.priceMonthlyPhp == null ? "custom contract" : `${formatPhp(p.priceMonthlyPhp)}/month or ${formatPhp(p.priceAnnualPhp)}/year`}</li>
            ))}
            <li>One-time: LGU installation & data onboarding, staff training, system configuration, custom integrations</li>
            <li>Flood-risk & road-condition data API subscriptions</li>
            <li>Premium operational reports (advanced analytics & exports)</li>
          </ul>
          <p className="tiny">Prices are read live from the platform's plan settings.</p>
        </div>
      </div>

      <h3 className="section-heading">Revenue simulator</h3>
      <Callout tone="caution" title="Hypothetical projection">
        Everything below is computed only from the assumptions you set. It is not actual revenue, a forecast, or a commitment. Actual billing is
        tracked separately in the platform's Super Admin dashboard.
      </Callout>

      <div className="sim">
        <div className="sim__inputs">
          <label className="field">
            <span className="field__label">Projection horizon (months)</span>
            <input type="number" min={6} max={60} value={a.months} onChange={(e) => set("months", Number(e.target.value))} />
          </label>
          {GROUPS.map((g) => (
            <fieldset key={g.title} className="sim__group">
              <legend>{g.title}</legend>
              {g.fields.map((f) => (
                <label key={f.key} className="field">
                  <span className="field__label">{f.label}</span>
                  <input type="number" step={f.step} min={f.min} max={f.max} value={a[f.key]} onChange={(e) => set(f.key, Number(e.target.value))} />
                  {f.hint && <span className="field__hint">{f.hint}</span>}
                </label>
              ))}
            </fieldset>
          ))}
          <button className="btn-secondary btn-sm" onClick={() => setA(DEFAULT_ASSUMPTIONS)}>Reset assumptions</button>
        </div>

        <div className="sim__results">
          <div className="readout-strip">
            <Readout value={formatPhp(at(12)?.mrr)} label="MRR at month 12" tone="tide" />
            <Readout value={formatPhp(r.arrAtEnd)} label={`ARR at month ${r.rows.length}`} tone="tide" />
            <Readout value={r.breakEvenMonth ? `Month ${r.breakEvenMonth}` : "Not reached"} label="Monthly break-even" tone={r.breakEvenMonth ? "safe" : "danger"} />
            <Readout value={r.paybackMonth ? `Month ${r.paybackMonth}` : "Not reached"} label="Cumulative payback" tone={r.paybackMonth ? "safe" : "caution"} />
          </div>
          <div className="panel">
            <h4 className="panel__title">Monthly revenue vs. costs (₱)</h4>
            <LineChart
              title="Projected monthly revenue and costs"
              labels={labels}
              series={[
                { name: "Revenue", color: "var(--series-1)", values: r.rows.map((x) => x.revenue) },
                { name: "Costs", color: "var(--series-2)", values: r.rows.map((x) => x.costs) },
              ]}
              format={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
            />
          </div>
          <div className="panel">
            <h4 className="panel__title">Cumulative cash position (₱)</h4>
            <LineChart
              title="Projected cumulative cash"
              labels={labels}
              series={[{ name: "Cumulative net", color: "var(--viz-mag)", values: r.rows.map((x) => x.cumulative) }]}
              format={(v) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)))}
            />
            <p className="tiny">
              Lowest point: {formatPhp(Math.min(...r.rows.map((x) => x.cumulative)))} (funding needed before payback). Totals over {r.rows.length} months:
              revenue {formatPhp(r.totalRevenue)}, costs {formatPhp(r.totalCosts)}.
            </p>
          </div>
          <button className="btn-ghost btn-sm" onClick={() => setShowTable((s) => !s)}>{showTable ? "Hide" : "Show"} month-by-month table</button>
          {showTable && (
            <DataTable
              rows={r.rows}
              rowKey={(x) => String(x.month)}
              columns={[
                { key: "m", header: "Month", render: (x) => x.month },
                { key: "c", header: "LGUs / Biz / Ent", render: (x) => <span className="mono small">{x.lgus} / {x.businesses} / {x.enterprises}</span> },
                { key: "mrr", header: "MRR", className: "num", render: (x) => formatPhp(x.mrr) },
                { key: "o", header: "One-time", className: "num", render: (x) => formatPhp(x.oneTime) },
                { key: "k", header: "Costs", className: "num", render: (x) => formatPhp(x.costs) },
                { key: "n", header: "Net", className: "num", render: (x) => formatPhp(x.net) },
                { key: "cu", header: "Cumulative", className: "num", render: (x) => formatPhp(x.cumulative) },
              ]}
            />
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <h3 className="panel__title">Why it scales</h3>
          <ul className="list-plain plan-card__list">
            <li>Multi-tenant by design: each LGU or business is an isolated organization on shared infrastructure.</li>
            <li>Free-tier-first stack: Firebase Spark, Netlify Functions, public OSM routing and Open-Meteo weather keep the pilot near ₱0.</li>
            <li>Area lists, thresholds and hotlines are data, not code — a new province is configuration.</li>
            <li>The citizen app grows the verified-report network that makes the paid tools more valuable.</li>
          </ul>
        </div>
        <div className="panel">
          <h3 className="panel__title">Competitive advantages</h3>
          <ul className="list-plain plan-card__list">
            <li>Verification-first: community reports change maps and routes only after DRRM review.</li>
            <li>Vehicle-specific, flood-aware routing grounded in the MMDA flood gauge.</li>
            <li>English & Filipino AI assistant constrained to verified records.</li>
            <li>Works offline as an installable app, with honest data-age labels.</li>
            <li>Public-safety core is free forever — trust with residents, value for paying operators.</li>
          </ul>
        </div>
      </div>
      <p className="tiny">
        See plans on the <Link to="/pricing">pricing page</Link>.
      </p>
    </AppShell>
  );
}
