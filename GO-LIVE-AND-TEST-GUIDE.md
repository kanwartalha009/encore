# Encore — Go-Live & Test Guide

_Last updated: 2026-09-01 (universal app embed, /health endpoint, corrected cron paths)_

Everything you need to take Encore from "deployed on Railway" to "live on a real store," plus how to test each feature end-to-end on your dev store.

---

## 0. Current state (what's already done)

| Piece | Status |
|---|---|
| App deployed on Railway | ✅ `encore-production-7c8f.up.railway.app` |
| Postgres on Railway | ✅ (`DATABASE_URL` set) |
| App installed on dev store | ✅ `dev-novasolutions.myshopify.com` |
| Billing (3 plans + 14-day trial) | ✅ Test-mode charges on dev store |
| Webhooks (orders, inventory, GDPR, uninstall) | ✅ Registered; delivery verified live 2026-09-01 (`inventory_levels/update` + `products/update` → 200) |
| Theme extension (button, badge, widget, countdown) | ✅ Built; **universal app embed — works on ANY theme with one toggle** (see §4) |
| Checkout UI extension (thank-you page) | ✅ Built; add in checkout editor |
| Preorder cap function | ✅ Deployed with app |
| Health endpoint `/health` | ✅ db + scheduler heartbeat + outbox counts (added 2026-09-01) |
| Email (Resend) | ⏳ Needs `RESEND_API_KEY` + domain verify — **verified missing on Railway 2026-09-01** |
| Klaviyo | ⏳ Optional; connect in Settings → Notifications |
| Background jobs (outbox, reminders, purge) | ✅ Built-in scheduler — verified ticking live 2026-09-01 |
| Sentry | ⏳ Optional (`SENTRY_DSN`) |

---

## 1. Required environment variables (Railway)

Already set (verified in Railway → service → Variables, 2026-09-01): `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `ENCORE_CRON_SECRET`, `NOVA_API`, `NOVA_INGRESS_HMAC_SECRET`, `NOVA_INSTALL_CONFIRM_SECRET`, `PORT`, `SHOPIFY_ORG_ID`.

Add these before going live:

```
# Email — required for any customer-facing email (NOT SET yet)
RESEND_API_KEY=re_...              # resend.com → API Keys
EMAIL_FROM=notify@yourdomain.com   # must be on a verified domain in Resend

# Optional but recommended
SENTRY_DSN=<from sentry.io>        # error monitoring
```

---

## 2. Background jobs — built-in (nothing to set up)

The app runs its own scheduler in-process (started automatically on boot; verified live):

| Job | Schedule | What it does |
|---|---|---|
| Outbox flush | every 2 min | Sends queued emails/notifications (BIS alerts, ship-date changes, balance reminders) |
| Balance reminders | hourly | Emails customers with upcoming balance captures (deferred-payment preorders) |
| Data purge | hourly | Deletes soft-deleted rows past the retention window |

No external cron services. `ENCORE_CRON_SECRET` still protects the manual HTTP endpoints (`/cron/nova-outbox`, `/cron/balance-reminders`, `/cron/purge-uninstalled`) if you ever want to trigger a job by hand:

```bash
curl -X POST https://encore-production-7c8f.up.railway.app/cron/nova-outbox \
  -H "Authorization: Bearer $ENCORE_CRON_SECRET"
```

To disable the built-in scheduler (e.g. if you ever move to external cron), set `ENCORE_DISABLE_INTERNAL_CRON=1`.

**Health probe:** `GET /health` (public, safe) → `{status, db, scheduler: {started, lastOutboxTickAt}, outbox: {pending, dead}}`. Point any uptime monitor at it.

---

## 3. Deploying a change

```bash
cd ~/Documents/Claude/Projects/"Nova Apps Platform"/shopify/encore
npm run typecheck && npm test && npm run build   # expect green (34 tests)
git add -A && git commit -m "..." && git push    # Railway auto-deploys the app

npm run deploy   # shopify app deploy — ONLY needed when extensions/ changed;
                 # releases the new extension version (theme blocks + embed + storefront JS)
