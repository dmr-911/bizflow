# Setup and deployment

BizFlow is a hosted, multi-tenant web app: anyone can sign up, each business's records are kept apart from every other business, and a subscription (Stripe or bKash) keeps access open. See [BILLING.md](BILLING.md) for payments.

## Architecture in one paragraph

A Next.js app with one PostgreSQL database, [Neon](https://neon.com) serverless Postgres in production. Accounts, logins, sessions and subscriptions are ordinary tables; every business table carries `account_id`, every business query filters on it, and composite foreign keys stop a row from ever pointing at another business's data (details in [DATABASE.md](DATABASE.md)). The schema is created and migrated automatically on first use. Because no data lives on the app server's disk, the app runs on serverless hosts such as **Vercel** as well as on a plain VPS, and can run several instances at once.

## Requirements

- Node.js **22+**
- A Neon project (free to start; see [cost](#neon-limits-and-cost) below), or any Postgres 15+
- Hosting: **Vercel** (simplest) or a Linux VPS
- A domain name and HTTPS (required by Stripe and bKash)
- An SMTP provider for password-reset emails (Amazon SES, Postmark, Resend, Mailgun, Zoho, ...)

## 1. Create the Neon database

1. Sign up at [console.neon.tech](https://console.neon.tech) and create a project. Pick the region closest to your customers and your app server: **AWS Asia Pacific (Singapore)** for Bangladesh. Keep the default Postgres version (17; 15 or later is required).
2. On the project dashboard click **Connect**. Copy the connection string with **Connection pooling** turned on (the host contains `-pooler`). It looks like
   `postgresql://neondb_owner:…@ep-xxx-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
3. Put it in `DATABASE_URL` (your `.env` locally, the host's environment variables in production). It contains the database password: never commit it. `.env` is git-ignored.
4. Optional: `npm run db:migrate` creates the tables now; otherwise the app does it on its first request.

The pooled string suits serverless hosts, which open many short-lived connections. The direct string (without `-pooler`) also works and is what Neon suggests for one-off admin jobs such as the SQLite import.

To move an existing SQLite installation across, see [DATABASE.md → Moving existing SQLite data](DATABASE.md#moving-existing-sqlite-data-to-postgres).

## 2. Local development

```bash
npm ci
cp .env.example .env     # then set DATABASE_URL; add Stripe/bKash test keys to try payments
npm run dev              # http://localhost:3000
```

`DATABASE_URL` can point at a Neon branch (create a `dev` branch in the Neon console so you never touch production data) or at a local Postgres, e.g.
`docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:17` and `DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres`.

Sign up at `/signup`. Without `SMTP_URL`, reset emails are printed in the terminal. To fill an account with sample data: `npm run db:seed <your email>`, or **Settings → Load demo data**.

Tests need a Postgres too; see [DATABASE.md → Tests](DATABASE.md#tests).

## 3. Configuration

All configuration is environment variables; see [`.env.example`](../.env.example) for the full list with comments.

| Variable | Required in production | Meaning |
| --- | --- | --- |
| `APP_URL` | yes | Public URL, e.g. `https://bizflow.com.bd` |
| `DATABASE_URL` | yes | Neon (or any Postgres 15+) connection string. Secret |
| `COOKIE_SECURE` | yes (`true`) | Secure session cookie over HTTPS |
| `SMTP_URL`, `MAIL_FROM` | yes | Password-reset emails |
| `SUPPORT_EMAIL`, `LEGAL_ENTITY_NAME` | yes | Shown on billing and legal pages |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for card payments | [BILLING.md](BILLING.md#stripe) |
| `BKASH_*` | for bKash payments | [BILLING.md](BILLING.md#bkash) |
| `TRIAL_DAYS`, `BKASH_PRICE_BDT` | no | Defaults 14 and 600 |
| `SESSION_DAYS` | no | Default 14 |
| `DATABASE_POOL_MAX` | no | Connections per app instance, default 5 |

## 4. Production on Vercel

1. Push the repository to GitHub and import it at [vercel.com/new](https://vercel.com/new). The defaults (Next.js, `npm run build`) are right.
2. Under **Settings → Environment Variables** add `DATABASE_URL` (pooled Neon string), `APP_URL` (your domain), `COOKIE_SECURE=true` and the rest from the [table above](#3-configuration). Use a separate Neon branch for **Preview** deployments so previews never write to production data. The Neon integration in the Vercel Marketplace can create a branch per preview automatically.
3. `vercel.json` pins functions to Singapore (`sin1`) to sit next to a Neon project in AWS Singapore. If your Neon project is elsewhere, change it to the [matching Vercel region](https://vercel.com/docs/regions); every page makes several queries, so the two must be close.
4. Deploy, add your domain, then register the Stripe webhook (`https://<domain>/api/billing/stripe/webhook`) and give bKash your callback domain ([BILLING.md](BILLING.md)).

Before deploying a release that adds a migration, run `npm run db:migrate` against production from your machine (the app would also apply it on first request).

Things to know on Vercel:

- Vercel's **Hobby plan is for non-commercial use only**. A paid service like BizFlow needs **Pro** (US$20 per member per month at the time of writing).
- Sign-in and sign-up rate limits are kept in memory, so on serverless each instance counts separately. They still slow down guessing; for strict limits put Vercel's firewall rate limiting in front of `/login`, `/signup` and `/forgot-password`.
- If bKash asks to whitelist your server's IP, note that Vercel functions do not have a fixed outbound IP unless you buy Vercel's static IP option. A VPS is the simpler choice in that case.

## 5. Production on a VPS (Ubuntu)

The database is in Neon, so the server keeps no customer data and can be rebuilt at any time.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo useradd --system --no-create-home bizflow
sudo mkdir -p /etc/bizflow
git clone https://github.com/mizan-cdda/bizflow /opt/bizflow && cd /opt/bizflow
npm ci && npm run build && sudo chown -R bizflow /opt/bizflow
sudo cp .env.example /etc/bizflow/env && sudo chmod 600 /etc/bizflow/env   # then edit it: DATABASE_URL, APP_URL, ...
```

`/etc/systemd/system/bizflow.service`:

```ini
[Unit]
Description=BizFlow
After=network.target

[Service]
WorkingDirectory=/opt/bizflow
EnvironmentFile=/etc/bizflow/env
Environment=NODE_ENV=production
Environment=PORT=3000
ExecStart=/usr/bin/npm start
Restart=always
User=bizflow

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now bizflow
```

HTTPS with Caddy (automatic certificates), `/etc/caddy/Caddyfile`:

```
bizflow.example.com {
  reverse_proxy localhost:3000
}
```

Caddy sets `X-Forwarded-For`, which the sign-in rate limiter uses. With Nginx, add `proxy_set_header X-Forwarded-For $remote_addr;` and `proxy_set_header X-Forwarded-Proto https;`.

Then register the Stripe webhook (`https://<domain>/api/billing/stripe/webhook`) and give bKash your callback domain, as described in [BILLING.md](BILLING.md).

### Updating

```bash
cd /opt/bizflow
git pull && npm ci && npm run db:migrate && npm run build
sudo systemctl restart bizflow
```

## 6. Backups

All customer data is in the Neon database.

- **Neon keeps history.** You can restore the whole database, or open a branch, at any point inside the history window: 6 hours on the Free plan, up to 7 days on Launch, up to 30 days on Scale. Use this for "undo the last hour" accidents.
- **Keep your own off-site copy too**, so you are not relying on one provider. A nightly `pg_dump` is enough:

  ```bash
  # nightly at 02:00, keep 30 days
  0 2 * * * pg_dump "$DATABASE_URL" -Fc -f /var/backups/bizflow/$(date +\%F).dump && find /var/backups/bizflow -mtime +30 -delete
  ```

  Restore with `pg_restore --clean --no-owner -d "$DATABASE_URL" <file>` (into a fresh branch first, to check it). Use a `pg_dump` with the same major version as the server (17).
- `npm run db:backup [dir]` writes one JSON file per business, in the same format as **Settings → Download backup**, so a single business can be restored from the app.

Customers can also download their own JSON backup and CSV exports from Settings or Billing at any time.

## 7. Security checklist

- [ ] HTTPS everywhere, `COOKIE_SECURE=true`
- [ ] `DATABASE_URL` and other keys only in the host's environment settings or `/etc/bizflow/env` (mode 600); no keys in git
- [ ] Separate Neon branches (or projects) for development and preview deployments
- [ ] Neon project protected by a strong console login with two-factor authentication
- [ ] VPS only: firewall with only 80/443 and SSH open; SSH keys only; unattended security updates
- [ ] Off-site backups, restore tested
- [ ] Stripe webhook signing secret set; bKash live credentials stored only in environment settings

Built in: scrypt password hashing, hashed session and reset tokens, per-IP rate limits on sign-in, sign-up and reset, a sign-up honeypot, same-origin checks on all form actions (Next.js server actions), security headers, TLS to the database, and per-business scoping enforced by composite foreign keys.

## Neon limits and cost

Prices and limits from [neon.com/pricing](https://neon.com/pricing) and the [Free plan FAQ](https://neon.com/faqs/free-plan-limits-and-quotas), checked October 2026. Neon changes them from time to time, so check before you rely on a number.

**Free plan (US$0):**

| Limit | Free plan | What happens at the limit |
| --- | --- | --- |
| Compute | 100 CU-hours per project per month (1 CU ≈ 1 vCPU + 4 GB RAM; autoscaling up to 2 CU) | Compute is suspended and connections drop until next month or an upgrade. The site is down for that time. |
| Storage | 1 GB per project (20 GB across all projects) | Writes that grow the database fail until you free space or upgrade. Reads still work. |
| Data transfer out | 5 GB per project per month | Compute is suspended, as for CU-hours |
| Scale to zero | After 5 minutes idle; cannot be turned off | The first request after a pause waits for the compute to wake, typically a few hundred milliseconds |
| Restore history | 6 hours (1 GB of changes) | Older points cannot be restored |
| Branches / projects | 10 per project / 100 projects | |
| Support | Community | |

**Paid plans have no monthly minimum** and bill by usage:

| | Launch | Scale |
| --- | --- | --- |
| Compute | US$0.106 per CU-hour | US$0.222 per CU-hour |
| Storage | US$0.35 per GB-month | US$0.35 per GB-month |
| Restore history | up to 7 days, US$0.20 per GB-month of history | up to 30 days, same price |
| Data transfer out | 500 GB included, then US$0.10/GB | same |

**What BizFlow will use.** CU-hours are compute size × hours the compute is awake. At the smallest size (0.25 CU) Neon sleeps after 5 idle minutes, so cost follows how many hours a day someone is using the app:

| Usage | CU-hours / month | Free plan? | Launch cost / month |
| --- | --- | --- | --- |
| Testing, a few businesses, a couple of hours of use a day | 0.25 × 2–4 h × 30 ≈ 15–30 | yes | — |
| Steady use across Bangladeshi working hours (~12 h a day) | 0.25 × 12 h × 30 ≈ 90 | just, no headroom | ≈ US$10 + storage |
| Awake around the clock at 0.25 CU | 0.25 × 730 ≈ 183 | no | ≈ US$19 + storage |
| Awake around the clock at 0.5–1 CU (hundreds of active businesses) | 365–730 | no | ≈ US$39–77 + storage |

Business records are small: a busy business with 2,000 invoices a year uses roughly 5–10 MB a year including indexes, so 1 GB holds on the order of a hundred such businesses for a year, and storage stays a few dollars a month on Launch (US$0.35 per GB). The free tier is fine for building, testing and the first customers. Move to **Launch** once you have paying customers: a suspended compute takes the whole site down until the month resets, and Launch also gives a 7-day restore window. With BizFlow at US$5 per business per month, three or four paying businesses cover a typical Launch bill. In the Neon console, set the compute's autoscaling maximum (for example 1 CU) to cap the worst case.

## 8. Command reference

The `db:*` commands read `DATABASE_URL` from the environment or from `.env`.

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop / build / run |
| `npm test`, `npm run typecheck` | Tests and type check |
| `npm run db:migrate` | Create or upgrade the schema (applies `drizzle/*.sql`) |
| `npm run db:generate` | After editing `src/lib/db/schema.ts`: write the migration (see [DATABASE.md](DATABASE.md#migrations)) |
| `npm run db:studio` | Browse the tables with Drizzle Studio |
| `npm run db:import-sqlite [data-dir]` | One-time copy of the old SQLite files into Postgres |
| `npm run db:backup [dir]` | One JSON backup file per business |
| `npm run db:accounts` | List accounts with subscription status |
| `npm run db:seed <email>` | Replace that account's data with demo data |
| `npm run set-password <email> <pw>` | Reset a user's password |
| `npm run db:grant <email> <days>` | Extend an account's paid-through date |

## Moving from the self-hosted BizFlow Kit

The 1.x self-hosted edition (one owner, one `bizflow.db`) remains in git history before version 2.0.0. To move a business onto the hosted service, download a JSON backup in the old app (**Settings → Download backup**), sign up on the hosted site, and restore it under **Settings → Restore from backup**.
