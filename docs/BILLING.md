# Billing: Stripe and bKash

BizFlow is sold as one plan: **US$5/month by card (Stripe)** or **৳600/month by bKash** (`BKASH_PRICE_BDT`). New accounts get a free trial (`TRIAL_DAYS`, default 14) with no payment details.

All keys are read from environment variables. Nothing secret is committed; `.env` is git-ignored. Either provider can be left unconfigured; its button is then shown as unavailable.

## How access works

The control database has one `subscriptions` row per account (see [DATABASE.md](DATABASE.md)). `accessState()` in `src/lib/services/billing.ts` decides access:

| Situation | Access |
| --- | --- |
| Trial and `trial_ends_at` in the future | Yes |
| Paid-through date (`current_period_end`) in the future | Yes |
| Paid-through date passed less than 3 days ago, not cancelled | Yes (grace period, banner shown) |
| Anything else | No: every app page redirects to **Billing** |

Lapsed accounts can still open Billing, download the JSON backup and CSV exports, and delete their account. Data is never deleted because a payment is missed.

| | Stripe | bKash |
| --- | --- | --- |
| Charge | US$5, renews monthly until cancelled | ৳600 for one month, no auto-renewal |
| Source of truth | Stripe webhooks (plus an immediate check when the customer returns from Checkout) | Execute / Query Payment API on the callback |
| Paying during the trial | Stripe subscription starts with `trial_end` = the BizFlow trial end, so no free days are lost | The month starts when the trial ends |
| Cancel | Stripe customer portal (Billing → Open billing portal); access continues to period end | Nothing to cancel |

Each payment is recorded in `billing_payments` and shown in the Billing page's history.

## Stripe

### Test mode (development)

1. Create a Stripe account at <https://dashboard.stripe.com/register>. You stay in **test mode** until you activate the account.
2. **Developers → API keys**: copy the *Secret key* (`sk_test_...`) into `STRIPE_SECRET_KEY`.
3. Forward webhooks to your machine with the [Stripe CLI](https://docs.stripe.com/stripe-cli):
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/billing/stripe/webhook
   ```
   It prints a signing secret (`whsec_...`): put it in `STRIPE_WEBHOOK_SECRET` and restart the app.
4. **Settings → Billing → Customer portal**: activate the portal and allow customers to cancel and update payment methods.
5. Sign up in BizFlow, open **Billing → Subscribe with card**, and pay with test card `4242 4242 4242 4242`, any future expiry, any CVC. Useful others: `4000 0000 0000 9995` (declined), `4000 0025 0000 3155` (3-D Secure).

Optional: create a Product "BizFlow Monthly" with a recurring US$5/month Price and set `STRIPE_PRICE_ID=price_...`. Without it, Checkout uses an inline US$5/month price, which is fine but shows less nicely in Stripe reports.

### Going live

1. **Activate payments** in the Stripe dashboard: business details, bank account for payouts, identity verification. Stripe supports Bangladesh-based businesses only through a company registered in a supported country (for example via Stripe Atlas, or an existing US/UK/EU/Singapore entity); check <https://stripe.com/global> for your situation. If that is not possible, launch with bKash only (leave the Stripe variables empty).
2. Switch the dashboard to live mode and copy the live secret key (`sk_live_...`).
3. **Developers → Webhooks → Add endpoint**: URL `https://<your-domain>/api/billing/stripe/webhook`, events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`.
   Copy the endpoint's signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Configure the live **Customer portal** and, under **Billing → Revenue recovery**, Smart Retries and failed-payment emails.
5. Recreate `STRIPE_PRICE_ID` in live mode if you use one (test and live objects are separate).

## bKash

BizFlow uses the **bKash Tokenized Checkout** API (v1.2.0-beta) in non-agreement mode (`mode: 0011`): the customer is sent to bKash, approves with their wallet number, OTP and PIN, and is returned to `/api/billing/bkash/callback`, where BizFlow executes the payment and extends access by one month. If execute times out, the Query Payment API decides.

### Sandbox

1. Get sandbox credentials from the bKash developer portal (<https://developer.bka.sh>, Tokenized Checkout). bKash publishes shared sandbox credentials there and issues your own during onboarding: **app key, app secret, username, password**.
2. Set:
   ```
   BKASH_BASE_URL=https://tokenized.sandbox.bka.sh/v1.2.0-beta
   BKASH_APP_KEY=...
   BKASH_APP_SECRET=...
   BKASH_USERNAME=...
   BKASH_PASSWORD=...
   ```
3. `APP_URL` must be the URL your browser uses (the callback is built from it). Locally `http://localhost:3000` works because bKash redirects the browser, not a server.
4. Use the sandbox test wallet numbers, OTP and PIN listed in the bKash developer docs.

### Getting live merchant credentials

bKash only issues live credentials to an approved merchant. You have to apply yourself:

1. **Apply for a bKash merchant account with Payment Gateway (PGW)** through <https://www.bkash.com/en/business> ("bKash Payment Gateway" / online payment), or through your bKash relationship manager. Typical documents: trade license, TIN (and BIN if VAT-registered), owner's NID, bank account details, and a live website.
2. bKash reviews the website. It should show what you sell and the price, plus Terms, Privacy and Refund policies and contact details. BizFlow already has these pages (`/`, `/terms`, `/privacy`, `/refund`); set `SUPPORT_EMAIL` and `LEGAL_ENTITY_NAME`, and have a lawyer review the legal texts.
3. **Sandbox validation**: bKash asks for evidence that your integration works in sandbox (Grant Token, Create, Execute and Query Payment requests and responses, and screenshots of the payment flow). Run a few sandbox payments and capture them from your server logs or the browser.
4. After approval you receive live credentials. Switch:
   ```
   BKASH_BASE_URL=https://tokenized.pay.bka.sh/v1.2.0-beta
   ```
   and the four live values. Whitelisting of your server's public IP may be required; give bKash the VPS IP.
5. Make one real ৳600 payment, check it on the Billing page and in the bKash merchant panel, then refund it from the merchant panel.

Price changes: set `BKASH_PRICE_BDT` (for example when the exchange rate moves) and restart. Existing paid months are unaffected.

## Support tasks

| Task | How |
| --- | --- |
| See all accounts and their status | `npm run db:accounts` |
| Give an account free days (bank transfer, goodwill credit) | `npm run db:grant <email> <days>` |
| Refund a card payment | Stripe dashboard → Payments → Refund. Cancel the subscription there too if needed. |
| Refund a bKash payment | bKash merchant panel. Then shorten access if wanted with SQL on `subscriptions.current_period_end`. |
| Customer says they paid by bKash but access did not extend | Look up the `paymentID` / trxID in `billing_payments` (status `pending`), check it in the merchant panel; if completed, `npm run db:grant <email> 31`. |
