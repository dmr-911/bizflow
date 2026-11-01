import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getTenantDb, withClock, type Db } from "@/lib/db";
import { handleStripeEvent } from "@/lib/billing/stripe-events";
import { createAccount, deleteAccount } from "@/lib/services/auth";
import {
  accessState,
  addMonthsIso,
  claimWebhookEvent,
  completeBkashPayment,
  createPendingBkashPayment,
  failBkashPayment,
  getSubscription,
  listBillingPayments,
  setStripeCustomer,
} from "@/lib/services/billing";
import { createCustomer, getCustomer, listCustomers } from "@/lib/services/customers";
import { exportBackup, restoreBackup } from "@/lib/services/data";
import { createDocument, getDocument, listDocuments, markInvoiceSent, recordPayment } from "@/lib/services/documents";
import { createFollowUp } from "@/lib/services/followups";
import { dashboardStats } from "@/lib/services/reports";
import { seedDemoData } from "@/lib/services/seed";
import { pgFailure, useTestDatabase } from "./helpers/db";
import { documents, followUps } from "@/lib/db/schema";

useTestDatabase();

const NOW = "2026-10-29T10:00:00.000Z";
const DAY = 86_400_000;
const plus = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

let control: Db;
let accountId: number;

beforeEach(async () => {
  control = await getDb();
  accountId = (
    await withClock(NOW, () =>
      createAccount(control, { name: "Rana", businessName: "Nogor Studio", email: "rana@example.com", password: "a long password" }, { trialDays: 14 }),
    )
  ).accountId;
});

describe("access rules", () => {
  it("allows the trial, then blocks when it ends", async () => {
    const sub = await getSubscription(control, accountId);
    expect(sub.trialEndsAt).toBe(plus(NOW, 14));
    expect(accessState(sub, NOW)).toMatchObject({ allowed: true, state: "trial", daysLeft: 14 });
    expect(accessState(sub, plus(NOW, 13.5))).toMatchObject({ allowed: true, daysLeft: 1 });
    expect(accessState(sub, plus(NOW, 14))).toMatchObject({ allowed: false, state: "trial_ended" });
  });

  it("gives renewing subscribers a short grace period but not cancelled ones", async () => {
    const end = plus(NOW, 30);
    const active = { ...(await getSubscription(control, accountId)), status: "active" as const, currentPeriodEnd: end };
    expect(accessState(active, plus(NOW, 29)).state).toBe("active");
    expect(accessState(active, plus(NOW, 31))).toMatchObject({ allowed: true, state: "grace" });
    expect(accessState(active, plus(NOW, 34))).toMatchObject({ allowed: false, state: "expired" });
    expect(accessState({ ...active, status: "canceled" }, plus(NOW, 31)).allowed).toBe(false);
  });

  it("adds calendar months, clamping short months", () => {
    expect(addMonthsIso("2026-01-31T05:00:00.000Z", 1)).toBe("2026-02-28T05:00:00.000Z");
    expect(addMonthsIso("2028-01-31T05:00:00.000Z", 1)).toBe("2028-02-29T05:00:00.000Z");
    expect(addMonthsIso("2026-12-15T00:00:00.000Z", 1)).toBe("2027-01-15T00:00:00.000Z");
  });
});

describe("bKash payments", () => {
  it("adds a month after the remaining trial, once per payment", async () => {
    await withClock(plus(NOW, 4), async () => {
      await createPendingBkashPayment(control, accountId, "TR0001", 60000);
      const first = await completeBkashPayment(control, "TR0001", "BKX1");
      // 10 trial days were left, so paying early does not cost the customer those days.
      expect(first).toEqual({ extended: true, periodEnd: addMonthsIso(plus(NOW, 14), 1) });
      expect((await completeBkashPayment(control, "TR0001", "BKX1")).extended).toBe(false);
    });
    const sub = await getSubscription(control, accountId);
    expect(sub).toMatchObject({ status: "active", provider: "bkash", currentPeriodEnd: addMonthsIso(plus(NOW, 14), 1) });
    expect(await listBillingPayments(control, accountId)).toMatchObject([{ provider: "bkash", trxId: "BKX1", amount: 60000, currency: "BDT", status: "paid" }]);
  });

  it("stacks months and restarts from today after a lapse", async () => {
    await withClock(plus(NOW, 20), async () => {
      await createPendingBkashPayment(control, accountId, "P1", 60000);
      await createPendingBkashPayment(control, accountId, "P2", 60000);
      await completeBkashPayment(control, "P1", "T1");
      await completeBkashPayment(control, "P2", "T2");
    });
    expect((await getSubscription(control, accountId)).currentPeriodEnd).toBe(addMonthsIso(addMonthsIso(plus(NOW, 20), 1), 1));
  });

  it("records cancelled payments without granting access", async () => {
    await createPendingBkashPayment(control, accountId, "P3", 60000);
    await failBkashPayment(control, "P3", "cancelled");
    await expect(completeBkashPayment(control, "nope", "T")).rejects.toThrow();
    expect((await getSubscription(control, accountId)).currentPeriodEnd).toBeNull();
    expect((await listBillingPayments(control, accountId))[0].status).toBe("cancelled");
  });
});

