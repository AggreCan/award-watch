// The payments source (phase 3). Taking payment needs a legal entity, so
// none is wired in: paymentSource() returns the stub, /account/billing
// answers 404, and the entitlements table keeps 'stripe' as a source for the
// rows a real implementation will write. A real source implements this
// interface and paymentSource() returns it; no caller changes.
//
// What a source does: hand back an address where the user pays for a plan
// and one where they manage what they pay for, and turn a signed notice from
// the payment service into entitlement rows (one per paid period, its
// reference the service's own id, never a card or an address). Revocation
// and refunds arrive the same way, as rows ended or revoked.

import type { Env } from "../env";
import type { Plan } from "./entitlements";

export type EntitlementGrant = {
  userId: string;
  plan: Plan;
  startsAt: string;
  endsAt: string | null;
  reference: string;
};

export type NoticeResult =
  | { ok: true; grants: EntitlementGrant[]; revoke: string[] }
  | { ok: false };

export interface PaymentSource {
  readonly kind: "stub" | "stripe";
  // Whether payments can be taken at all; the account pages show no
  // payment link while this is false.
  available(): boolean;
  checkoutUrl(input: { userId: string; plan: Plan; returnUrl: string }): Promise<string | null>;
  portalUrl(input: { userId: string; returnUrl: string }): Promise<string | null>;
  // A notice from the payment service, checked against its signature; the
  // rows to write and the references to revoke. Never trusts an unsigned
  // body.
  readNotice(request: Request): Promise<NoticeResult>;
}

export const stubPayments: PaymentSource = {
  kind: "stub",
  available: () => false,
  checkoutUrl: async () => null,
  portalUrl: async () => null,
  readNotice: async () => ({ ok: false }),
};

export function paymentSource(_env: Env): PaymentSource {
  return stubPayments;
}
