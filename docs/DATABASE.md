# Database schema

BizFlow uses SQLite files under `DATA_DIR` (default `./data`):

| File | Contents | Migrations |
| --- | --- | --- |
| `control.db` | Accounts, logins, sessions, password resets, subscriptions, billing payments, processed webhook ids | `src/lib/db/control-migrations.ts` |
| `tenants/<account id>.db` | One business's settings, customers, documents, payments, follow-ups and activity | `src/lib/db/migrations.ts` |

Every business query goes through `getTenantDb(accountId)` for the signed-in account, so data from different businesses is physically separate. Each file is created and migrated the first time it is opened; applied migrations are recorded in its `schema_migrations` table.

## Conventions

| Kind of value | Stored as | Example |
| --- | --- | --- |
| Money | INTEGER minor units | ৳1,250.50 → `125050` |
| Quantity | INTEGER thousandths | 1.5 hours → `1500` |
| Percent / tax rate | INTEGER basis points | 15% → `1500` |
| Date | TEXT `YYYY-MM-DD` | `2026-10-29` |
| Timestamp | TEXT ISO-8601 UTC | `2026-10-29T04:20:00.000Z` |

## Control database

| Table | Purpose | Key rules |
| --- | --- | --- |
| `accounts` | One row per business | deleting cascades to users, sessions, subscription and billing rows |
| `users` | Logins | `email` unique (case-insensitive); scrypt hash; `role` is `owner` for now |
| `sessions` | Active logins | SHA-256 of the cookie token, never the token |
| `password_resets` | Emailed reset links | SHA-256 of the token; one-time; 1 hour expiry |
| `subscriptions` | Plan state per account | `status` trialing/active/past_due/canceled; `trial_ends_at`, `current_period_end` (paid-through), Stripe ids |
| `billing_payments` | Stripe invoices and bKash payments | `UNIQUE(provider, provider_ref)`; amounts in cents/poisha |
| `webhook_events` | Processed Stripe event ids | makes webhook retries harmless |

## Business (tenant) database tables

| Table | Purpose | Key rules |
| --- | --- | --- |
| `settings` | Key/value JSON (business details, locale, currency, numbering, tax rates, default terms) | validated by Zod on read and write |
| `users`, `sessions` | Unused since 2.0 (logins moved to the control database); kept so 1.x files open unchanged | — |
| `customers` | Contacts | `archived_at` set instead of deleting, so history is kept |
| `documents` | Quotations and invoices (`kind`) | `UNIQUE(kind, number)`; `CHECK amount_paid <= total`; unique `source_document_id` (one invoice per quotation) |
| `document_items` | Line items | snapshot of `tax_name` and `tax_rate_bps`, so later tax setting changes never alter issued documents; `line_total` stored |
| `payments` | Payments against invoices | `CHECK amount > 0` |
| `follow_ups` | Reminders | `status` pending/completed; overdue is derived |
| `activities` | Activity feed | written by the service layer for every business event |

## Statuses

Invoices: `draft → sent → partially_paid → paid`, `draft|sent → cancelled`, `sent → draft` (only without payments). Removing a payment moves `paid → partially_paid → sent`. **Overdue** is computed when an unpaid issued invoice is past its due date.

Quotations: `draft → sent → accepted | rejected`, `accepted → converted` (creates the invoice), `rejected → draft`. **Expired** is computed when a draft/sent quotation is past its valid-until date.

The transition table lives in `src/lib/status.ts` and is covered by `tests/status.test.ts`.

## Adding a migration

Append a new `{ id, name, sql }` entry to `MIGRATIONS` (business data) or `CONTROL_MIGRATIONS` (accounts and billing). Never edit a migration that has shipped. Migrations run in a transaction when each file is next opened; `npm run db:migrate` applies them to every file at once.
