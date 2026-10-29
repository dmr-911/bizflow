# Database schema

BizFlow Kit uses one SQLite file (default `data/bizflow.db`, override with `DATABASE_PATH`). The schema is created and upgraded automatically on start by the migrations in `src/lib/db/migrations.ts`; applied migrations are recorded in `schema_migrations`.

## Conventions

| Kind of value | Stored as | Example |
| --- | --- | --- |
| Money | INTEGER minor units | ৳1,250.50 → `125050` |
| Quantity | INTEGER thousandths | 1.5 hours → `1500` |
| Percent / tax rate | INTEGER basis points | 15% → `1500` |
| Date | TEXT `YYYY-MM-DD` | `2026-10-29` |
| Timestamp | TEXT ISO-8601 UTC | `2026-10-29T04:20:00.000Z` |

## Tables

| Table | Purpose | Key rules |
| --- | --- | --- |
| `settings` | Key/value JSON (business details, locale, currency, numbering, tax rates, default terms) | validated by Zod on read and write |
| `users` | Owner login | `username` unique (case-insensitive); scrypt password hash |
| `sessions` | Active logins | stores SHA-256 of the cookie token, never the token |
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

Append a new `{ id, name, sql }` entry to `MIGRATIONS`. Never edit a migration that has shipped. Migrations run in a transaction on next start.
