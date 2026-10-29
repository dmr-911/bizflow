import type { DB } from "../db";
import { nowIso } from "../db";

/**
 * Subscription state lives in the control database. Stripe renews itself and
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

export function getSubscription(db: DB, accountId: number): Subscription {
  const row = db
    .prepare(
      `SELECT account_id AS accountId, status, provider, trial_ends_at AS trialEndsAt, current_period_end AS currentPeriodEnd,
              cancel_at_period_end AS cancelAtPeriodEnd, stripe_customer_id AS stripeCustomerId,
              stripe_subscription_id AS stripeSubscriptionId
       FROM subscriptions WHERE account_id = ?`,
    )
    .get(accountId) as (Omit<Subscription, "cancelAtPeriodEnd"> & { cancelAtPeriodEnd: number }) | undefined;
  if (!row) {
    return { accountId, status: "canceled", provider: null, trialEndsAt: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, stripeCustomerId: null, stripeSubscriptionId: null };
  }
  return { ...row, cancelAtPeriodEnd: !!row.cancelAtPeriodEnd };
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
export function claimWebhookEvent(db: DB, provider: Provider, eventId: string): boolean {
  const res = db
    .prepare("INSERT OR IGNORE INTO webhook_events (provider, event_id, received_at) VALUES (?, ?, ?)")
    .run(provider, eventId, nowIso());
  return res.changes > 0;
}

export function releaseWebhookEvent(db: DB, provider: Provider, eventId: string): void {
  db.prepare("DELETE FROM webhook_events WHERE provider = ? AND event_id = ?").run(provider, eventId);
}

// ---------- Stripe ----------

export function setStripeCustomer(db: DB, accountId: number, customerId: string): void {
  db.prepare("UPDATE subscriptions SET stripe_customer_id = ?, updated_at = ? WHERE account_id = ?").run(customerId, nowIso(), accountId);
}

export function accountForStripeCustomer(db: DB, customerId: string): number | null {
  const row = db.prepare("SELECT account_id AS id FROM subscriptions WHERE stripe_customer_id = ?").get(customerId) as { id: number } | undefined;
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

/** Mirror a Stripe subscription onto the account. Safe to call repeatedly and out of order. */
export function syncStripeSubscription(db: DB, s: StripeSubscriptionSnapshot): Subscription {
  const current = getSubscription(db, s.accountId);
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
  db.prepare(
    `UPDATE subscriptions SET status = ?, provider = 'stripe', current_period_end = ?, cancel_at_period_end = ?,
       stripe_customer_id = ?, stripe_subscription_id = ?, updated_at = ? WHERE account_id = ?`,
  ).run(
    status,
    periodEnd,
    s.cancelAtPeriodEnd ? 1 : 0,
    s.customerId,
    status === "canceled" ? null : s.subscriptionId,
    nowIso(),
    s.accountId,
  );
  return getSubscription(db, s.accountId);
}

export function recordStripeInvoice(
  db: DB,
  p: { accountId: number; invoiceId: string; amount: number; currency: string; paid: boolean; periodStart: number | null; periodEnd: number | null },
): void {
  const iso = (u: number | null) => (u ? new Date(u * 1000).toISOString() : null);
  const now = nowIso();
  db.prepare(
    `INSERT INTO billing_payments (account_id, provider, provider_ref, amount, currency, status, period_start, period_end, created_at, updated_at)
     VALUES (?, 'stripe', ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, provider_ref) DO UPDATE SET status = excluded.status, amount = excluded.amount, updated_at = excluded.updated_at`,
  ).run(p.accountId, p.invoiceId, p.amount, p.currency.toUpperCase(), p.paid ? "paid" : "failed", iso(p.periodStart), iso(p.periodEnd), now, now);
}

// ---------- bKash ----------

export function createPendingBkashPayment(db: DB, accountId: number, paymentId: string, amount: number): void {
  const now = nowIso();
  db.prepare(
    `INSERT INTO billing_payments (account_id, provider, provider_ref, amount, currency, status, created_at, updated_at)
     VALUES (?, 'bkash', ?, ?, 'BDT', 'pending', ?, ?)`,
  ).run(accountId, paymentId, amount, now, now);
}

export function pendingBkashPayment(db: DB, paymentId: string): { accountId: number; amount: number; status: string } | null {
  const row = db
    .prepare("SELECT account_id AS accountId, amount, status FROM billing_payments WHERE provider = 'bkash' AND provider_ref = ?")
    .get(paymentId) as { accountId: number; amount: number; status: string } | undefined;
  return row ?? null;
}

/**
 * Mark a bKash payment completed and extend access by one month from whichever
 * is later: now, the end of the trial, or the current paid-through date.
 * Idempotent: a payment already marked paid changes nothing.
 */
export function completeBkashPayment(db: DB, paymentId: string, trxId: string): { extended: boolean; periodEnd: string | null } {
  return db.transaction(() => {
    const p = pendingBkashPayment(db, paymentId);
    if (!p) throw new Error("Unknown bKash payment");
    if (p.status === "paid") return { extended: false, periodEnd: getSubscription(db, p.accountId).currentPeriodEnd };
    const sub = getSubscription(db, p.accountId);
    const now = nowIso();
    const start = latest(now, sub.currentPeriodEnd, sub.status === "trialing" ? sub.trialEndsAt : null)!;
    const end = addMonthsIso(start, 1);
    db.prepare(
      `UPDATE billing_payments SET status = 'paid', trx_id = ?, period_start = ?, period_end = ?, updated_at = ?
       WHERE provider = 'bkash' AND provider_ref = ?`,
    ).run(trxId, start, end, now, paymentId);
    // A Stripe subscription, if any, keeps its own status; bKash only moves the paid-through date.
    const keepStripe = sub.provider === "stripe" && sub.status !== "canceled";
    db.prepare(
      `UPDATE subscriptions SET status = ?, provider = ?, current_period_end = ?, updated_at = ? WHERE account_id = ?`,
    ).run(keepStripe ? sub.status : "active", keepStripe ? "stripe" : "bkash", end, now, p.accountId);
    return { extended: true, periodEnd: end };
  })();
}

export function failBkashPayment(db: DB, paymentId: string, status: "failed" | "cancelled"): void {
  db.prepare(
    "UPDATE billing_payments SET status = ?, updated_at = ? WHERE provider = 'bkash' AND provider_ref = ? AND status = 'pending'",
  ).run(status, nowIso(), paymentId);
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

export function listBillingPayments(db: DB, accountId: number, limit = 24): BillingPayment[] {
  return db
    .prepare(
      `SELECT id, provider, provider_ref AS reference, trx_id AS trxId, amount, currency, status, period_start AS periodStart,
              period_end AS periodEnd, created_at AS createdAt
       FROM billing_payments WHERE account_id = ? AND status != 'pending' ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(accountId, limit) as BillingPayment[];
}
