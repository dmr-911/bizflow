# Setup and deployment guide

## Requirements

- Node.js **22 or newer** (`node -v`)
- About 300 MB of disk for dependencies and the build; the database itself is usually a few MB
- A machine with a **persistent disk**: your own PC, an office server, a VPS, or a Docker host

No external database, email service or paid API is required.

> `better-sqlite3` ships prebuilt binaries for Linux, macOS and Windows on x64 and arm64. On unusual platforms npm compiles it, which needs Python 3 and a C++ toolchain (`build-essential` on Debian/Ubuntu).

## 1. Local install (try it in 5 minutes)

```bash
git clone <your copy of the repository> bizflow
cd bizflow
npm ci
cp .env.example .env        # optional; defaults work
npm run build
npm start                   # http://localhost:3000
```

Open the browser, create the owner account on the setup screen, then either fill in **Settings → Business details** or load demo data (**Settings → Load demo data**, or `npm run db:seed`).

For development with hot reload: `npm run dev`.

## 2. Configuration

All configuration is in environment variables (`.env` in the project folder, or your process manager). There are **no secret API keys** in this edition.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DATABASE_PATH` | `./data/bizflow.db` | Location of the SQLite file. Keep it outside any publicly served folder. |
| `COOKIE_SECURE` | `false` | Set to `true` when served over HTTPS so the session cookie is `Secure`. |
| `SESSION_DAYS` | `14` | How long a login lasts. |
| `PORT` | `3000` | Port for `npm start` (`next start -p` also works). |

Business settings (name, language, currency, numbering, taxes) are edited in the app, not in env files.

## 3. Production on a VPS (Ubuntu example)

Typical cost: **US$4–6 per month** for a 1 vCPU / 1 GB VPS (DigitalOcean, Hetzner, Vultr, Linode, or a local Bangladeshi provider). A domain is optional (~US$10–15/year). HTTPS via Let's Encrypt is free.

```bash
# as a non-root user with sudo
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
git clone <repo> /opt/bizflow && cd /opt/bizflow
npm ci && npm run build
```

Create `/etc/systemd/system/bizflow.service`:

```ini
[Unit]
Description=BizFlow Kit
After=network.target

[Service]
WorkingDirectory=/opt/bizflow
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATABASE_PATH=/var/lib/bizflow/bizflow.db
Environment=COOKIE_SECURE=true
ExecStart=/usr/bin/npm start
Restart=always
User=bizflow

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /var/lib/bizflow bizflow
sudo mkdir -p /var/lib/bizflow && sudo chown bizflow /var/lib/bizflow
sudo chown -R bizflow /opt/bizflow
sudo systemctl enable --now bizflow
```

Put a reverse proxy with HTTPS in front. With Caddy (automatic certificates):

```
invoices.example.com {
  reverse_proxy localhost:3000
}
```

Or Nginx + Certbot with `proxy_pass http://127.0.0.1:3000;` and `proxy_set_header X-Forwarded-For $remote_addr;`.

**Always use HTTPS when the app is reachable from the internet** — the login cookie must not travel in plain text.

## 4. Running on a shop or office PC (no internet exposure)

Install Node.js 22 from nodejs.org, then run the local install steps. To start automatically on Windows, use Task Scheduler ("At log on" → `npm start` in the project folder) or a tool such as `pm2` (`npm i -g pm2 && pm2 start npm --name bizflow -- start && pm2 save`). Other devices on the same network can open `http://<pc-ip>:3000`.

## 5. Updating

```bash
npm run db:backup            # safety copy first
git pull                     # or unpack the new release
npm ci && npm run build
sudo systemctl restart bizflow
```

Database migrations run automatically on start.

## 6. Backups and data export

Your business data lives in **one file** (`DATABASE_PATH`). Back it up like any important document.

| Method | How | Use for |
| --- | --- | --- |
| In-app JSON backup | Settings → Data & backup → **Download backup** | Quick manual backups; restore through the same screen |
| CLI file backup | `npm run db:backup [folder]` | Consistent copy of the SQLite file, safe while the app runs |
| Scheduled | cron: `0 2 * * * cd /opt/bizflow && npm run db:backup /var/backups/bizflow` | Nightly backups |
| Off-site | copy the backup folder to Google Drive, Dropbox, S3, or a USB disk | Protection against server loss |
| CSV | Reports → Export data | Opening data in Excel/Sheets, giving data to an accountant |

Recommended: nightly CLI backup, keep 30 days (`find /var/backups/bizflow -mtime +30 -delete`), and copy off-site weekly. Test a restore occasionally.

To restore a file backup: stop the app, replace the database file with the backup copy (delete any `-wal`/`-shm` files next to it), start the app.

The JSON backup excludes the password hash and sessions; it contains customer data, so store it securely.

## 7. Security checklist

- [ ] Served over HTTPS with `COOKIE_SECURE=true`
- [ ] Strong owner password (10+ characters)
- [ ] Database and backup folders readable only by the service user
- [ ] Server OS updates enabled (`unattended-upgrades`)
- [ ] Backups copied off the server
- [ ] Firewall allows only 80/443 (and SSH)

Forgot the password? On the server: `npm run set-password <username> <new-password>` (this also signs out all sessions).

## 8. Command reference

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / server |
| `npm test` | Unit and workflow tests |
| `npm run typecheck` | TypeScript check |
| `npm run db:migrate` | Create or upgrade the database without starting the app |
| `npm run db:seed` | Replace business data with demo data |
| `npm run db:reset` | Erase all business data (keeps settings and login) |
| `npm run db:backup [dir]` | Write a consistent copy of the database |
| `npm run set-password <user> <pw>` | Reset a password, or create the first user |

## Hosting platforms that are not supported

Serverless platforms with an ephemeral or read-only file system (Vercel, Netlify functions, Cloudflare Workers) cannot keep the SQLite file. Use a VPS, a container with a persistent volume (Railway, Fly.io volumes, Render disks — note these platforms usually charge US$5–10/month), or your own machine.
