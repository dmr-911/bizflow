# BizFlow Kit

Self-hosted digital operations for freelancers and small businesses: customers, quotations, invoices, payments, follow-ups and reports, in English and Bangla, with BDT and USD.

No subscriptions and no external services. One Node.js app and one SQLite file.

## Features

- **Dashboard**: invoice and quotation counts, received and outstanding amounts (per currency), overdue totals, monthly revenue chart, upcoming follow-ups, recent activity
- **Customers**: create, edit, search, archive; contact details and notes; each customer's quotations, invoices, balance and history
- **Quotations**: products/services with quantities, discounts and taxes; exact totals; print/PDF; convert accepted quotations to invoices
- **Invoices**: unique numbers; draft, sent, partially paid, paid, overdue and cancelled; partial and full payments; payment history; print/PDF
- **Follow-ups**: due dates and notes; pending, overdue and completed filters; in-app reminders
- **Reports**: revenue by month, outstanding balances with aging, most active customers, CSV export
- **Localization**: English and বাংলা, BDT (৳) and USD ($), configurable business details, numbering, date format and tax rates
- **Data**: demo data, reset, JSON backup/restore, CLI backups

## Quick start

```bash
npm ci
npm run build
npm start          # http://localhost:3000
```

Create the owner account on first visit, then load demo data from **Settings** or run `npm run db:seed`.

Requires Node.js 22+. See [docs/SETUP.md](docs/SETUP.md) for production deployment, HTTPS and backups.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/MVP.md](docs/MVP.md) | Scope, storage decision and costs |
| [docs/SETUP.md](docs/SETUP.md) | Installation, deployment, configuration, backups, security checklist |
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | How to use every screen |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, conventions, status rules |
| [docs/LOCALIZATION.md](docs/LOCALIZATION.md) | Translation structure and adding languages |
| [docs/COMMERCIAL.md](docs/COMMERCIAL.md) | Editions, pricing ideas, release and white-label checklist |
| [LICENSE.md](LICENSE.md) | Commercial license template |

## Tech stack

Next.js 15 (App Router, server actions) · TypeScript · Tailwind CSS 4 · React Hook Form · Zod · better-sqlite3 · Vitest

## Project layout

```
src/
  app/                 routes (pages, server actions, CSV/backup API, print views)
  components/          reusable UI (forms, tables, document template, sidebar)
  lib/
    money.ts calc.ts   integer money and tax/discount calculation
    status.ts          invoice and quotation state machines
    numbering.ts       unique document numbers
    validation.ts      Zod schemas for all input
    db/                SQLite connection and migrations
    services/          business logic (the only code that touches the database)
    i18n/              English and Bangla dictionaries
scripts/db.ts          maintenance CLI (seed, reset, backup, set-password)
tests/                 unit and workflow tests
```

## Development

```bash
npm run dev          # hot reload
npm test             # 55 tests: money, tax, statuses, numbering, workflows, reports, backup, auth, i18n
npm run typecheck
```

## License

Commercial. See [LICENSE.md](LICENSE.md) (template to be completed by the licensor).
