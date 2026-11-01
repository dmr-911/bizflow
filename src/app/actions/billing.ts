"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { bkashConfig, BkashError, createPayment } from "@/lib/billing/bkash";
import { stripeClient, stripeLineItem } from "@/lib/billing/stripe";
import { createPendingBkashPayment, getSubscription, PLAN, setStripeCustomer } from "@/lib/services/billing";
import { appUrl } from "@/lib/server/app-url";
import { requireUser } from "@/lib/server/context";
import { tooManyAttempts } from "@/lib/server/rate-limit";

const DAY = 86_400_000;

export async function startStripeCheckoutAction() {
  const user = await requireUser();
  const stripe = stripeClient();
  if (!stripe) redirect("/billing?error=stripe_unavailable");
  const db = await getDb();
  const sub = await getSubscription(db, user.accountId);
  if (sub.stripeSubscriptionId && sub.status !== "canceled") redirect("/billing?error=already_subscribed");
  const base = await appUrl();

  let customerId = sub.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.businessName,
      metadata: { account_id: String(user.accountId) },
    });
    customerId = customer.id;
    await setStripeCustomer(db, user.accountId, customerId);
  }

  // Subscribing during the free trial keeps the remaining trial days (Stripe needs at least 48 hours).
  const trialEnd = sub.status === "trialing" && sub.trialEndsAt ? Date.parse(sub.trialEndsAt) : 0;
  const keepTrial = trialEnd - Date.now() > 2 * DAY;

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: String(user.accountId),
    line_items: [stripeLineItem(PLAN.usdCents, PLAN.name)],
    subscription_data: {
      metadata: { account_id: String(user.accountId) },
      ...(keepTrial ? { trial_end: Math.floor(trialEnd / 1000) } : {}),
    },
    allow_promotion_codes: true,
    success_url: `${base}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/billing?checkout=cancelled`,
  });
  redirect(session.url!);
}

export async function openStripePortalAction() {
  const user = await requireUser();
  const stripe = stripeClient();
  const sub = await getSubscription(await getDb(), user.accountId);
  if (!stripe || !sub.stripeCustomerId) redirect("/billing");
  const portal = await stripe.billingPortal.sessions.create({ customer: sub.stripeCustomerId, return_url: `${await appUrl()}/billing` });
  redirect(portal.url);
}

export async function startBkashPaymentAction() {
  const user = await requireUser();
  const cfg = bkashConfig();
  if (!cfg) redirect("/billing?error=bkash_unavailable");
  if (tooManyAttempts(`bkash|${user.accountId}`, 10, 60 * 60_000)) redirect("/billing?error=too_many");
  let url: string;
  try {
    const amount = PLAN.bdtPoisha;
    const payment = await createPayment(cfg, {
      amount,
      invoiceNumber: `BF${user.accountId}T${Date.now()}`,
      payerReference: String(user.accountId),
      callbackURL: `${await appUrl()}/api/billing/bkash/callback`,
    });
    await createPendingBkashPayment(await getDb(), user.accountId, payment.paymentId, amount);
    url = payment.bkashURL;
  } catch (e) {
    console.error("bKash create payment failed", e instanceof BkashError ? `${e.code} ${e.message}` : e);
    redirect("/billing?error=bkash_failed");
  }
  redirect(url);
}