```

After a Railway deploy, check `/health` and the service Logs for `[scheduler] started`.

---

## 4. Storefront setup (theme editor — ONE toggle, any theme)

Since 2026-09-01 the app embed is **universal**: it works on every Shopify theme — OS 2.0 (Dawn, Horizon, third-party) and vintage (Debut) alike — with zero theme edits.

1. **Online Store → Themes → Customize**
2. **App embeds** (bottom-left) → toggle **Encore** ON → **Save**. That alone enables:
   - The **Preorder button**, **Notify-me** and **Low-stock** UI, auto-placed next to the theme's add-to-cart button on products that need them
   - Collection-page preorder badges (checkbox in the embed's settings)
   - Accent colour + site-wide styles
3. *(Optional)* On OS 2.0 themes you can still add Encore's app blocks to the product template for exact position/styling control — a block **always overrides** the auto-placed version of the same feature (nothing ever renders twice). The **Countdown timer** is block-only.

Then make sure a **live campaign targets a real product published to the Online Store channel** — the button only activates on products with an active campaign.

> Dev-store note: the storefront is password-protected (password `nova`, shown in Online Store → Preferences). Enter it once per browser before testing.

---

## 5. End-to-end preorder test (dev store)

1. Admin → Encore → **New preorder**:
   - Pick a real published product (e.g. "Short Sleeve", handle `short-sleeve`), select variants
   - Units per variant: e.g. 10; Payment: **Pay later (deposit)** → 25%; Ship date ~2 weeks out → **Launch**
2. Storefront → open that product:
   - Button reads **Preorder** (or your custom CTA); badge + "ships <date>" note show
   - With a stock-triggered campaign the button only shows when the variant is sold out; "Always" shows it even in stock
3. **Add to cart → checkout** (dev store = Bogus Gateway test payments) — complete checkout
4. Verify in Encore admin: campaign detail → units reserved +1, order appears; Shopify order gets the preorder tag + properties
5. **Deferred flow**: second campaign with **Charge later** → deposit terms at checkout (test mode)
6. **Back-in-stock**: on a 0-inventory product with no campaign, **Notify me** shows (embed auto-places it); submit an email → appears in Encore → Back in stock; restock → outbox queues the alert (sends once `RESEND_API_KEY` is set)

---

## 6. Going live on a real store

1. **Partners dashboard** → your app → **Distribution**: Custom app (single store, no review) or Public app (App Store listing + review — see `LISTING-KIT.md`)
2. Install on the real store; toggle the Encore app embed ON in its theme (§4 — one toggle, any theme)
3. Set `RESEND_API_KEY` + verified `EMAIL_FROM` (real emails!)
4. Billing: plans auto-switch from test to real charges on non-dev stores
5. Watch `/health` + Railway logs the first day; optional Sentry DSN

---

## 7. Feature reference — what's in the box

See `ENCORE-10X-PLAN.md` (all R1 items ✅) and `LISTING-KIT.md`:

- Preorder campaigns (fixed cap / date window / evergreen), per-variant rules
- Deposits & deferred payments (selling plans), balance reminders, dunning
- Back-in-stock waitlists (+ CSV import/export), Klaviyo sync
- Multi-market campaigns, 8 admin languages, translated storefront strings
- Insights: cohorts, demand, benchmarks, low-stock alerts
- Countdown timers, collection badges, custom CTA
- No-oversell inventory guard (cap function), GDPR-compliant data handling

---

## 8. If something breaks

| Symptom | Check |
|---|---|
| Emails not sending | `RESEND_API_KEY` set? Domain verified in Resend? Railway logs `[outbox]` lines |
| Outbox stuck | `GET /health` (scheduler heartbeat + pending/dead counts); Railway logs `[scheduler]` lines |
| Storefront UI missing | App embed ON in theme editor? Campaign LIVE and targeting that product? Product published to Online Store channel? Store password entered (dev store)? |
| Webhooks failing | Partners dashboard → app → Webhooks delivery metrics; Railway logs `POST /webhooks/... 200` |
| "Demo data" showing | Shouldn't happen — demo seeding removed. Fake-looking data = real rows in your DB |
| Charges failing on real store | Plans page → plan status; Railway logs `[billing]` |

---

*Matches deployed build + the 2026-09-01 fix pass (QA polish, /health, universal embed).*
