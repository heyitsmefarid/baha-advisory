import React, { useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/layout/AppShell";
import { Badge, Callout, PageHeader, Segmented } from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { usePlans } from "../hooks/usePlans";
import { dashboardPathFor, isOrgAdminRole } from "../../shared/roles";
import {
  formatPhp,
  PAID_FEATURE_LABELS,
  PAID_FEATURES,
  PUBLIC_SAFETY_FEATURES,
  PUBLIC_SAFETY_LABELS,
  type FeatureAvailability,
  type SubscriptionPlan,
} from "../../shared/plans";

function cell(v: FeatureAvailability) {
  if (v === true) return <span className="plan-yes">Included</span>;
  if (v === "optional") return <span className="plan-opt">Add-on</span>;
  return <span className="plan-no">—</span>;
}

function aiLine(p: SubscriptionPlan) {
  const l = p.aiLimits;
  const chat = l.chatPerDay != null ? `${l.chatPerDay}/day` : `${l.chatPerMonth}/month`;
  const img = l.imagePerDay != null ? `${l.imagePerDay}/day` : `${l.imagePerMonth}/month`;
  return { chat, img };
}

function Cta({ plan }: { plan: SubscriptionPlan }) {
  const { currentUser, isAnonymous, appRole, orgId } = useAuth();
  const signedIn = currentUser && !isAnonymous;
  if (plan.segment === "citizen") {
    return signedIn ? (
      <Link className="chip-btn" to="/me">You're on Citizen Free</Link>
    ) : (
      <Link className="chip-btn chip-btn--solid" to="/register">Create a free account</Link>
    );
  }
  if (plan.priceMonthlyPhp == null) {
    return (
      <Link className="chip-btn chip-btn--solid" to={signedIn ? "/get-started?type=enterprise" : "/register"}>
        Talk to sales
      </Link>
    );
  }
  if (signedIn && orgId && isOrgAdminRole(appRole)) {
    return <Link className="chip-btn chip-btn--solid" to={`${dashboardPathFor(appRole)}/billing`}>Manage subscription</Link>;
  }
  const type = plan.segment === "lgu" ? "lgu" : "business";
  return (
    <Link className="chip-btn chip-btn--solid" to={signedIn ? `/get-started?type=${type}` : `/register`}>
      {plan.segment === "lgu" ? "Apply as an LGU" : "Start a business account"}
    </Link>
  );
}

export default function PricingPage() {
  const { plans } = usePlans();
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");

  return (
    <AppShell>
      <PageHeader
        title="Plans & pricing"
        subtitle="Flood monitoring, safe navigation, alerts, community reporting and evacuation information are free for every resident — always. LGUs and businesses subscribe for operations tools."
        actions={
          <Segmented
            label="Billing cycle"
            value={cycle}
            onChange={setCycle}
            options={[
              { id: "monthly", label: "Monthly" },
              { id: "annual", label: "Annual (save 10%)" },
            ]}
          />
        }
      />

      <div className="plan-grid">
        {plans.map((p) => {
          const price = cycle === "monthly" ? p.priceMonthlyPhp : p.priceAnnualPhp;
          const ai = aiLine(p);
          return (
            <article key={p.id} className={`plan-card ${p.id === "lgu_pro" ? "plan-card--featured" : ""}`}>
              <header>
                <h3>{p.name}</h3>
                <p className="small">{p.tagline}</p>
              </header>
              <div className="plan-card__price">
                <span className="plan-card__amount">{price == null ? "Custom" : price === 0 ? "₱0" : formatPhp(price)}</span>
                {price != null && price > 0 && <span className="tiny">/{cycle === "monthly" ? "month" : "year"}</span>}
              </div>
              <ul className="list-plain plan-card__list">
                <li>All public-safety features</li>
                {PAID_FEATURES.filter((f) => p.features[f] === true).map((f) => (
                  <li key={f}>{PAID_FEATURE_LABELS[f]}</li>
                ))}
                {PAID_FEATURES.filter((f) => p.features[f] === "optional").map((f) => (
                  <li key={f} className="plan-card__opt">{PAID_FEATURE_LABELS[f]} (add-on)</li>
                ))}
                <li>AI assistant: {ai.chat}</li>
                <li>AI photo analysis: {ai.img}</li>
                <li>Historical reports: {p.historicalReports}</li>
              </ul>
              {p.oneTimeFees && p.oneTimeFees.length > 0 && (
                <p className="tiny">Optional services: {p.oneTimeFees.map((f) => `${f.label} (${formatPhp(f.amountPhp)})`).join(" · ")}</p>
              )}
              <Cta plan={p} />
            </article>
          );
        })}
      </div>

      <h3 className="section-heading">Compare plans</h3>
      <div className="table-wrap">
        <table className="data-table plan-compare">
          <thead>
            <tr>
              <th>Feature</th>
              {plans.map((p) => (
                <th key={p.id}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PUBLIC_SAFETY_FEATURES.map((f) => (
              <tr key={f}>
                <td>{PUBLIC_SAFETY_LABELS[f]} <Badge tone="safe">Always free</Badge></td>
                {plans.map((p) => (
                  <td key={p.id}><span className="plan-yes">Included</span></td>
                ))}
              </tr>
            ))}
            {PAID_FEATURES.map((f) => (
              <tr key={f}>
                <td>{PAID_FEATURE_LABELS[f]}</td>
                {plans.map((p) => (
                  <td key={p.id}>{cell(p.features[f])}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td>AI assistant</td>
              {plans.map((p) => <td key={p.id} className="mono">{aiLine(p).chat}</td>)}
            </tr>
            <tr>
              <td>AI photo analysis</td>
              {plans.map((p) => <td key={p.id} className="mono">{aiLine(p).img}</td>)}
            </tr>
            <tr>
              <td>Historical reports</td>
              {plans.map((p) => <td key={p.id}>{p.historicalReports}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <Callout tone="neutral">
        AI usage limits reflect free-tier provider capacity and are fair-use caps, never "unlimited". Prices are in Philippine pesos and may be
        updated by the platform; existing subscriptions keep their price until renewal. Critical public-safety alerts and verified evacuation
        information are never sold.
      </Callout>
    </AppShell>
  );
}
