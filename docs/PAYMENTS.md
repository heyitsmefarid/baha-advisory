# Payments and subscriptions

## Plans

Plans are stored in `subscription_plans/*`. They are seeded from
`DEFAULT_PLANS` in [`shared/plans.ts`](../shared/plans.ts), and the Super
Admin can edit them at `/super/plans`.

| Plan | Monthly | Annual | AI chat | AI photo analysis | One-time fees |
|---|---|---|---|---|---|
| Citizen Free | ₱0 | ₱0 | 10 per day | 3 per day | — |
| LGU Pro | ₱5,000 | ₱54,000 | 500 per month | 500 per month | Installation and onboarding ₱25,000; staff training ₱15,000 |
| Business Pro | ₱2,000 | ₱21,600 | 300 per month | 100 per month | Fleet configuration ₱8,000 |
| Enterprise | Custom | Custom | Custom (fair use) | Custom (fair use) | Custom |

The one-time fee amounts are proposed defaults; nothing in the brief
specified them.

Two rules hold for every plan:
- **Public-safety features are included in every plan and cannot be removed.**
  That covers flood monitoring, basic navigation, emergency alerts, community
  reporting and the evacuation finder. `validatePlan()` rejects any edit that
  would gate them.
- **No plan promises unlimited AI** on free-tier providers.

## How a purchase works

```
Org admin → POST /api/billing/checkout {orgId, planId, billingCycle}
  └─ backend creates payment_transactions/{txId} (status: pending, amountMinor,
     provider, isDemo, livemode) and asks the provider for a hosted page
       └─ user pays on PayMongo / Xendit (or the sandbox page)
            └─ provider → POST /api/billing/webhook/:provider
                 └─ signature verified → processPaymentEvent()   [one Firestore transaction]
                      ├─ webhook_events/{provider_eventId}: already processed? → no-op (idempotent)
                      ├─ transaction found, still pending, amount ≥ due, livemode matches
                      ├─ subscription extended (applyPayment), invoice issued (counters/invoices)
                      └─ organizations/{orgId}.entitlements recomputed → features switch on
```

What the system guarantees:
- **The browser can never grant itself a plan.** Subscriptions,
  transactions, invoices and entitlements are written only by the backend;
  the rules deny all client writes.
- **Webhooks are verified before anything else happens.**
  - PayMongo: `Paymongo-Signature: t=…,te=…,li=…`, where the signature is
    HMAC-SHA256 over `"{t}.{rawBody}"`. Test events are checked against `te`,
    live events against `li`, using a constant-time comparison.
  - Xendit: the `x-callback-token` header must equal `XENDIT_CALLBACK_TOKEN`
    (constant-time).
- **Webhooks are idempotent.** Providers retry, so each event ID is recorded
  in the same transaction that applies it.
- **Amounts are checked.** An underpayment marks the transaction `failed`
  with "manual review" and grants nothing.
- **Live mode is checked.** A test-mode event can never pay a live
  transaction, and the reverse is also refused (`livemode_mismatch`).

## Billing lifecycle

| Event | What happens |
|---|---|
| Renewal | The org admin pays the next period from the billing page. A renewal paid early starts when the current period ends, so no time is lost. There are **no automatic card charges**; each period is a hosted checkout. |
| Reminders | The daily job notifies org admins 7, 3 and 1 days before the period ends. |
| Lapse | After the period ends, the status is `past_due`, and paid features stay on for a **3-day grace period**. After that it is `expired` and paid features turn off. **Public-safety features never turn off.** |
| Upgrade | Starts a checkout for the new plan immediately. The new period starts on payment. **There is no proration**: unused time on the old plan is not credited. |
| Downgrade | Scheduled. It takes effect at the end of the period (`pendingPlanId`), and the org then pays the new plan. |
| Cancel | `cancelAtPeriodEnd`. Features stay on until the period ends, and the cancellation can be undone before then. |
| Offline or contract payment | The Super Admin records it at `/super/revenue` (`provider: "manual"`), with a reference. |

Expiry does not depend on the daily job running. Entitlement checks compute
the live status from `currentPeriodEnd`.

## Sandbox mode (demo transactions)

With `PAYMENTS_DEMO_ENABLED=true`, or `PAYMENT_PROVIDER=demo`, checkout
sends the user to `/checkout/demo/:txId`. That page simulates a successful
or failed payment through `POST /api/billing/demo/:txId/complete`.

Sandbox transactions are always `isDemo: true`:
- **They are excluded from real revenue.** `splitRealDemo()` and
  `revenue_records.real` vs `.demo` keep them apart.
- **They are labelled "Sandbox" everywhere they appear.**
- **The completion endpoint refuses any transaction that is not `isDemo`**,
  so the sandbox can never mark real money as paid.

## Revenue figures

The Super Admin dashboard (`/super`, `/super/revenue`) reads actual billing
records:
- MRR, ARR, active subscriptions and churn, split into **real (live
  payments)** and **sandbox / demo**;
- collected revenue per month from `revenue_records` (recomputed daily, or
  on demand).

The **Business model** page (`/business-model`) is a separate revenue
simulator. Every figure there is labelled a **hypothetical projection**, and
none of it is mixed into the real numbers.

## Going live checklist

Neither PayMongo nor Xendit has been exercised against the real provider
yet; both adapters are unit-tested against the documented contracts. Before
accepting real money:

1. **Test keys.** Create PayMongo test keys (`sk_test_…`) or Xendit
   development keys, and set `PAYMENT_PROVIDER`.
2. **Webhooks.** Register the webhook URL ([DEPLOYMENT.md](DEPLOYMENT.md#payment-webhooks))
   and set `PAYMONGO_WEBHOOK_SECRET` or `XENDIT_CALLBACK_TOKEN`.
3. **Successful payment.** Run a test checkout end to end for each payment
   method you will offer (card, GCash, Maya, …). Check that:
   - the transaction becomes `paid`;
   - an invoice is issued;
   - the entitlements switch on.
4. **Replay.** Re-send the same webhook from the provider dashboard. It must
   be a no-op.
5. **Failure and expiry.** Let a checkout expire, and make a failed payment.
   Neither may grant anything.
6. **Go live.** Only then switch to live keys and set
   `PAYMENTS_DEMO_ENABLED=false`.

Merchant onboarding with PayMongo or Xendit (business verification) is an
external approval step this project cannot do for you.
