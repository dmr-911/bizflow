import type Stripe from "stripe";
import { getDb } from "@/lib/db";
import { stripeClient } from "@/lib/billing/stripe";
import { handleStripeEvent } from "@/lib/billing/stripe-events";
import { claimWebhookEvent, releaseWebhookEvent } from "@/lib/services/billing";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = stripeClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return new Response("Stripe is not configured", { status: 503 });

  let event: Stripe.Event;
  try {
    // The signature covers the exact bytes, so read the raw body.
    event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const db = await getDb();
  if (!(await claimWebhookEvent(db, "stripe", event.id))) return Response.json({ received: true, duplicate: true });
  try {
    await handleStripeEvent(db, event, (id) => stripe.subscriptions.retrieve(id));
  } catch (e) {
    // Let Stripe retry later.
    await releaseWebhookEvent(db, "stripe", event.id);
    console.error("Stripe webhook failed", event.type, event.id, e);
    return new Response("Webhook handler failed", { status: 500 });
  }
  return Response.json({ received: true });
}
