import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { Db } from "../db";
import { idEq, nowIso } from "../db";
import { billingPayments, subscriptions, webhookEvents } from "../db/schema";

/**
 * Subscription state lives in the subscriptions table. Stripe renews itself and
 * tells us through webhooks; bKash payments are one month prepaid each, so the
 * paid-through date simply moves forward by a month per completed payment.
 */

export const PLAN = {
  name: "BizFlow Monthly",
  usdCents: 500,
  /** bKash charges in BDT. Set BKASH_PRICE_BDT to follow the exchange rate. */
  get bdtPoisha() {
    return Math.round((Number(process.env.BKASH_PRICE_BDT) || 600) * 100);
  },
};

export const trialDays = () => {
  const v = Number(process.env.TRIAL_DAYS);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 14;
};

/** Extra days a renewing subscriber keeps access while a payment is retried or a bKash renewal is due. */
const GRACE_DAYS = 3;
const DAY = 86_400_000;

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";
export type Provider = "stripe" | "bkash";

export interface Subscription {
  accountId: number;
  status: SubscriptionStatus;
  provider: Provider | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export interface AccessState {
  allowed: boolean;
  /** What the billing page should say. "grace" means paid-through date passed but access continues briefly. */
  state: "trial" | "active" | "grace" | "trial_ended" | "expired";
  endsAt: string | null;
  daysLeft: number;
}

export async function getSubscription(db: Db, accountId: number): Promise<Subscription> {
  const [row] = await db.orm
    .select({
      accountId: subscriptions.accountId,
      status: subscriptions.status,
      provider: subscriptions.provider,
      trialEndsAt: subscriptions.trialEndsAt,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      stripeCustomerId: subscriptions.stripeCustomerId,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(idEq(subscriptions.accountId, accountId));
  return row ?? { accountId, status: "canceled", provider: null, trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, stripeCustomerId: null, stripeSubscriptionId: null };
}

const daysUntil = (iso: string, now: number) => Math.max(0, Math.ceil((Date.parse(iso) - now) / DAY));

export function accessState(sub: Subscription, now: string = nowIso()): AccessState {
  const t = Date.parse(now);
  const paidThrough = sub.currentPeriodEnd;
  if (paidThrough && Date.parse(paidThrough) > t) {
    return { allowed: true, state: "active", endsAt: paidThrough, daysLeft: daysUntil(paidThrough, t) };
  }
  // Paid subscribers who have not cancelled get a short grace period for renewals.
  if (paidThrough && sub.status !== "canceled" && Date.parse(paidThrough) + GRACE_DAYS * DAY > t) {
    return { allowed: true, state: "grace", endsAt: paidThrough, daysLeft: 0 };
  }
  if (!paidThrough && sub.status === "trialing" && sub.trialEndsAt) {
    const allowed = Date.parse(sub.trialEndsAt) > t;
    return { allowed, state: allowed ? "trial" : "trial_ended", endsAt: sub.trialEndsAt, daysLeft: daysUntil(sub.trialEndsAt, t) };
  }
  return { allowed: false, state: paidThrough ? "expired" : "trial_ended", endsAt: paidThrough ?? sub.trialEndsAt, daysLeft: 0 };
}

/** Add calendar months in UTC, clamping to the last day of shorter months (31 Jan + 1 = 28/29 Feb). */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

function latest(...isos: (string | null | undefined)[]): string | null {
  const present = isos.filter((x): x is string => !!x);
  return present.length ? present.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)) : null;
}

/** Returns true the first time an event id is seen, false for a retry. */
export async function claimWebhookEvent(db: Db, provider: Provider, eventId: string): Promise<boolean> {
  const { rowCount } = await db.orm.insert(webhookEvents).values({ provider, eventId, receivedAt: nowIso() }).onConflictDoNothing();
  return !!rowCount;
}

export async function releaseWebhookEvent(db: Db, provider: Provider, eventId: string): Promise<void> {
  await db.orm.delete(webhookEvents).where(and(eq(webhookEvents.provider, provider), eq(webhookEvents.eventId, eventId)));
}

// ---------- Stripe ----------

export async function setStripeCustomer(db: Db, accountId: number, customerId: string): Promise<void> {
  await db.orm
    .update(subscriptions)
    .set({ stripeCustomerId: customerId, updatedAt: nowIso() })
    .where(idEq(subscriptions.accountId, accountId));
}

export async function accountForStripeCustomer(db: Db, customerId: string): Promise<number | null> {
  const [row] = await db.orm
    .select({ id: subscriptions.accountId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeCustomerId, customerId));
  return row?.id ?? null;
}

export interface StripeSubscriptionSnapshot {
  accountId: number;
  customerId: string;
  subscriptionId: string;
  /** Stripe's own status string. */
  status: string;
  /** Unix seconds. */
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

/** Row lock: two webhooks or callbacks for the same account apply one after the other. Call inside tx. */
async function lockSubscription(db: Db, accountId: number): Promise<void> {
  await db.orm.select({ id: subscriptions.accountId }).from(subscriptions).where(idEq(subscriptions.accountId, accountId)).for("update");
}

/** Mirror a Stripe subscription onto the account. Safe to call repeatedly and out of order. */
export async function syncStripeSubscription(db: Db, s: StripeSubscriptionSnapshot): Promise<Subscription> {
  return db.tx(async (db) => {
    // Lock the row so two webhooks for the same account apply one after the other.
    await lockSubscription(db, s.accountId);
    const current = await getSubscription(db, s.accountId);
    // A payment that never completed should not change anything.
    if (s.status === "incomplete") return current;
    const status: SubscriptionStatus =
      s.status === "active" || s.status === "trialing"
        ? "active"
        : s.status === "past_due" || s.status === "unpaid"
          ? "past_due"
          : "canceled";
    // Ending a subscription we are not tracking (an old or duplicate one) must not touch the account.
    if (status === "canceled" && current.stripeSubscriptionId !== s.subscriptionId) return current;
    const stripeEnd = s.currentPeriodEnd ? new Date(s.currentPeriodEnd * 1000).toISOString() : null;
    // Never shorten time already paid for (for example a bKash month bought earlier).
    const periodEnd = status === "canceled" ? current.currentPeriodEnd : latest(current.currentPeriodEnd, stripeEnd);
    await db.orm
      .update(subscriptions)
      .set({
        status,
        provider: "stripe",
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        stripeCustomerId: s.customerId,
        stripeSubscriptionId: status === "canceled" ? null : s.subscriptionId,
        updatedAt: nowIso(),
      })
      .where(idEq(subscriptions.accountId, s.accountId));
    return getSubscription(db, s.accountId);
  });
}

export async function recordStripeInvoice(
  db: Db,
  p: { accountId: number; invoiceId: string; amount: number; currency: string; paid: boolean; periodStart: number | null; periodEnd: number | null },
): Promise<void> {
  const iso = (u: number | null) => (u ? new Date(u * 1000).toISOString() : null);
  const now = nowIso();
  await db.orm
    .insert(billingPayments)
    .values({
      accountId: p.accountId,
      provider: "stripe",
      providerRef: p.invoiceId,
      amount: p.amount,
      currency: p.currency.toUpperCase(),
      status: p.paid ? "paid" : "failed",
      periodStart: iso(p.periodStart),
      periodEnd: iso(p.periodEnd),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [billingPayments.provider, billingPayments.providerRef],
      set: { status: sql`excluded.status`, amount: sql`excluded.amount`, updatedAt: sql`excluded.updated_at` },
    });
}

// ---------- bKash ----------

export async function createPendingBkashPayment(db: Db, accountId: number, paymentId: string, amount: number): Promise<void> {
  const now = nowIso();
  await db.orm.insert(billingPayments).values({
    accountId,
    provider: "bkash",
    providerRef: paymentId,
    amount,
    currency: "BDT",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
}

const bkashPayment = (paymentId: string) => and(eq(billingPayments.provider, "bkash"), eq(billingPayments.providerRef, paymentId));

export async function pendingBkashPayment(
  db: Db,
  paymentId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<{ accountId: number; amount: number; status: string } | null> {
  const query = db.orm
    .select({ accountId: billingPayments.accountId, amount: billingPayments.amount, status: billingPayments.status })
    .from(billingPayments)
    .where(bkashPayment(paymentId));
  const [row] = await (opts.forUpdate ? query.for("update") : query);
  return row ?? null;
}

/**
 * Mark a bKash payment completed and extend access by one month from whichever
 * is later: now, the end of the trial, or the current paid-through date.
 * Idempotent: a payment already marked paid changes nothing.
 */
export async function completeBkashPayment(db: Db, paymentId: string, trxId: string): Promise<{ extended: boolean; periodEnd: string | null }> {
  return db.tx(async (db) => {
    // Row locks: a repeated callback waits here and then sees the payment already paid.
    const p = await pendingBkashPayment(db, paymentId, { forUpdate: true });
    if (!p) throw new Error("Unknown bKash payment");
    await lockSubscription(db, p.accountId);
    if (p.status === "paid") return { extended: false, periodEnd: (await getSubscription(db, p.accountId)).currentPeriodEnd };
    const sub = await getSubscription(db, p.accountId);
    const now = nowIso();
    const start = latest(now, sub.currentPeriodEnd, sub.status === "trialing" ? sub.trialEndsAt : null)!;
    const end = addMonthsIso(start, 1);
    await db.orm
      .update(billingPayments)
      .set({ status: "paid", trxId, periodStart: start, periodEnd: end, updatedAt: now })
      .where(bkashPayment(paymentId));
    // A Stripe subscription, if any, keeps its own status; bKash only moves the paid-through date.
    const keepStripe = sub.provider === "stripe" && sub.status !== "canceled";
    await db.orm
      .update(subscriptions)
      .set({ status: keepStripe ? sub.status : "active", provider: keepStripe ? "stripe" : "bkash", currentPeriodEnd: end, updatedAt: now })
      .where(idEq(subscriptions.accountId, p.accountId));
    return { extended: true, periodEnd: end };
  });
}

export async function failBkashPayment(db: Db, paymentId: string, status: "failed" | "cancelled"): Promise<void> {
  await db.orm
    .update(billingPayments)
    .set({ status, updatedAt: nowIso() })
    .where(and(bkashPayment(paymentId), eq(billingPayments.status, "pending")));
}

export interface BillingPayment {
  id: number;
  provider: Provider;
  reference: string;
  trxId: string;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "failed" | "cancelled";
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

export async function listBillingPayments(db: Db, accountId: number, limit = 24): Promise<BillingPayment[]> {
  return db.orm
    .select({
      id: billingPayments.id,
      provider: billingPayments.provider,
      reference: billingPayments.providerRef,
      trxId: billingPayments.trxId,
      amount: billingPayments.amount,
      currency: billingPayments.currency,
      status: billingPayments.status,
      periodStart: billingPayments.periodStart,
      periodEnd: billingPayments.periodEnd,
      createdAt: billingPayments.createdAt,
    })
    .from(billingPayments)
    .where(and(idEq(billingPayments.accountId, accountId), ne(billingPayments.status, "pending")))
    .orderBy(desc(billingPayments.createdAt), desc(billingPayments.id))
    .limit(limit);
}
