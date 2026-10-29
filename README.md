# BizFlow

Hosted invoicing for freelancers and small businesses: customers, quotations, invoices, payments, follow-ups and reports, in English and Bangla, with BDT and USD.

**Plan:** US$5/month by card (Stripe) or ৳600/month by bKash, after a 14-day free trial with no card.

## Features

- **Landing page** describing the problem and product, pricing and FAQ, in English and বাংলা, plus Terms, Privacy and Refund pages
- **Accounts**: public sign-up, sign in, password reset by email; each business gets its own private database
- **Billing**: Stripe Checkout subscriptions with customer portal, bKash Tokenized Checkout monthly payments, payment history, trial banner, access paused (data kept and exportable) when unpaid
- **Dashboard**: invoice and quotation counts, received and outstanding amounts per currency, overdue totals, revenue chart, follow-ups, activity
- **Customers, quotations and invoices**: discounts and taxes, exact totals, print/PDF, quotation to invoice conversion, partial payments, overdue tracking
- **Follow-ups and reports**: reminders, revenue by month, aging, most active customers, CSV export
- **Data**: demo data, JSON backup/restore, account deletion

## Quick start

```bash
npm ci
cp .env.example .env
npm run dev          # http://localhost:3000
```

Open `/signup` to create an account. Add Stripe and bKash sandbox keys to `.env` to try payments ([docs/BILLING.md](docs/BILLING.md)). Requires Node.js 22+.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/SETUP.md](docs/SETUP.md) | Architecture, configuration, VPS deployment, backups, security checklist, CLI |
| [docs/BILLING.md](docs/BILLING.md) | How billing works; Stripe and bKash test setup; getting live merchant credentials |
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | How to use every screen |
| [docs/DATABASE.md](docs/DATABASE.md) | Control and business database schemas, conventions, status rules |
| [docs/LOCALIZATION.md](docs/LOCALIZATION.md) | Translation structure and adding languages |
| [docs/MVP.md](docs/MVP.md) | Original 1.0 self-hosted scope |

## Tech stack

Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS 4 · React Hook Form · Zod · better-sqlite3 · Stripe · bKash Tokenized Checkout · Nodemailer · Vitest

## Project layout

```
src/
  app/                 routes: landing and legal pages, auth pages, (app) business screens,
                       billing, server actions, webhook/callback/export APIs, print views
  components/          UI (forms, tables, document template, sidebar, marketing sections)
  lib/
    db/                connections, control and business migrations
    services/          business logic, auth and billing (the only code that touches SQL)
    billing/           Stripe and bKash clients, Stripe event handling
    server/            request context (session, subscription gate), mail, rate limits
    i18n/              English and Bangla dictionaries
scripts/db.ts          maintenance CLI (migrate, backup, accounts, seed, grant, set-password)
tests/                 unit, workflow and billing tests
```

## Development

```bash
npm run dev
npm test             # money, tax, statuses, numbering, workflows, auth, billing, webhooks, bKash, tenant isolation
npm run typecheck
```

## License

Commercial. See [LICENSE.md](LICENSE.md).
