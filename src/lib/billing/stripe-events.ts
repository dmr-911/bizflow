import type Stripe from "stripe";
import type { DB } from "../db";
import {
  accountForStripeCustomer,
  recordStripeInvoice,
  setStripeCustomer,
  syncStripeSubscription,
} from "../services/billing";

/** Period end lives on the subscription item since API version 2025-03-31. */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  return sub.items.data.reduce<number | null>((max, i) => Math.max(max ?? 0, i.current_period_end), null);
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === "string" ? v : (v?.id ?? null));

function accountFor(db: DB, customerId: string | null, metadata?: Stripe.Metadata | null): number | null {
  const fromMeta = Number(metadata?.account_id);
  if (Number.isSafeInteger(fromMeta) && fromMeta > 0) return fromMeta;
  return customerId ? accountForStripeCustomer(db, customerId) : null;
}

export function applySubscription(db: DB, sub: Stripe.Subscription, accountId?: number | null): void {
  const customerId = idOf(sub.customer)!;
  const account = accountId ?? accountFor(db, customerId, sub.metadata);
  if (!account) return;
  syncStripeSubscription(db, {
    accountId: account,
    customerId,
    subscriptionId: sub.id,
    status: sub.status,
    currentPeriodEnd: subscriptionPeriodEnd(sub),
    cancelAtPeriodEnd: sub.cancel_at_period_end || !!sub.cancel_at,
  });
}

/**
 * Apply one verified webhook event. `getSubscription` fetches the latest
 * subscription from Stripe, so out-of-order deliveries still end up correct.
 */
export async function handleStripeEvent(
  db: DB,
  event: Stripe.Event,
  getSubscription: (id: string) => Promise<Stripe.Subscription>,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object;
      const accountId = Number(session.client_reference_id);
      const customerId = idOf(session.customer);
      if (!Number.isSafeInteger(accountId) || accountId <= 0 || !customerId) return;
      setStripeCustomer(db, accountId, customerId);
      const subId = idOf(session.subscription);
      if (subId) applySubscription(db, await getSubscription(subId), accountId);
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      // Deleted events carry the final state; for the rest, fetch the latest in case events arrived out of order.
      applySubscription(db, event.type === "customer.subscription.deleted" ? event.data.object : await getSubscription(event.data.object.id));
      return;
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const customerId = idOf(invoice.customer);
      const subId = idOf(invoice.parent?.subscription_details?.subscription);
      const accountId = accountFor(db, customerId, invoice.parent?.subscription_details?.metadata);
      if (!accountId || !invoice.id) return;
      const period = invoice.lines?.data?.[0]?.period;
      recordStripeInvoice(db, {
        accountId,
        invoiceId: invoice.id,
        amount: event.type === "invoice.paid" ? invoice.amount_paid : invoice.amount_due,
        currency: invoice.currency,
        paid: event.type === "invoice.paid",
        periodStart: period?.start ?? null,
        periodEnd: period?.end ?? null,
      });
      if (subId) applySubscription(db, await getSubscription(subId), accountId);
      return;
    }
    default:
      return;
  }
}
