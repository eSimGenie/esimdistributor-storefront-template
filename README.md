# eSIM Storefront Template

A white-label travel eSIM shop for **eSimDistributor resellers**. You set the prices, customers pay **your own Stripe account**, and the site buys the eSIM wholesale from the eSimDistributor Reseller API (paid from your prepaid balance) and delivers it instantly, on screen and by email.

It runs on **your own Cloudflare account** (Workers + KV, free tier is enough to start).

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/eSimGenie/esimdistributor-storefront-template)

- Home with destination search, featured destinations, how it works, FAQ
- `/destinations`, `/esim/<code>` country/region pages (fixed and daily plans), `/plan/<sku>` plan detail
- Stripe Checkout, automatic fulfilment, QR code + LPA + install steps on a private order page
- `/compatibility`, `/install`, `/lookup` (re-send an order), `/contact`, `/legal/terms`, `/legal/privacy`
- SEO (titles, meta, Open Graph, JSON-LD, `sitemap.xml`, `robots.txt`), accessible, responsive to 360 px, light/dark
- Astro 5 + Cloudflare Workers, Tailwind 4, TypeScript strict, almost no client JavaScript

---

## How it works

```
Traveller ── /plan/<sku> ── POST /api/checkout ──▶ Stripe Checkout (your account)
                                                      │ paid
           /order/pending ◀── success URL ────────────┤
                 │ polls /api/order-status            ▼
                 │                       POST /api/stripe-webhook (signature verified)
                 │                                    │ POST /api/v1/reseller/orders
                 │                                    │   Idempotency-Key: <Stripe session id>
                 ▼                                    ▼
           /order/<id>?t=<signed token>  ◀── KV ORDERS (session → order)
             QR (proxied server-side), LPA, install steps
```

- **The API key and wholesale prices never reach the browser.** Catalog calls, the QR image and orders all go through the Worker.
- **Selling price** = wholesale × `multiplier` (or + `fixedMarkup`), charm-rounded, or your per-SKU override — **never below wholesale** (lower prices are raised to wholesale and logged).
- **Idempotent fulfilment**: the Stripe session id is the `Idempotency-Key`, so duplicate webhooks, the pending-page poll and retries can never buy two eSIMs.
- **Catalog caching**: API responses are cached in the Workers Cache API for 1 hour (served stale for up to 6 more hours while refreshing). Public pages send `Cache-Control: s-maxage=3600` and are cached at the edge on custom domains.

## Quick start (local, no keys needed)

```bash
npm install
npm run dev          # http://localhost:4321
```

Without a `RESELLER_API_KEY`, the dev server runs in **mock mode**: a built-in demo catalog, fake orders and a checkout that skips Stripe — so you can click through the whole flow. Test hooks: use an email containing `+nobalance` to simulate a 402 (low balance), or `+slow` for an order that stays `processing` for 15 seconds.

## Going live — step by step

### 1. eSimDistributor

1. Sign in to the eSimDistributor console and **top up** your balance.
2. **Turn on auto top-up** (Billing). A paid order that hits `402 insufficient_balance` is not lost — the customer sees "we're preparing your eSIM" and it is retried automatically (cron every 10 minutes) — but they will wait until you top up.
3. **Developer → API keys → Create**. Copy the `sk_live_...` key (shown once).

### 2. Configure your brand

Edit **`site.config.json`** (validated at build time; your editor gets autocompletion from `site.config.schema.json`):

| Key | Meaning |
|---|---|
| `brandName`, `tagline`, `logoUrl` | Shown in the header, titles and emails. `logoUrl` can be `https://...` or `/logo.svg` in `public/`. |
| `primaryColor`, `accentColor` | Hex colours; text colour on buttons is chosen automatically for contrast. |
| `supportEmail`, `websiteUrl` | `websiteUrl` is your public shop URL (canonical links, sitemap, emails). |
| `pricing.mode` | `"multiplier"` (wholesale × `multiplier`) or `"fixed"` (wholesale + `fixedMarkup` USD). |
| `pricing.roundTo` | `0.99` → next X.99, `0.49` → next X.49 or X.99, `null` → no rounding. |
| `pricing.overrides` | `{ "<sku>": 9.99 }` exact prices (not rounded; never below wholesale). |
| `featuredDestinations` | Codes for the home page, e.g. `["FR","JP","europe"]`. |
| `hiddenSkus` | Plans never shown or sold. |
| `legal` | Company name, address, optional registration line and governing-law jurisdiction (used in footer, terms, privacy). |
| `analytics` | `null` or `{ "provider": "plausible" \| "ga4" \| "cloudflare", "id": "..." }`. Never loaded on order pages. |
| `apiBaseUrl` | Default `https://api.esimdistributor.com`. |

Tip: the console's `GET /storefront/config` returns a ready-made config with your brand settings.

Then run the pre-flight check — it prints exactly what is still missing:

```bash
npm run setup               # add -- --online to test the API key, -- --strict for CI
```

### 3. Deploy

**Option A — button.** Click **Deploy to Cloudflare** above. Cloudflare copies this repo to your GitHub/GitLab, creates the Worker and the `ORDERS` KV namespace, asks for the secrets listed in `.dev.vars.example`, and redeploys on every push. Edit `site.config.json` in your copy and push.

