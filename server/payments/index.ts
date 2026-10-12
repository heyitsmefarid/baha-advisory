import { env, envFlag } from "../lib/env";
import { HttpError } from "../lib/http";
import { createPayMongoProvider } from "./paymongo";
import { createXenditProvider } from "./xendit";
import type { PaymentProvider } from "./types";
import type { PaymentProviderName } from "../../shared/types";

/**
 * Sandbox provider: no money moves. Checkout goes to /checkout/demo/:txId
 * where an org admin simulates success/failure; the result runs through
 * the SAME processor as real webhooks. Every record is flagged isDemo and
 * excluded from real revenue. Disable with PAYMENTS_DEMO_ENABLED=false.
 */
const demoProvider: PaymentProvider = {
  name: "demo",
  async createCheckout(req) {
    return { checkoutUrl: `/checkout/demo/${encodeURIComponent(req.tx.id)}`, providerRef: `demo_${req.tx.id}`, livemode: false };
  },
  verifyWebhook() {
    // Demo events never arrive by webhook — see handlers/billing.ts demoComplete.
    return { valid: false, reason: "demo provider has no webhook" };
  },
};

export function demoPaymentsEnabled(): boolean {
  return envFlag("PAYMENTS_DEMO_ENABLED", true);
}

export function getProvider(name?: PaymentProviderName): PaymentProvider {
  const chosen = name ?? (env("PAYMENT_PROVIDER", "demo") as PaymentProviderName);
  if (chosen === "paymongo") {
    if (!env("PAYMONGO_SECRET_KEY") || !env("PAYMONGO_WEBHOOK_SECRET")) throw new HttpError(503, "PayMongo is not configured.", "payments_unconfigured");
    return createPayMongoProvider({
      secretKey: env("PAYMONGO_SECRET_KEY"),
      webhookSecret: env("PAYMONGO_WEBHOOK_SECRET"),
      paymentMethods: env("PAYMONGO_PAYMENT_METHODS", "card,gcash,paymaya,grab_pay").split(",").map((s) => s.trim()).filter(Boolean),
    });
  }
  if (chosen === "xendit") {
    if (!env("XENDIT_SECRET_KEY") || !env("XENDIT_CALLBACK_TOKEN")) throw new HttpError(503, "Xendit is not configured.", "payments_unconfigured");
    return createXenditProvider({ secretKey: env("XENDIT_SECRET_KEY"), callbackToken: env("XENDIT_CALLBACK_TOKEN") });
  }
  if (!demoPaymentsEnabled()) throw new HttpError(503, "Sandbox payments are disabled and no live provider is configured.", "payments_unconfigured");
  return demoProvider;
}
