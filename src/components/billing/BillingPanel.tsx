import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import { Badge, Callout, ConfirmButton, DataTable, Readout, Segmented, Spinner, formatDateTime, useToast } from "../ui";
import { useAuth } from "../../contexts/AuthContext";
import { useMyOrg } from "../../hooks/useOrg";
import { usePlans } from "../../hooks/usePlans";
import { useFirestoreCollection } from "../../hooks/useFirestoreCollection";
import { useFirestoreDoc } from "../../hooks/useFirestoreDoc";
import { db } from "../../firebase";
import { api, errorMessage } from "../../lib/api";
import { SUB_STATUS } from "../../lib/labels";
import { effectiveStatus, daysUntilEnd } from "../../../shared/billing";
import { formatPhp, PAID_FEATURE_LABELS, PAID_FEATURES } from "../../../shared/plans";
import { manilaMonthKey } from "../../../shared/time";
import type { AiUsageCounter, BillingCycle, BillingInvoice, PaymentTransaction, Subscription } from "../../../shared/types";
import { getUnit, type CoverageScope } from "../../../shared/geography";
import CoverageScopeSelector from "../geography/CoverageScopeSelector";

const TX_TONE = { paid: "safe", pending: "caution", failed: "danger", expired: "neutral", canceled: "neutral" } as const;

