import { timingSafeEqual } from "node:crypto";
import type { CheckoutRequest, CheckoutResult, PaymentProvider, WebhookVerification } from "./types";

/**
 * Xendit adapter — Invoices API (hosted payment page with GCash, Maya,
 * cards, bank transfer) + callback-token verified webhooks.
 * Docs: https://developers.xendit.co/api-reference/#create-invoice
 * Verification: header `x-callback-token` must equal the account's
 * callback verification token (constant-time comparison).
 * Status: implemented against the documented contract; must be exercised
 * with Xendit test keys before going live.
 */
export interface XenditConfig {
  secretKey: string;
  callbackToken: string;
  fetchImpl?: typeof fetch;
}

export function createXenditProvider(cfg: XenditConfig): PaymentProvider {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const auth = `Basic ${Buffer.from(`${cfg.secretKey}:`).toString("base64")}`;
  const livemode = cfg.secretKey.startsWith("xnd_production_");
  return {
    name: "xendit",

    async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
      const res = await fetchImpl("https://api.xendit.co/v2/invoices", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: JSON.stringify({
          external_id: req.tx.id,
          amount: req.tx.amountPhp,
          currency: "PHP",
          description: `${req.orgName} — ${req.tx.description}`.slice(0, 255),
          success_redirect_url: req.successUrl,
          failure_redirect_url: req.cancelUrl,
          invoice_duration: 86400,
          ...(req.customerEmail ? { payer_email: req.customerEmail } : {}),
          metadata: { orgId: req.tx.orgId },
        }),
      });
      const json = (await res.json()) as { id?: string; invoice_url?: string; message?: string };
      if (!res.ok || !json.invoice_url || !json.id) throw new Error(`Xendit invoice failed: ${json.message ?? res.status}`);
      return { checkoutUrl: json.invoice_url, providerRef: json.id, livemode };
    },

    verifyWebhook(rawBody: string, headers: Headers): WebhookVerification {
      const token = headers.get("x-callback-token") ?? "";
      const a = Buffer.from(token);
      const b = Buffer.from(cfg.callbackToken);
      if (!cfg.callbackToken || a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: "invalid callback token" };
      let body: { id?: string; external_id?: string; status?: string; paid_amount?: number; amount?: number };
      try {
        body = JSON.parse(rawBody);
      } catch {
        return { valid: false, reason: "invalid JSON" };
      }
      const status = (body.status ?? "").toUpperCase();
      const type = status === "PAID" || status === "SETTLED" ? "payment.paid" : status === "EXPIRED" ? "payment.expired" : status === "FAILED" ? "payment.failed" : null;
      if (!type) return { valid: true, event: null };
      const amount = body.paid_amount ?? body.amount;
      return {
        valid: true,
        event: {
          provider: "xendit",
          // Invoice callbacks carry no separate event id: invoice id + status is unique per transition.
          eventId: `${body.id}:${status}`,
          type,
          reference: body.external_id ?? null,
          providerRef: body.id ?? null,
          amountMinor: typeof amount === "number" ? Math.round(amount * 100) : null,
          livemode,
          raw: body,
        },
      };
    },
  };
}
