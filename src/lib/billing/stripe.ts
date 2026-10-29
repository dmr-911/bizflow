import "server-only";
import Stripe from "stripe";

let client: Stripe | null = null;

/** Null when STRIPE_SECRET_KEY is not set, so the app runs without card payments configured. */
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) client = new Stripe(key, { appInfo: { name: "BizFlow" }, maxNetworkRetries: 2 });
  return client;
}

/** A fixed price from the dashboard if configured, otherwise an inline US$5/month price. */
export function stripeLineItem(usdCents: number, name: string): Stripe.Checkout.SessionCreateParams.LineItem {
  const price = process.env.STRIPE_PRICE_ID;
  if (price) return { price, quantity: 1 };
  return {
    quantity: 1,
    price_data: { currency: "usd", unit_amount: usdCents, recurring: { interval: "month" }, product_data: { name } },
  };
}
