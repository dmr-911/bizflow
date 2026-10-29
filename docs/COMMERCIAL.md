# Commercial packaging guide

How to turn this repository into a product you can sell.

## Suggested editions and pricing

Prices are suggestions for the Bangladesh and international freelancer market; adjust to your positioning.

| Edition | Contents | Suggested price |
| --- | --- | --- |
| Single Business | Source + setup guide, 1 installation, 12 months updates | ৳4,000–8,000 / US$39–79 one-time |
| Agency | Up to 10 client installations | ৳15,000–25,000 / US$149–249 |
| Extended / White-label | Unlimited client installations, rebranding | US$399+ |
| Installation service | You deploy it on the customer's VPS with HTTPS and backups | ৳3,000–6,000 / US$30–60 per install |
| Hosting & care plan (optional) | You host and back up for them | ৳500–1,000 / US$5–10 per month |

The software itself has **no mandatory recurring costs** for the buyer; hosting is their only running cost (from ~US$4/month, or free on an office PC).

## Release checklist

1. Update `version` in `package.json` and `CHANGELOG.md`.
2. `npm ci && npm run typecheck && npm test && npm run build` — all must pass.
3. Make sure `data/` contains only `.gitkeep` and there is no `.env` file.
4. Fill in `LICENSE.md` (licensor name, year, edition terms, governing law).
5. Build the download archive from a clean checkout:
   ```bash
   git archive --format=zip --prefix=bizflow-kit-1.0.0/ -o bizflow-kit-1.0.0.zip HEAD
   ```
   The archive contains source, docs and licence; buyers run `npm ci` themselves (no `node_modules`, no database).
6. Include in the product page: feature list (docs/MVP.md), requirements (Node 22, persistent disk), screenshots, the user manual, and the licence summary.

## White-labelling

- Product name and tagline: `app.name` / `app.tagline` in `src/lib/i18n/en.ts` and `bn.ts`, and `metadata` in `src/app/layout.tsx`.
- Colours: `--color-brand-*` in `src/app/globals.css`.
- Logo mark: the "B" badge in `components/sidebar.tsx`, `components/auth-shell.tsx` and `src/app/icon.svg`.
- Default texts (terms, footer, tax rates): `DEFAULT_SETTINGS` in `src/lib/services/settings.ts`.

## Support boundaries to state clearly

- Buyers are responsible for hosting, backups and verifying tax/legal compliance (see LICENSE.md §5, §7).
- Supported runtime: Node.js 22+ on Linux, macOS or Windows with a persistent disk.
- Not included in v1: email sending, online payments, multi-user. These are good paid add-ons.