function fakeSubscription(over: Partial<Stripe.Subscription> & { periodEnd: string }): Stripe.Subscription {
  const { periodEnd, ...rest } = over;
  return {
    id: "sub_123",
    object: "subscription",
    customer: "cus_123",
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    metadata: { account_id: String(accountId) },
    items: { object: "list", data: [{ current_period_end: unix(periodEnd) }], has_more: false, url: "" },
    ...rest,
  } as unknown as Stripe.Subscription;
}

const event = (type: string, object: unknown, id = `evt_${Math.random()}`) => ({ id, type, data: { object } }) as unknown as Stripe.Event;

describe("Stripe events", () => {
  it("activates on checkout, renews on invoice.paid and ends on deletion", async () => {
    let remote = fakeSubscription({ periodEnd: plus(NOW, 30) });
    const fetchSub = vi.fn(async () => remote);

    await handleStripeEvent(
      control,
      event("checkout.session.completed", { client_reference_id: String(accountId), customer: "cus_123", subscription: "sub_123" }),
      fetchSub,
    );
    let sub = await getSubscription(control, accountId);
    expect(sub).toMatchObject({ status: "active", provider: "stripe", stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_123", currentPeriodEnd: plus(NOW, 30) });

    remote = fakeSubscription({ periodEnd: plus(NOW, 61) });
    await handleStripeEvent(
      control,
      event("invoice.paid", {
        id: "in_2",
        customer: "cus_123",
        currency: "usd",
        amount_paid: 500,
        amount_due: 500,
        parent: { subscription_details: { subscription: "sub_123", metadata: {} } },
        lines: { data: [{ period: { start: unix(plus(NOW, 30)), end: unix(plus(NOW, 61)) } }] },
      }),
      fetchSub,
    );
    expect((await getSubscription(control, accountId)).currentPeriodEnd).toBe(plus(NOW, 61));
    expect(await listBillingPayments(control, accountId)).toMatchObject([{ provider: "stripe", reference: "in_2", amount: 500, currency: "USD", status: "paid" }]);

    await handleStripeEvent(control, event("customer.subscription.deleted", fakeSubscription({ status: "canceled", periodEnd: plus(NOW, 61) })), fetchSub);
    sub = await getSubscription(control, accountId);
    expect(sub).toMatchObject({ status: "canceled", stripeSubscriptionId: null, currentPeriodEnd: plus(NOW, 61) });
    expect(accessState(sub, plus(NOW, 60)).allowed).toBe(true);
    expect(accessState(sub, plus(NOW, 62)).allowed).toBe(false);
  });

  it("finds the account by customer id and never shortens paid time", async () => {
    await setStripeCustomer(control, accountId, "cus_123");
    const late = fakeSubscription({ periodEnd: plus(NOW, 30), metadata: {} });
    await handleStripeEvent(control, event("customer.subscription.updated", late), async () => late);
    // An older event arriving late must not move the date backwards.
    const older = fakeSubscription({ periodEnd: plus(NOW, 2), metadata: {} });
    await handleStripeEvent(control, event("customer.subscription.updated", older), async () => older);
    expect((await getSubscription(control, accountId)).currentPeriodEnd).toBe(plus(NOW, 30));
  });

  it("marks past_due and ignores incomplete checkouts", async () => {
    const incomplete = fakeSubscription({ status: "incomplete", periodEnd: plus(NOW, 30) });
    await handleStripeEvent(control, event("customer.subscription.created", incomplete), async () => incomplete);
    expect((await getSubscription(control, accountId)).status).toBe("trialing");
    const pastDue = fakeSubscription({ status: "past_due", periodEnd: plus(NOW, 30) });
    await handleStripeEvent(control, event("customer.subscription.updated", pastDue), async () => pastDue);
    expect((await getSubscription(control, accountId)).status).toBe("past_due");
  });

  it("verifies webhook signatures and deduplicates retries", async () => {
    const stripe = new Stripe("sk_test_dummy");
    const secret = "whsec_test";
    const payload = JSON.stringify({ id: "evt_1", object: "event", type: "invoice.paid", data: { object: {} } });
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
    expect(stripe.webhooks.constructEvent(payload, header, secret).id).toBe("evt_1");
    expect(() => stripe.webhooks.constructEvent(payload.replace("evt_1", "evt_2"), header, secret)).toThrow();
    expect(await claimWebhookEvent(control, "stripe", "evt_1")).toBe(true);
    expect(await claimWebhookEvent(control, "stripe", "evt_1")).toBe(false);
  });
});

describe("tenant isolation", () => {
  const blank = { company: "", email: "", phone: "", address: "", city: "", country: "", taxId: "", notes: "" };
  const items = [{ description: "Work", quantity: "1", unitPrice: "100", discountType: "percent", discountValue: "0", taxRateId: "none" }];
  const docInput = (customerId: number) => ({ customerId, issueDate: "2026-10-01", dueDate: "2026-10-15", currency: "BDT", notes: "", terms: "", items });
  let otherId: number;
  beforeEach(async () => {
    otherId = (await createAccount(control, { name: "B", businessName: "Other", email: "b@example.com", password: "a long password" }, { trialDays: 14 }))
      .accountId;
  });

  it("keeps each business's records apart in the shared database", async () => {
    const one = await getTenantDb(accountId);
    const two = await getTenantDb(otherId);
    const c1 = await createCustomer(one, { ...blank, name: "Only in business one" });
    const c2 = await createCustomer(two, { ...blank, name: "Only in business two" });
    expect((await listCustomers(one)).map((c) => c.name)).toEqual(["Only in business one"]);
    expect((await listCustomers(two)).map((c) => c.name)).toEqual(["Only in business two"]);
    // Guessing another business's id finds nothing.
    expect(await getCustomer(one, c2.id)).toBeNull();
    const inv = await createDocument(two, "invoice", docInput(c2.id));
    expect(await getDocument(one, inv.id)).toBeNull();
    await expect(markInvoiceSent(one, inv.id)).rejects.toThrow(/not found/);
    // Document numbers are per business: both start at 0001.
    expect((await createDocument(one, "invoice", docInput(c1.id))).number).toBe(inv.number);
  });

  it("refuses links to another business's records, even through raw SQL", async () => {
    const one = await getTenantDb(accountId);
    const two = await getTenantDb(otherId);
    const theirs = await createCustomer(two, { ...blank, name: "Theirs" });
    await expect(createDocument(one, "invoice", docInput(theirs.id))).rejects.toThrow(/Customer not found/);
    await expect(createFollowUp(one, { title: "Call", dueDate: "2026-11-01", customerId: theirs.id })).rejects.toThrow(/not found/);
    // The composite foreign key is the last line of defence.
    expect(
      await pgFailure(
        one.orm.insert(followUps).values({ accountId: one.accountId, title: "x", dueDate: "2026-11-01", customerId: theirs.id, createdAt: "now" }),
      ),
    ).toMatch(/foreign key/);
  });

  it("restores a backup into another business without touching the first", async () => {
    const one = await getTenantDb(accountId);
    const two = await getTenantDb(otherId);
    await seedDemoData(one, "2026-10-29");
    const before = await dashboardStats(one, "2026-10-29");
    await restoreBackup(two, JSON.parse(JSON.stringify(await exportBackup(one))));
    expect(await dashboardStats(two, "2026-10-29")).toEqual(before);
    expect(await dashboardStats(one, "2026-10-29")).toEqual(before);
    // Same ids live side by side, and new rows still get fresh ids afterwards.
    const c = await createCustomer(two, { ...blank, name: "New after restore" });
    expect((await listCustomers(two, { includeArchived: true })).filter((x) => x.id === c.id)).toHaveLength(1);
  });

  it("deleting an account removes all of its business records and nothing else", async () => {
    const one = await getTenantDb(accountId);
    const two = await getTenantDb(otherId);
    await seedDemoData(one, "2026-10-29");
    await seedDemoData(two, "2026-10-29");
    await deleteAccount(control, accountId);
    const left = await control.orm.selectDistinct({ accountId: documents.accountId }).from(documents);
    expect(left).toEqual([{ accountId: otherId }]);
    expect((await listDocuments(two, "invoice")).length).toBeGreaterThan(0);
  });

  it("hands out unique document numbers when requests arrive at the same time", async () => {
    const one = await getTenantDb(accountId);
    const c = await createCustomer(one, { ...blank, name: "Busy" });
    const docs = await Promise.all(Array.from({ length: 8 }, () => createDocument(one, "invoice", docInput(c.id))));
    expect(new Set(docs.map((d) => d.number)).size).toBe(8);
  });

  it("treats ids that are not numbers as not found", async () => {
    const one = await getTenantDb(accountId);
    expect(await getCustomer(one, Number("abc"))).toBeNull();
    expect(await getDocument(one, NaN)).toBeNull();
  });

  it("pays an invoice twice in parallel without losing either payment", async () => {
    const one = await getTenantDb(accountId);
    const c = await createCustomer(one, { ...blank, name: "Payer" });
    const inv = await createDocument(one, "invoice", docInput(c.id));
    await markInvoiceSent(one, inv.id);
    await Promise.all([
      recordPayment(one, inv.id, { amount: "30", paidAt: "2026-10-02", method: "cash" }),
      recordPayment(one, inv.id, { amount: "40", paidAt: "2026-10-02", method: "cash" }),
    ]);
    expect((await getDocument(one, inv.id))!.amountPaid).toBe(7000);
  });
});

describe("bKash client", () => {
  const cfg = { baseUrl: "https://bkash.test/v1.2.0-beta", appKey: "k", appSecret: "s", username: "u", password: "p" };
  afterEach(() => vi.unstubAllGlobals());

  it("grants a token, creates and executes a payment", async () => {
    const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
    const replies: Record<string, unknown> = {
      "/tokenized/checkout/token/grant": { statusCode: "0000", id_token: "tok", expires_in: 3600 },
      "/tokenized/checkout/create": { statusCode: "0000", paymentID: "PAY1", bkashURL: "https://pay.bka.sh/PAY1" },
      "/tokenized/checkout/execute": { statusCode: "0000", transactionStatus: "Completed", trxID: "TRX9", amount: "600.00" },
    };
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const p = url.replace(cfg.baseUrl, "");
      calls.push({ url: p, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(replies[p]), { status: 200 });
    });
    const { createPayment, executePayment } = await import("@/lib/billing/bkash");
    const created = await createPayment(cfg, { amount: 60000, invoiceNumber: "BF1", payerReference: "1", callbackURL: "https://app.test/cb" });
    expect(created).toEqual({ paymentId: "PAY1", bkashURL: "https://pay.bka.sh/PAY1" });
    expect(calls[1].body).toMatchObject({ mode: "0011", amount: "600.00", currency: "BDT", intent: "sale" });
    expect(calls[1].headers).toMatchObject({ Authorization: "tok", "X-APP-Key": "k" });
    expect(await executePayment(cfg, "PAY1")).toEqual({ completed: true, trxId: "TRX9", amount: 60000, status: "Completed" });
    // The token is cached: only one grant call.
    expect(calls.filter((c) => c.url.endsWith("/grant"))).toHaveLength(1);
  });

  it("turns bKash error codes into errors", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ statusCode: "2023", statusMessage: "Insufficient Balance" }), { status: 200 }));
    const { executePayment, BkashError } = await import("@/lib/billing/bkash");
    await expect(executePayment({ ...cfg, appKey: "other" }, "PAY2")).rejects.toBeInstanceOf(BkashError);
  });
});

describe("Stripe events for unknown subscriptions", () => {
  it("ignores the cancellation of a subscription the account does not have", async () => {
    await createPendingBkashPayment(control, accountId, "P9", 60000);
    await completeBkashPayment(control, "P9", "T9");
    const before = await getSubscription(control, accountId);
    const stray = fakeSubscription({ id: "sub_other", status: "canceled", periodEnd: plus(NOW, 5) });
    await handleStripeEvent(control, event("customer.subscription.deleted", stray), async () => stray);
    expect(await getSubscription(control, accountId)).toEqual(before);
  });
});
