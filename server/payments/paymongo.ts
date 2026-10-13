import { createHmac, timingSafeEqual } from "node:crypto";
import type { CheckoutRequest, CheckoutResult, PaymentProvider, WebhookVerification } from "./types";

/**
 * PayMongo adapter — hosted Checkout Sessions + signed webhooks.
 * Docs: https://developers.paymongo.com/docs/checkout-api ,
 *       https://developers.paymongo.com/docs/securing-webhook
 *
 * Verification: header `Paymongo-Signature: t=<ts>,te=<test sig>,li=<live sig>`,
 * signature = HMAC-SHA256(webhook secret, `${t}.${rawBody}`); compare against
 * `te` for test-mode events and `li` for live events.
 * Status: implemented against the documented contract; must be exercised
 * with PayMongo test keys before going live (see docs/PAYMENTS.md).
 */
export interface PayMongoConfig {
  secretKey: string;
  webhookSecret: string;
  paymentMethods: string[];
  toleranceSeconds?: number;
  fetchImpl?: typeof fetch;
}

export function paymongoSignature(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function createPayMongoProvider(cfg: PayMongoConfig): PaymentProvider {
  const fetchImpl = cfg.fetchImpl ?? fetch;
  const auth = `Basic ${Buffer.from(`${cfg.secretKey}:`).toString("base64")}`;
  return {
    name: "paymongo",

    async createCheckout(req: CheckoutRequest): Promise<CheckoutResult> {
      const res = await fetchImpl("https://api.paymongo.com/v1/checkout_sessions", {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          data: {
            attributes: {
              line_items: [{ name: req.tx.description.slice(0, 255), amount: req.tx.amountMinor, currency: "PHP", quantity: 1 }],
              payment_method_types: cfg.paymentMethods,
              reference_number: req.tx.id,
              description: `${req.orgName} — ${req.tx.description}`.slice(0, 255),
              success_url: req.successUrl,
              cancel_url: req.cancelUrl,
              send_email_receipt: Boolean(req.customerEmail),
              show_description: true,
              show_line_items: true,
              metadata: { txId: req.tx.id, orgId: req.tx.orgId },
              ...(req.customerEmail ? { billing: { email: req.customerEmail } } : {}),
            },
          },
        }),
      });
      const json = (await res.json()) as { data?: { id: string; attributes: { checkout_url: string; livemode?: boolean } }; errors?: { detail: string }[] };
      if (!res.ok || !json.data) throw new Error(`PayMongo checkout failed: ${json.errors?.map((e) => e.detail).join("; ") ?? res.status}`);
      return { checkoutUrl: json.data.attributes.checkout_url, providerRef: json.data.id, livemode: Boolean(json.data.attributes.livemode) };
    },

    verifyWebhook(rawBody: string, headers: Headers): WebhookVerification {
      const header = headers.get("paymongo-signature");
      if (!header) return { valid: false, reason: "missing Paymongo-Signature header" };
      const parts = Object.fromEntries(
        header.split(",").map((p) => {
          const i = p.indexOf("=");
          return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
        })
      ) as Record<string, string>;
      if (!parts.t) return { valid: false, reason: "malformed signature header" };
      const age = Math.abs(Date.now() / 1000 - Number(parts.t));
      if (!Number.isFinite(age) || age > (cfg.toleranceSeconds ?? 300)) return { valid: false, reason: "stale or invalid timestamp" };

      let body: { data?: { id?: string; attributes?: { type?: string; livemode?: boolean; data?: { id?: string; attributes?: Record<string, unknown> } } } };
      try {
        body = JSON.parse(rawBody);
      } catch {
        return { valid: false, reason: "invalid JSON" };
      }
      const livemode = Boolean(body.data?.attributes?.livemode);
      const expected = paymongoSignature(cfg.webhookSecret, parts.t, rawBody);
      const given = livemode ? parts.li : parts.te;
      if (!safeEqualHex(expected, given ?? "")) return { valid: false, reason: "signature mismatch" };

      const type = body.data?.attributes?.type ?? "";
      const resource = body.data?.attributes?.data;
      const attrs = (resource?.attributes ?? {}) as Record<string, unknown>;
      const metadata = (attrs.metadata ?? {}) as Record<string, string>;
      const map: Record<string, "payment.paid" | "payment.failed" | "payment.expired" | undefined> = {
        "checkout_session.payment.paid": "payment.paid",
        "payment.paid": "payment.paid",
        "payment.failed": "payment.failed",
        "checkout_session.expired": "payment.expired",
      };
      const normalized = map[type];
      if (!normalized) return { valid: true, event: null }; // signed but irrelevant event
      const lineTotal = Array.isArray(attrs.line_items)
        ? (attrs.line_items as { amount: number; quantity: number }[]).reduce((s, li) => s + li.amount * (li.quantity ?? 1), 0)
        : null;
      const paidAmount = Array.isArray(attrs.payments)
        ? (attrs.payments as { attributes?: { amount?: number } }[]).reduce((s, p) => s + (p.attributes?.amount ?? 0), 0)
        : typeof attrs.amount === "number"
        ? (attrs.amount as number)
        : lineTotal;
      return {
        valid: true,
        event: {
          provider: "paymongo",
          eventId: body.data?.id ?? "",
          type: normalized,
          reference: (attrs.reference_number as string) ?? metadata.txId ?? null,
          providerRef: resource?.id ?? null,
          amountMinor: paidAmount ?? null,
          livemode,
          raw: body,
        },
      };
    },
  };
}
