# Phase 4 — Reliability, GDPR, performance & theme compatibility

Built 2026‑06‑15. Gate in `PHASE-4-AUDIT.md`; contract entry `CC-2026-06-15-02`.
This doc is the Mac/pilot run guide + the checklists that can only be *ticked* on
real stores.

## 1. Reliability bar (on the dashboard)

The **Reliability** card on App Home shows three figures from real data
(`app/services/reliability.server.ts`), green when clean:

- **Oversell incidents** — campaigns/variants whose committed units exceed the cap. Enforced upstream, so this reads **0**; any non-zero value is a real breach (surfaced, not hidden).
- **Untagged orders** — pre-order rows on a real order still `tagged=false`. orders/create retries until the tag is verified, so steady state is **0** (dormant until PCD enables `orders/*`).
- **Waitlist delivery** — SENT / (SENT+FAILED) over dispatched back-in-stock notifications.

## 2. GDPR / privacy compliance

Three mandatory webhooks (registered by `shopify app deploy` from the
`compliance_topics` in `shopify.app.toml`):

| Topic | Route | Behaviour |
|---|---|---|
| `customers/data_request` | `webhooks.customers.data_request.tsx` | Gathers the customer's waitlist + preorder records (`exportCustomerData`). Logs a non-PII summary; production delivers the data to the merchant. |
| `customers/redact` | `webhooks.customers.redact.tsx` | Deletes the customer's waitlist rows; strips PII from preorder/accounting rows (`redactCustomer`). 500 → retry until done. |
| `shop/redact` | `webhooks.shop.redact.tsx` | Hard-deletes every shop-scoped table (`purgeShopData`). 500 → retry. |

All three: `authenticate.webhook` verifies the HMAC and returns **401** on a bad
signature; they respond **200** on success. Everything is keyed by `shop` (the
GDPR purge key) + email.

### Purge-uninstalled job (48h)

- `app/uninstalled` stamps an `UninstalledShop` row (idempotent).
- `POST /cron/purge-uninstalled` (token-guarded with `ENCORE_CRON_SECRET`) hard-deletes data for shops uninstalled > 48h ago, then stamps `purgedAt`. `GET` is a dry run listing due shops.
- **Mac:** set `ENCORE_CRON_SECRET`; point a daily scheduler at it:
  ```bash
  curl -fsS -X POST https://<app-url>/cron/purge-uninstalled \
    -H "Authorization: Bearer $ENCORE_CRON_SECRET"
  ```

### EU-VAT-correct deposits

Encore hand-computes **no** VAT. Deposits/charge-later ride Shopify **selling-plan
billing policies** (`checkoutCharge` PRICE/PERCENTAGE + balance trigger), so
Shopify applies the store's tax rules **per market** at checkout and on balance
capture. Nothing to configure beyond the store's existing tax settings.

## 3. Performance / Built for Shopify

Storefront block is built to not move page speed:

- `encore.js` / `encore.css` inject via the block schema's `javascript` /
  `stylesheet` attributes → Shopify loads them **deferred** and **deduped** (one
  copy even with multiple blocks). No render-blocking `<script>`.
- **CLS-safe**: `.encore-preorder__skeleton` reserves the 44px button height
  before the one cached `/config` fetch resolves; `prefers-reduced-motion` kills
  the shimmer.
- Admin dashboard loader = a few `@@index([shop])` queries + the reliability
  rollup; the welcome state renders without network.

**Tick on the Mac (Lighthouse / Web Vitals):**

- [ ] PDP with the preorder block: LCP not regressed vs the block removed
- [ ] CLS ≈ 0 on the PDP (skeleton reserves height)
- [ ] No long task from `encore.js` on load (deferred)
- [ ] App Home interactive < 1s on a warm session (BFS bar, §6.1)

## 4. Theme compatibility matrix (pilot stores)

Run on each pilot-store theme; the block must render without layout breakage in
both light/dark and at mobile + desktop widths.

| Theme | Preorder button | Notify-me | Low-stock | CLS OK | Notes |
|---|---|---|---|---|---|
| Dawn (baseline) | ☐ | ☐ | ☐ | ☐ | |
| Pilot theme A | ☐ | ☐ | ☐ | ☐ | |
| Pilot theme B | ☐ | ☐ | ☐ | ☐ | |
| Pilot theme C | ☐ | ☐ | ☐ | ☐ | |

For each: add the app blocks via the theme editor, load a preorder product + an
out-of-stock product, confirm the button/popup/meter render correctly, the
selling plan is injected, and there's no jump as the config resolves.
