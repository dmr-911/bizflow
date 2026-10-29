# BizFlow Kit — MVP definition and storage strategy

## Who it is for

Freelancers, consultants, small agencies, local service businesses and small online sellers, in Bangladesh and internationally, who need professional quotations and invoices, payment tracking and follow-ups without paying for an enterprise suite.

## Product principles

1. **Self-hosted, no mandatory recurring fees.** One Node.js process and one database file. Runs on a laptop, an office PC, or a VPS that costs a few dollars a month.
2. **Correct money.** All amounts are integer minor units (paisa / cents), never floating point. Totals are computed on the server and stored with the document.
3. **Records you can trust.** Unique document numbers, a strict invoice lifecycle, issued invoices locked against edits, and an activity log.
4. **Bilingual.** English and Bangla interface; BDT and USD formatting; configurable date formats, numbering and taxes.
5. **Resellable.** White-label friendly (business name, terms, footer), simple installation, commercial licence template included.

## In scope (v1.0)

| Area | Included |
| --- | --- |
| Dashboard | Invoice/quotation counts, received and outstanding amounts per currency, overdue totals, 6-month revenue chart, upcoming follow-ups, recent activity, reminder banner |
| Customers | Create, edit, search, archive/restore; contact details, tax ID, notes; per-customer documents, balances, follow-ups and activity |
| Quotations | Line items with quantity (3 decimals), unit price, % or fixed discount, per-line tax; draft → sent → accepted/rejected; expiry derived from "valid until"; one-click conversion to invoice (only once) |
| Invoices | Unique numbers; draft → sent → partially paid → paid, or cancelled; overdue derived from due date; partial and full payments with method/reference; payment removal for corrections; payment history |
| Print / PDF | A4 print templates for quotations and invoices via the browser's "Save as PDF" |
| Follow-ups | Due date, note, optional customer/document link; pending / overdue / due-today / completed filters; sidebar badge and dashboard banner |
| Reports | Revenue by month (cash and accrual), outstanding balances with aging buckets, most active customers, CSV exports of everything |
| Localization | English + Bangla dictionaries, Bangla numerals, BDT (৳) and USD ($), 4 date formats, configurable prefixes/padding/year in numbering, configurable tax label and rates |
| Data | Demo data loader, full reset, JSON backup download and restore, CLI file backup |
| Security | Single owner login (scrypt), hashed session tokens in httpOnly cookies, server-side validation with Zod, login rate limiting, security headers, CSV formula-injection protection |

## Out of scope (candidates for later editions)

Email delivery of documents, online payment links (bKash/SSLCommerz/Stripe), multi-user roles, cloud sync, recurring invoices, expenses, inventory, multi-company, logo upload, server-generated PDF attachments. None of these is required for the core workflow; each adds recurring cost or operational complexity.

## Storage strategy

**Decision: embedded SQLite (via `better-sqlite3`) behind a small service layer.**

| Option | Recurring cost | Setup | Verdict |
| --- | --- | --- | --- |
| SQLite file on the same server | **$0** | none — created on first run | **Chosen** |
| Hosted Postgres (Neon, Supabase, RDS) | $0 on limited free tiers, typically $19–25+/month for production plans | account, connection string, network access | Not needed for one business |
| JSON files | $0 | none | No transactions or constraints; unsafe for money |

Why SQLite fits:

- A single small business writes a few hundred rows a day at most; SQLite handles far more on one core.
- ACID transactions protect multi-step operations (payment + status change, quotation conversion).
- Constraints enforce rules in the database itself: `UNIQUE(kind, number)` for document numbers, a partial unique index so a quotation converts at most once, `CHECK` constraints for non-negative amounts and `amount_paid <= total`.
- Backup is copying one file (or using the built-in online backup command).
- WAL mode keeps reads fast while writing.

Trade-off: the app must run on a host with a persistent disk (VPS, office PC, Docker volume). Serverless platforms with ephemeral file systems (e.g. Vercel) are not supported for this edition. If a buyer needs that, the service layer in `src/lib/services/` is the only code that talks to the database, so it is the place to swap in Postgres.

## Data model

See [DATABASE.md](DATABASE.md).

## Delivery stages (as built)

1. Core library: money, tax calculation, statuses, numbering, dates, validation — with unit tests.
2. Database schema, migrations and services — with workflow tests against an in-memory database.
3. Authentication and app shell (responsive sidebar, localization provider).
4. Customers, quotations, invoices, payments, follow-ups.
5. Dashboard, reports, CSV export, print templates.
6. Settings, demo data, reset, backup/restore, CLI.
7. Documentation, licence and packaging.
