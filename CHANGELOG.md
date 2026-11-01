# Changelog

## 2.1.0 — unreleased

Storage moves from SQLite files to one PostgreSQL database (Neon serverless Postgres in production), so BizFlow can run on Vercel and on more than one server.

- One shared database: every business table has `account_id`, `(account_id, id)` keys and composite foreign keys; every query is scoped to the signed-in business; deleting an account cascades
- Writes for one business are serialised with a transaction-scoped advisory lock, so document numbers and payment totals stay correct under concurrent requests
- `DATABASE_URL` replaces `DATA_DIR`; schema migrations run automatically (safe across serverless instances) or with `npm run db:migrate`
- `npm run db:import-sqlite [data-dir]`: one-time, all-or-nothing copy of `control.db` and every `tenants/<id>.db`, keeping ids and verifying row counts
- `npm run db:backup` now writes one JSON backup per business; database-level backups use Neon history and `pg_dump`
- JSON backups keep the same format, so files from 2.0 restore unchanged
- `vercel.json` (Singapore region), CI runs tests against Postgres 17, docs for Neon setup, Vercel deployment, free-tier limits and cost

## 2.0.0 — 2026-10-29

BizFlow becomes a hosted subscription service.

- Public landing page (English and Bangla) describing the problem and product, with pricing, FAQ, and Terms, Privacy and Refund pages; sitemap, robots and structured data
- Public sign-up with email and password, 14-day free trial (no card), sign in, forgot/reset password by email
- Multi-tenant storage: a control database for accounts and billing, and a separate SQLite database per business
- Subscription billing: US$5/month by card through Stripe Checkout (webhooks, customer portal), or ৳600/month through bKash Tokenized Checkout; payment history; access paused (data kept and exportable) when unpaid
- Billing page, trial banner, account deletion
- Maintenance CLI for accounts: list, grant days, seed, reset password, back up all databases
- Removed the single-owner setup screen and `db:reset`; `DATABASE_PATH` replaced by `DATA_DIR`

## 1.0.0 — 2026-10-29

First release (MVP).

- Dashboard with per-currency received/outstanding totals, revenue chart, follow-ups and activity
- Customers with search, archive/restore, per-customer documents, balances and activity
- Quotations with discounts, per-line taxes, status workflow, PDF printing and one-time conversion to invoices
- Invoices with unique numbering, draft/sent/partially paid/paid/overdue/cancelled lifecycle and payment history
- Follow-up tracker with reminders
- Reports: revenue by month, aging of outstanding balances, most active customers, CSV exports
- English and Bangla interface; BDT and USD; configurable date formats, numbering and tax rates
- Owner login, demo data, reset, JSON backup/restore and CLI backup