**Option B — CLI.**

```bash
npx wrangler login
npx wrangler secret put RESELLER_API_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET   # after step 4; put a placeholder first
npx wrangler secret put ORDER_LINK_SECRET       # e.g. output of: openssl rand -hex 32
npm run deploy
```

The `ORDERS` KV namespace is created automatically on first deploy (wrangler 4.45+). On older wrangler versions run `npx wrangler kv namespace create ORDERS` and add the `id` to `wrangler.toml`.

| Secret | Required | |
|---|---|---|
| `RESELLER_API_KEY` | yes | eSimDistributor API key |
| `STRIPE_SECRET_KEY` | yes | Stripe secret key (`sk_live_...`, or a restricted key with Checkout Sessions write) |
| `STRIPE_WEBHOOK_SECRET` | yes | `whsec_...` of the webhook endpoint below |
| `ORDER_LINK_SECRET` | yes* | Signs private order links. *If unset, one is derived from the API key — rotating the key then breaks old links. Never change it after launch. |
| `ESD_WEBHOOK_SECRET` | no | Enables `/api/esd-webhook` |
| `RESEND_API_KEY` + `EMAIL_FROM` | no | Send your own branded "your eSIM is ready" email via [Resend](https://resend.com) with a link to the order page. Without them, eSimDistributor's white-labelled email (your Brand settings) is sent instead (`sendEmail: true`). |
| `ADMIN_TOKEN` | no | Enables `POST /api/admin/retry` |

### 4. Stripe

1. Create / activate your Stripe account.
2. **Developers → Webhooks → Add endpoint**: `https://<your-domain>/api/stripe-webhook`, events **`checkout.session.completed`** and **`checkout.session.async_payment_succeeded`**.
3. Copy the signing secret → `npx wrangler secret put STRIPE_WEBHOOK_SECRET`.
4. Optional: enable Apple Pay / Google Pay and your branding under Settings → Checkout.

Even if the webhook is late or misconfigured, the pending page checks the Stripe session itself and fulfils paid orders, so customers are never stuck — but do configure it.

### 5. Custom domain

Cloudflare dashboard → Workers & Pages → `esim-storefront` → Settings → **Domains & Routes → Add custom domain** (the domain must be on your Cloudflare account), or add a `routes` entry in `wrangler.toml`. Set `websiteUrl` in `site.config.json` to match. The edge HTML cache only works on a custom domain (not on `*.workers.dev`).

### 6. Optional: eSimDistributor webhook

Console → Developer → Webhooks → `https://<your-domain>/api/esd-webhook`, events `order.completed`, `order.failed`. Put the secret in `ESD_WEBHOOK_SECRET`. Orders that start as `processing` then complete instantly instead of on the next poll.

### 7. Test before going live

Use Stripe **test keys** (`sk_test_...`) with card `4242 4242 4242 4242`. Note: test payments still place **real** wholesale orders against your balance unless `MOCK_API=1`.

## Operations

- **Low balance (402)**: the order is stored as failed, the customer sees a friendly "we're preparing your eSIM" message and gets the email once it succeeds. The Worker logs `ACTION REQUIRED ...` (Cloudflare → Workers → Logs). After topping up, orders are retried automatically every 10 minutes, or immediately with:
  ```bash
  curl -X POST https://<your-domain>/api/admin/retry -H "Authorization: Bearer $ADMIN_TOKEN"
  ```
- **Lost QR code**: customers use `/lookup` (email + order number, rate-limited). The answer is always the same, so it cannot be used to probe for orders; the link/eSIM is only sent to the order's email.
- **Refunds** are handled in Stripe; eSIM refunds/cancellations in the eSimDistributor console.

## Project layout

```
site.config.json            your brand + pricing (validated by src/lib/config-schema.ts)
wrangler.toml               Worker, KV binding, cron, secret list
src/lib/                    framework-free logic (unit tested)
  api.ts / mock-api.ts      Reseller API client + mock
  pricing.ts                selling price (cents, rounding, overrides, clamp)
  catalog.ts / cache.ts     public catalog view + stale-while-revalidate cache
  stripe.ts / crypto.ts     Stripe REST (fetch) + webhook/HMAC verification
  fulfil.ts / store.ts      idempotent fulfilment + KV order store
src/pages/                  pages and API routes (/api/checkout, /api/stripe-webhook, ...)
src/worker.ts               Worker entry: Astro fetch + cron retry
scripts/setup.ts            npm run setup
tests/                      vitest
```

## Scripts

| | |
|---|---|
| `npm run dev` | Local dev server (mock mode without keys) |
| `npm run build` | Production build into `dist/` |
| `npm run check` | Type-check (`astro check`) |
| `npm test` | Unit tests (pricing, signatures, fulfilment, config, catalog) |
| `npm run setup` | Pre-flight configuration check |
| `npm run deploy` | Build + `wrangler deploy` |

**Windows on ARM:** `workerd` (used by wrangler and the dev server) has no native Windows-ARM64 build, so `npm install` fails there. Use an x64 build of Node.js (runs under emulation) or WSL.

## Legal

The terms and privacy pages are **templates** — have them reviewed for your business and jurisdiction. You are the seller of record to your customers.

## License

MIT
