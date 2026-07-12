# Encore — App Store listing kit (draft, E0)

> Draft copy for the Shopify App Store submission (E4). Screenshots + demo store +
> privacy/terms URLs are finalized in E2 (post‑E1 UI). Pricing matches the in‑app
> Nova‑controlled plans (`docs/BILLING.md`). **PCD approval + support email are
> Kanwar's external actions (E0.6/E0.7).**

## App identity

- **Name:** Encore — Preorder & Back in Stock
- **Tagline (≤62 chars):** Preorders that never oversell. Back‑in‑stock that converts.
- **Category:** Selling products → Pre‑orders (secondary: Store management → Inventory)
- **Support email:** `<support@…>` — *Kanwar to confirm (E0.7)*
- **Pricing:** Free 14‑day trial, then Basic / Growth / Scale (below)

## Long description (lead with simplicity + no‑oversell + partial payments)

**Turn out‑of‑stock and not‑yet‑released products into captured demand — in under two
minutes, without a developer.**

Encore lets any store owner add a preorder button or a back‑in‑stock waitlist to any
product with a 3‑step setup. No code, no jargon.

- **Never oversell.** A hard per‑product limit reverts the product to sold‑out at the cap — enforced at checkout, not just on the page. Your reliability dashboard shows oversell + untagged‑order incidents at a glance (they read 0).
- **Partial payments, the Shopify‑native way.** Charge in full, take a deposit, or let shoppers pay later — using Shopify's Selling Plans. EU‑VAT correct, no card data held by us.
- **Preorder by market.** In‑stock in one country, preorder in another — automatically, from your Shopify Markets.
- **Back in stock that recovers demand.** Shoppers get notified the moment you restock, through **your Klaviyo** or **Shopify Flow** — no new email bill. Editable, translatable copy.
- **Works with your discounts** and flags conflicts before they cost you.
- **8 languages**, built in.

Simple enough for any store owner; powerful enough that everything advanced is one click away.

## Keywords / ASO

preorder, pre‑order, back in stock, restock alert, waitlist, coming soon, sold out,
deposit, partial payment, pay later, notify me, out of stock, presale, drop.

## Pricing table (matches in‑app plans — Nova‑controlled)

| Plan | Monthly | Annual (−20%) | Pre‑orders/mo | Back‑in‑stock/mo | Trial |
|---|---|---|---|---|---|
| Basic | $19.99 | $191.90 | 100 | 500 | 14 days |
| Growth | $49.99 | $479.90 | 1,000 | 5,000 | 14 days |
| Scale | $129.99 | $1,247.90 | Unlimited | Unlimited | — |

*(Prices/limits are managed in the Nova admin and read live by the app.)*

## Reviewer test instructions (finalize demo store in E2)

1. Install on the review test store (Billing runs in **test mode** — no real charge).
2. **First‑run wizard**: pick a product → choose "Preorder when out of stock" → style the button (live preview) → Publish. *(≤3 screens to first preorder.)*
3. Open the product on the storefront → the preorder button shows; add to cart → the line is tagged and the ship date shows.
4. Set the product's inventory to 0 then back to in‑stock → the back‑in‑stock signal fires (Klaviyo/Flow test).
5. Choose a plan on **Plans** → approve the test subscription → usage meter updates.
6. GDPR: the 3 compliance webhooks return 200 (401 on bad HMAC); uninstall schedules a 48h data purge.

## Assets checklist (E2)

- [ ] App icon (1200×1200)
- [ ] 6+ screenshots on the post‑E1 UI (demo store)
- [ ] Demo store URL + reviewer credentials
- [ ] Privacy policy + Terms URLs (hosted on platform `apps/web` — coordinate)
- [ ] Feature video (optional)