export default function BillingPanel() {
  const { orgId, appRole } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const { org, loading } = useMyOrg();
  const { plans } = usePlans();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [coverageScopes, setCoverageScopes] = useState<CoverageScope[]>([]);
  const sub = useFirestoreDoc<Omit<Subscription, "id">>(() => (org?.subscriptionId ? doc(db, "subscriptions", org.subscriptionId) : null), [org?.subscriptionId]);
  const txs = useFirestoreCollection<PaymentTransaction>(
    () => (orgId ? query(collection(db, "payment_transactions"), where("orgId", "==", orgId), orderBy("createdAt", "desc"), limit(30)) : null),
    (id, d) => ({ id, ...(d as Omit<PaymentTransaction, "id">) }),
    [orgId]
  );
  const invoices = useFirestoreCollection<BillingInvoice>(
    () => (orgId ? query(collection(db, "billing_invoices"), where("orgId", "==", orgId), orderBy("issuedAt", "desc"), limit(30)) : null),
    (id, d) => ({ id, ...(d as Omit<BillingInvoice, "id">) }),
    [orgId]
  );
  const usage = useFirestoreDoc<AiUsageCounter>(() => (orgId ? doc(db, "ai_usage_records", `org_${orgId}_${manilaMonthKey(Date.now())}`) : null), [orgId]);

  if (!orgId) return <Callout tone="neutral">Your account isn't linked to an organization. <Link to="/get-started">Set one up</Link>.</Callout>;
  if (loading || !org) return <Spinner />;
  if (appRole !== "super_admin" && !["lgu_admin", "business_admin", "enterprise_admin"].includes(appRole)) {
    return <Callout tone="neutral">Only organization administrators can manage billing.</Callout>;
  }

  const myPlans = plans.filter((p) => p.segment === org.type);
  const current = plans.find((p) => p.id === (sub.data?.planId ?? org.planId)) ?? null;
  const status = sub.data ? effectiveStatus(sub.data, Date.now()) : "none";
  const st = SUB_STATUS[status];
  const days = sub.data ? daysUntilEnd(sub.data, Date.now()) : null;
  const sandbox = txs.data.some((t) => t.isDemo) || sub.data?.isDemo;

  const go = async (path: string, body: Record<string, unknown>, label: string) => {
    setBusy(label);
    try {
      const res = await api<{ checkoutUrl?: string; change?: string }>(path, { body });
      if (res.checkoutUrl) {
        if (res.checkoutUrl.startsWith("/")) navigate(res.checkoutUrl);
        else window.location.assign(res.checkoutUrl);
      } else if (res.change === "downgrade_scheduled") {
        toast("Plan change scheduled for the end of your current period.", "safe");
      } else {
        toast("Updated.", "safe");
      }
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      {sandbox && (
        <Callout tone="neutral" title="Sandbox billing">
          This environment uses sandbox payments — no real money moves, and these records never count as real revenue.
        </Callout>
      )}
      <div className="readout-strip">
        <Readout value={current?.name ?? "No plan"} label="Current plan" tone="tide" />
        <Readout value={st.label} label="Status" tone={st.tone} />
        <Readout value={sub.data?.currentPeriodEnd ? formatDateTime(sub.data.currentPeriodEnd).split(",")[0] : "—"} label={sub.data?.cancelAtPeriodEnd ? "Ends on" : "Renews / ends"} hint={days != null && days >= 0 ? `${days} day(s) left` : undefined} />
        <Readout value={sub.data ? formatPhp(sub.data.mrrPhp) : "—"} label="Monthly equivalent" />
      </div>
      {sub.data?.coverageScopes?.length ? <p className="small"><strong>Paid service coverage:</strong> {sub.data.coverageScopes.map((scope) => getUnit(scope.psgcCode)?.name ?? scope.psgcCode).join(", ")}</p> : null}

      {sub.data?.cancelAtPeriodEnd && status === "active" && (
        <Callout tone="caution" title="Cancellation scheduled">
          Paid features stay on until the end of the period, then switch off. Public-safety features keep working.{" "}
          <button className="btn-ghost btn-sm" onClick={() => go("/billing/cancel", { orgId, cancel: false }, "undo")}>Keep my subscription</button>
        </Callout>
      )}
      {sub.data?.pendingPlanId && (
        <Callout tone="info">Scheduled change to <strong>{plans.find((p) => p.id === sub.data?.pendingPlanId)?.name ?? sub.data.pendingPlanId}</strong> at the end of this period.</Callout>
      )}
      {status === "past_due" && <Callout tone="danger" title="Payment due">Your period ended. Renew within the 3-day grace period to keep paid features.</Callout>}

      <div className="panel">
        <CoverageScopeSelector value={org.type === "lgu" ? (sub.data?.coverageScopes ?? []) : coverageScopes} onChange={setCoverageScopes} disabled={org.type === "lgu"} />
        <div className="panel__head">
          <h3 className="panel__title">{status === "active" ? "Change or renew" : "Choose a plan"}</h3>
          <Segmented label="Billing cycle" value={cycle} onChange={setCycle} options={[{ id: "monthly", label: "Monthly" }, { id: "annual", label: "Annual" }]} />
        </div>
        <div className="plan-grid plan-grid--compact">
          {myPlans.map((p) => {
            const price = cycle === "monthly" ? p.priceMonthlyPhp : p.priceAnnualPhp;
            const isCurrent = current?.id === p.id && (status === "active" || status === "past_due");
            return (
              <div key={p.id} className={`plan-card ${isCurrent ? "plan-card--featured" : ""}`}>
                <h4>{p.name}</h4>
                <div className="plan-card__price">
                  <span className="plan-card__amount">{price == null ? "Custom" : formatPhp(price)}</span>
                  {price != null && <span className="tiny">/{cycle === "monthly" ? "month" : "year"}</span>}
                </div>
                <ul className="list-plain plan-card__list small">
                  {PAID_FEATURES.filter((f) => p.features[f] === true).map((f) => <li key={f}>{PAID_FEATURE_LABELS[f]}</li>)}
                </ul>
                {price == null ? (
                  <Link className="chip-btn" to="/get-started?type=enterprise">Request a quote</Link>
                ) : (
                  <button disabled={busy !== null || (org.type !== "lgu" && coverageScopes.length === 0)} onClick={() => go(isCurrent ? "/billing/checkout" : "/billing/change-plan", { orgId, planId: p.id, billingCycle: cycle, coverageScopes }, p.id)}>
                    {busy === p.id ? <Spinner /> : isCurrent ? (sub.data?.billingCycle === cycle ? "Renew now" : `Switch to ${cycle}`) : status === "active" ? "Change to this plan" : "Subscribe"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p className="tiny">Upgrades start immediately after payment. Downgrades take effect at the end of the paid period. Renewing early never loses paid days.</p>
        {status === "active" && !sub.data?.cancelAtPeriodEnd && (
          <ConfirmButton className="btn-ghost btn-sm" confirmLabel="Cancel at period end" onConfirm={() => go("/billing/cancel", { orgId, cancel: true }, "cancel")}>
            Cancel subscription
          </ConfirmButton>
        )}
      </div>

      {current?.oneTimeFees && current.oneTimeFees.length > 0 && (
        <div className="panel">
          <h3 className="panel__title">Services</h3>
          <ul className="list-plain">
            {current.oneTimeFees.map((f) => (
              <li key={f.id} className="draft-row">
                <span className="small">{f.label} — <strong>{formatPhp(f.amountPhp)}</strong> one-time</span>
                <button className="btn-secondary btn-sm" disabled={busy !== null} onClick={() => go("/billing/checkout", { orgId, feeId: f.id }, f.id)}>{busy === f.id ? <Spinner /> : "Purchase"}</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {current && (
        <div className="panel">
          <h3 className="panel__title">AI usage this month</h3>
          <p className="small">
            Assistant: <strong className="mono">{usage.data?.chat ?? 0}</strong> / {current.aiLimits.chatPerMonth ?? `${current.aiLimits.chatPerDay}/day`} · Photo analysis:{" "}
            <strong className="mono">{usage.data?.image ?? 0}</strong> / {current.aiLimits.imagePerMonth ?? `${current.aiLimits.imagePerDay}/day`}
          </p>
          <p className="tiny">Shared by all members of your organization. When the limit is reached, AI features pause; flood data, reporting and navigation keep working.</p>
        </div>
      )}

      <div className="panel">
        <h3 className="panel__title">Billing history</h3>
        <DataTable
          rows={txs.data}
          rowKey={(t) => t.id}
          empty="No payments yet."
          columns={[
            { key: "d", header: "Date", render: (t) => <span className="tiny">{formatDateTime(t.paidAt ?? t.createdAt)}</span> },
            { key: "x", header: "Description", render: (t) => <span className="small">{t.description}</span> },
            { key: "a", header: "Amount", className: "num", render: (t) => formatPhp(t.amountPhp) },
            { key: "s", header: "Status", render: (t) => (<span className="row"><Badge tone={TX_TONE[t.status]}>{t.status}</Badge>{t.isDemo && <Badge tone="neutral">sandbox</Badge>}</span>) },
            { key: "p", header: "Provider", render: (t) => <span className="tiny">{t.provider}</span> },
            {
              key: "i",
              header: "",
              render: (t) =>
                t.invoiceId ? <Link to={`/billing/invoice/${t.invoiceId}`}>Receipt</Link> : t.status === "pending" && t.checkoutUrl ? (t.checkoutUrl.startsWith("/") ? <Link to={t.checkoutUrl}>Complete payment</Link> : <a href={t.checkoutUrl}>Complete payment</a>) : null,
            },
          ]}
        />
        <p className="tiny">{invoices.data.length} receipt(s) on file.</p>
      </div>
    </div>
  );
}
