# Changelog

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
