# Setup and deployment

BizFlow is a hosted, multi-tenant web app: anyone can sign up, each business gets its own private database, and a subscription (Stripe or bKash) keeps access open. See [BILLING.md](BILLING.md) for payments.

## Architecture in one paragraph

One Next.js server process. A **control database** (`DATA_DIR/control.db`) holds accounts, logins, sessions and subscriptions. Every business has its **own SQLite file** (`DATA_DIR/tenants/<account id>.db`) with the same schema the self-hosted MVP used, so business data from two accounts can never mix in a query. Files are created and migrated automatically on first use.

## Is SQLite on one server enough?

Yes for launch and well beyond. Each business writes a few hundred rows a day at most; SQLite in WAL mode on an SSD handles thousands of such businesses on a 1–2 vCPU VPS. The app keeps up to `MAX_OPEN_TENANT_DBS` (default 200) database handles open and closes the least recently used.

What it does **not** support: running several app servers behind a load balancer, or serverless hosting (Vercel, Netlify, Cloudflare Workers), because the files live on local disk. When you outgrow one server, the repository layer (`src/lib/services`) is the only code that touches SQL, which keeps a later move to PostgreSQL contained.

## Requirements

- Node.js **22+**
- A Linux VPS with a persistent SSD (1 vCPU / 1–2 GB RAM is plenty to start; US$5–12/month at Hetzner, DigitalOcean, Vultr or a Bangladeshi provider)
- A domain name and HTTPS (required by Stripe and bKash)
- An SMTP provider for password-reset emails (Amazon SES, Postmark, Resend, Mailgun, Zoho, ...)

## 1. Local development

```bash
npm ci
cp .env.example .env     # defaults work; add Stripe/bKash test keys to try payments
npm run dev              # http://localhost:3000
```

Sign up at `/signup`. Without `SMTP_URL`, reset emails are printed in the terminal. To fill an account with sample data: `npm run db:seed <your email>`, or **Settings → Load demo data**.

## 2. Configuration

All configuration is environment variables; see [`.env.example`](../.env.example) for the full list with comments.

| Variable | Required in production | Meaning |
| --- | --- | --- |
| `APP_URL` | yes | Public URL, e.g. `https://bizflow.com.bd` |
| `DATA_DIR` | yes | Where databases live, e.g. `/var/lib/bizflow` |
| `COOKIE_SECURE` | yes (`true`) | Secure session cookie over HTTPS |
| `SMTP_URL`, `MAIL_FROM` | yes | Password-reset emails |
| `SUPPORT_EMAIL`, `LEGAL_ENTITY_NAME` | yes | Shown on billing and legal pages |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | for card payments | [BILLING.md](BILLING.md#stripe) |
| `BKASH_*` | for bKash payments | [BILLING.md](BILLING.md#bkash) |
| `TRIAL_DAYS`, `BKASH_PRICE_BDT` | no | Defaults 14 and 600 |
| `SESSION_DAYS`, `MAX_OPEN_TENANT_DBS` | no | Defaults 14 and 200 |

## 3. Production on a VPS (Ubuntu)

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo useradd --system --home /var/lib/bizflow bizflow
sudo mkdir -p /var/lib/bizflow /etc/bizflow && sudo chown bizflow /var/lib/bizflow
git clone https://github.com/mizan-cdda/bizflow /opt/bizflow && cd /opt/bizflow
npm ci && npm run build && sudo chown -R bizflow /opt/bizflow
sudo cp .env.example /etc/bizflow/env && sudo chmod 600 /etc/bizflow/env   # then edit it
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

## 4. Updating

```bash
cd /opt/bizflow
npm run db:backup /var/backups/bizflow
git pull && npm ci && npm run build
sudo systemctl restart bizflow
```

Migrations run automatically when a database is opened. `npm run db:migrate` migrates every database up front if you prefer.

## 5. Backups

All customer data is in `DATA_DIR`. Lose it and you lose every customer's business, so back it up off the server.

```bash
# nightly at 02:00, keep 30 days
0 2 * * * cd /opt/bizflow && DATA_DIR=/var/lib/bizflow npm run db:backup /var/backups/bizflow && find /var/backups/bizflow -maxdepth 1 -mtime +30 -exec rm -rf {} +
```

`db:backup` writes consistent copies (safe while the app runs) of `control.db` and every tenant file into a timestamped folder. Copy that folder off-site daily (restic, rclone to S3/Backblaze B2, or your provider's snapshots). Test a restore regularly: stop the app, copy the files back into `DATA_DIR`, delete stray `-wal`/`-shm` files, start the app.

Customers can also download their own JSON backup and CSV exports from Settings or Billing at any time.

## 6. Security checklist

- [ ] HTTPS everywhere, `COOKIE_SECURE=true`
- [ ] `/etc/bizflow/env` readable only by root/bizflow; no keys in git
- [ ] `DATA_DIR` and backups readable only by the service user
- [ ] Firewall: only 80/443 and SSH open; SSH keys only
- [ ] Unattended OS security updates
- [ ] Off-site backups, restore tested
- [ ] Stripe webhook signing secret set; bKash live credentials stored only in the env file

Built in: scrypt password hashing, hashed session and reset tokens, per-IP rate limits on sign-in, sign-up and reset, a sign-up honeypot, same-origin checks on all form actions (Next.js server actions), security headers, and a separate database per business.

## 7. Command reference

| Command | Purpose |
| --- | --- |
| `npm run dev` / `npm run build` / `npm start` | Develop / build / run |
| `npm test`, `npm run typecheck` | Tests and type check |
| `npm run db:migrate` | Create or upgrade all databases |
| `npm run db:backup [dir]` | Consistent copy of every database |
| `npm run db:accounts` | List accounts with subscription status |
| `npm run db:seed <email>` | Replace that account's data with demo data |
| `npm run set-password <email> <pw>` | Reset a user's password |
| `npm run db:grant <email> <days>` | Extend an account's paid-through date |

## Moving from the self-hosted BizFlow Kit

The 1.x self-hosted edition (one owner, one `bizflow.db`) remains in git history before version 2.0.0. To move a business onto the hosted service, download a JSON backup in the old app (**Settings → Download backup**), sign up on the hosted site, and restore it under **Settings → Restore from backup**.
