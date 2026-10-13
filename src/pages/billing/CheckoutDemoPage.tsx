import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { doc } from "firebase/firestore";
import AppShell from "../../components/layout/AppShell";
import { Badge, Callout, Spinner, useToast } from "../../components/ui";
import { useFirestoreDoc } from "../../hooks/useFirestoreDoc";
import { db } from "../../firebase";
import { api, errorMessage } from "../../lib/api";
import { formatPhp } from "../../../shared/plans";
import type { PaymentTransaction } from "../../../shared/types";

/**
 * Sandbox checkout. Mirrors a hosted PayMongo/Xendit page but moves no
 * money: the buttons send a simulated provider result through the same
 * server-side payment processor real webhooks use.
 */
export default function CheckoutDemoPage() {
  const { txId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data: tx, loading, error } = useFirestoreDoc<Omit<PaymentTransaction, "id">>(() => doc(db, "payment_transactions", txId), [txId]);
  const [method, setMethod] = useState<"gcash" | "maya" | "card">("gcash");
  const [busy, setBusy] = useState(false);

  const complete = async (outcome: "paid" | "failed") => {
    setBusy(true);
    try {
      await api(`/billing/demo/${txId}/complete`, { body: { outcome } });
      navigate(`/billing/return?tx=${txId}&status=${outcome === "paid" ? "success" : "cancel"}`);
    } catch (err) {
      toast(errorMessage(err), "danger");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <div className="checkout">
        <div className="checkout__badge">
          <Badge tone="sim">Sandbox — no real payment</Badge>
        </div>
        {loading ? (
          <Spinner />
        ) : error || !tx ? (
          <Callout tone="danger">This checkout couldn't be loaded. Only your organization's administrators can open it.</Callout>
        ) : (
          <>
            <h1 className="checkout__title">Bahadvisory checkout</h1>
            <p className="small">{tx.description}</p>
            <div className="checkout__amount">{formatPhp(tx.amountPhp)}</div>
            {tx.status !== "pending" ? (
              <Callout tone={tx.status === "paid" ? "safe" : "neutral"}>This payment is already {tx.status}.</Callout>
            ) : (
              <>
                <div className="checkout__methods" role="radiogroup" aria-label="Payment method">
                  {(["gcash", "maya", "card"] as const).map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={method === m} className={`checkout__method ${method === m ? "checkout__method--on" : ""}`} onClick={() => setMethod(m)}>
                      {m === "gcash" ? "GCash" : m === "maya" ? "Maya" : "Credit / debit card"}
                    </button>
                  ))}
                </div>
                <p className="tiny">
                  In production this page is the PayMongo or Xendit hosted checkout. Here you choose the result the provider would report — it
                  goes through the same verified processing path, creating a sandbox receipt.
                </p>
                <div className="btn-row">
                  <button className="btn-safe" disabled={busy} onClick={() => complete("paid")}>{busy ? <Spinner /> : `Simulate successful ${method === "card" ? "card" : method === "gcash" ? "GCash" : "Maya"} payment`}</button>
                  <button className="btn-secondary" disabled={busy} onClick={() => complete("failed")}>Simulate failed payment</button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
