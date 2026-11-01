# Database

BizFlow stores everything in one PostgreSQL database: [Neon](https://neon.com) serverless Postgres in production, any Postgres 15+ locally. The app reads the connection string from `DATABASE_URL`; see [SETUP.md](SETUP.md#1-create-the-neon-database) for creating the Neon project.

| Code | Purpose |
| --- | --- |
| `src/lib/db/index.ts` | Connection pool, `Db` / `TenantDb` query helpers, transactions, migration runner |
| `src/lib/db/migrations.ts` | The schema, as ordered migrations |
| `src/lib/services/*` | The only code that runs SQL |
| `scripts/sqlite-import.ts` | One-time copy from the old SQLite files |

## How businesses are kept apart

All businesses share the same tables. Every business table has an `account_id` column, and:

- **Every query filters on it.** Services receive a `TenantDb`, which carries the signed-in account's id; by convention `$1` in a business query is always that id. Pages and actions get a `TenantDb` only from `requireAccess()` / `routeTenant()`, which take the account from the session, never from the request.
- **Keys include it.** Primary keys are `(account_id, id)` and every reference between business rows is a composite foreign key, e.g. `documents (account_id, customer_id) → customers (account_id, id)`. The database itself refuses a document, payment, follow-up or activity that points at another business's row, even if a query forgets a filter.
- **Deleting an account removes everything.** Each business table references `accounts(id) ON DELETE CASCADE`.
- **Writes for one business are serialised.** `TenantDb.tx()` takes a transaction-scoped advisory lock on the account id, so read-then-write steps (next document number, payment totals) stay correct when two requests for the same business arrive at once. Other businesses are not blocked.

`tests/billing.test.ts` ("tenant isolation") covers guessing another business's ids, raw SQL across businesses, restore into a second business, account deletion and parallel writes.

ids come from one identity sequence per table. Because the key is `(account_id, id)`, ids restored from a backup or imported from SQLite may repeat across businesses; after such inserts `syncSequences()` moves each sequence past the highest id.

## Conventions

| Kind of value | Stored as | Example |
| --- | --- | --- |
| Money | BIGINT minor units | ৳1,250.50 → `125050` |
| Quantity | BIGINT thousandths | 1.5 hours → `1500` |
| Percent / tax rate | INTEGER basis points | 15% → `1500` |
| Date | TEXT `YYYY-MM-DD` | `2026-10-29` |
| Timestamp | TEXT ISO-8601 UTC | `2026-10-29T04:20:00.000Z` |
| Settings | JSONB | validated by Zod on read and write |

Dates and timestamps stay ISO text, as in the SQLite version, so the code compares them as strings and JSON backups from before and after the move are interchangeable. BIGINT and aggregate results are parsed to JavaScript numbers (`src/lib/db/index.ts`); every value fits well inside the safe-integer range. In SQL, camelCase result names are double-quoted (`AS "customerId"`) because Postgres folds unquoted names to lower case.

## Accounts, logins and billing

| Table | Purpose | Key rules |
| --- | --- | --- |
| `accounts` | One row per business | deleting cascades to everything below and to all business tables |
| `users` | Logins | email stored lower-case, unique on `lower(email)`; scrypt hash; `role` is `owner` for now |
| `sessions` | Active logins | SHA-256 of the cookie token, never the token |
| `password_resets` | Emailed reset links | SHA-256 of the token; one-time (claimed with `UPDATE … RETURNING`); 1 hour expiry |
| `subscriptions` | Plan state per account | `status` trialing/active/past_due/canceled; `trial_ends_at`, `current_period_end` (paid-through), Stripe ids; row-locked while a webhook or bKash callback updates it |
| `billing_payments` | Stripe invoices and bKash payments | `UNIQUE(provider, provider_ref)`; amounts in cents/poisha |
| `webhook_events` | Processed Stripe event ids | makes webhook retries harmless |

## Business tables (all scoped by `account_id`)

| Table | Purpose | Key rules |
| --- | --- | --- |
| `settings` | Key/value JSONB (business details, locale, currency, numbering, tax rates, default terms) | `PRIMARY KEY (account_id, key)` |
| `customers` | Contacts | `archived_at` set instead of deleting, so history is kept |
| `documents` | Quotations and invoices (`kind`) | `UNIQUE(account_id, kind, number)`; `CHECK amount_paid <= total`; unique `(account_id, source_document_id)` (one invoice per quotation) |
| `document_items` | Line items | snapshot of `tax_name` and `tax_rate_bps`, so later tax setting changes never alter issued documents; `line_total` stored |
| `payments` | Payments against invoices | `CHECK amount > 0` |
| `follow_ups` | Reminders | `status` pending/completed; overdue is derived; deleting a draft document clears `document_id` only |
| `activities` | Activity feed | written by the service layer for every business event |

`ON DELETE SET NULL (document_id)` (clear only that column of a composite key) needs Postgres 15 or later. New Neon projects use 17.

## Statuses

Invoices: `draft → sent → partially_paid → paid`, `draft|sent → cancelled`, `sent → draft` (only without payments). Removing a payment moves `paid → partially_paid → sent`. **Overdue** is computed when an unpaid issued invoice is past its due date.

Quotations: `draft → sent → accepted | rejected`, `accepted → converted` (creates the invoice), `rejected → draft`. **Expired** is computed when a draft/sent quotation is past its valid-until date.

The transition table lives in `src/lib/status.ts` and is covered by `tests/status.test.ts`.

## Migrations

Pending migrations run automatically the first time each server instance touches the database, in one transaction behind an advisory lock, so several serverless instances starting together are safe. `npm run db:migrate` applies them up front (do this before deploying a release that adds one). Applied migrations are listed in `schema_migrations`.

To change the schema, append a new `{ id, name, sql }` entry to `MIGRATIONS`. Never edit a migration that has shipped.

## Moving existing SQLite data to Postgres

Versions before the move kept `DATA_DIR/control.db` plus one `DATA_DIR/tenants/<account id>.db` per business. To bring a running installation across:

1. Stop the old app (or put it in maintenance) so nothing changes during the copy, and keep a copy of `DATA_DIR`.
2. Point `DATABASE_URL` at the new, empty Neon database. Either connection string works; Neon suggests the direct (non-pooled) one for one-off admin jobs like this.
3. Run:

   ```bash
   npm ci
   DATABASE_URL="postgresql://…" npm run db:import-sqlite /var/lib/bizflow   # the old DATA_DIR
   ```

   The import creates the schema if needed, copies every account, login, session, subscription, billing record and business record with their original ids (so links, open sessions and Stripe/bKash references keep working), checks the row count of every table for every business, and only then commits. Any error rolls the whole import back. It refuses to run if the database already has accounts, and skips business files whose account was deleted. The SQLite files are opened read-only.
4. Start the new deployment with the same `DATABASE_URL` (pooled string is fine) and check a few accounts. `npm run db:accounts` lists them with their subscription state.

To rehearse first, create a Neon branch, import into it, look around, then delete the branch and import into `main`.

Single businesses can also move on their own: **Settings → Download backup** in the old app, then **Settings → Restore from backup** in the new one. Backup files have the same format before and after the move.

## Tests

`npm test` needs a Postgres server. Each test file creates its own schema in `TEST_DATABASE_URL` (default `postgres://postgres@localhost:5432/bizflow_test`) and drops it afterwards. CI starts a Postgres 17 service container for this. Locally, for example:

```bash
docker run -d --name bizflow-pg -p 5432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=bizflow_test postgres:17
npm test
```
