import React from "react";
import { Link, useSearchParams } from "react-router-dom";
import { doc } from "firebase/firestore";
import AppShell from "../../components/layout/AppShell";
import { Callout, Spinner } from "../../components/ui";
import { useAuth } from "../../contexts/AuthContext";
import { useFirestoreDoc } from "../../hooks/useFirestoreDoc";
import { db } from "../../firebase";
import { dashboardPathFor } from "../../../shared/roles";
import { formatPhp } from "../../../shared/plans";
import type { PaymentTransaction } from "../../../shared/types";

/**
 * Where providers redirect after checkout. The redirect itself proves
 * nothing — this page waits for the server-verified webhook to mark the
 * transaction paid (live via Firestore) before saying so.
 */
export default function BillingReturnPage() {
  const [params] = useSearchParams();
  const txId = params.get("tx") ?? "";
  const cancelled = params.get("status") === "cancel";
  const { appRole } = useAuth();
  const { data: tx, loading } = useFirestoreDoc<Omit<PaymentTransaction, "id">>(() => (txId ? doc(db, "payment_transactions", txId) : null), [txId]);
  const back = `${dashboardPathFor(appRole)}/billing`;

  return (
    <AppShell>
      <div className="checkout">
        {loading ? (
          <Spinner />
        ) : !tx ? (
          <Callout tone="danger">We couldn't find this payment.</Callout>
        ) : tx.status === "paid" ? (
          <Callout tone="safe" title="Payment confirmed">
            {tx.description} — {formatPhp(tx.amountPhp)}{tx.isDemo ? " (sandbox)" : ""}. Your organization's features are updated.{" "}
            {tx.invoiceId && <Link to={`/billing/invoice/${tx.invoiceId}`}>View receipt</Link>}
          </Callout>
        ) : tx.status === "pending" ? (
          cancelled ? (
            <Callout tone="neutral" title="Checkout not completed">No payment was taken. You can try again from your billing page.</Callout>
          ) : (
            <Callout tone="info" title="Waiting for payment confirmation">
              <Spinner /> We're waiting for the payment provider to confirm. This usually takes a few seconds — you can leave this page; we'll update your plan automatically.
            </Callout>
          )
        ) : (
          <Callout tone="danger" title="Payment not completed">
            {tx.failureReason ?? "The payment didn't go through."} Nothing was charged{tx.isDemo ? " (sandbox)" : ""}.
          </Callout>
        )}
        <Link className="chip-btn" to={back}>Back to billing</Link>
      </div>
    </AppShell>
  );
}
