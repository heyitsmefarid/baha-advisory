import type { PaymentProviderName, PaymentTransaction } from "../../shared/types";

/** Provider-agnostic payment event, produced only from a VERIFIED webhook. */
export interface NormalizedPaymentEvent {
  provider: PaymentProviderName;
  /** Provider's event id — the idempotency key. */
  eventId: string;
  type: "payment.paid" | "payment.failed" | "payment.expired";
  /** Our payment_transactions id (sent to the provider as reference). */
  reference: string | null;
  /** Provider-side checkout / invoice id. */
  providerRef: string | null;
  /** Amount actually paid, in centavos. */
  amountMinor: number | null;
  livemode: boolean;
  raw?: unknown;
}

export interface CheckoutRequest {
  tx: PaymentTransaction;
  orgName: string;
  customerEmail: string | null;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  providerRef: string;
  livemode: boolean;
}

export interface WebhookVerification {
  valid: boolean;
  reason?: string;
  event?: NormalizedPaymentEvent | null;
}

/**
 * Adapter contract. Swapping PayMongo ↔ Xendit (or adding another
 * Philippine provider) only means implementing these two methods; the
 * subscription logic never sees provider-specific payloads.
 */
export interface PaymentProvider {
  name: PaymentProviderName;
  createCheckout(req: CheckoutRequest): Promise<CheckoutResult>;
  verifyWebhook(rawBody: string, headers: Headers): WebhookVerification;
}
