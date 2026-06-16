# Encore — theme app extension

The storefront side of Encore. Lives in `extensions/encore-storefront/`. No theme
code is edited; merchants add blocks in the theme editor.

## What's in it

| File | Purpose |
|------|---------|
| `blocks/preorder.liquid` | **Preorder button** app block (product page). Shows the button + ship-date note when the product is on preorder; writes preorder line-item properties into the product form. |
| `blocks/notify-me.liquid` | **Back-in-stock button** app block. Shows "Notify me" when the variant is sold out; opens an email/phone popup. |
| `blocks/low-stock.liquid` | **Low-stock meter** app block. Progress bar / "Only N left" / urgency pill, threshold-driven, updates on variant change. |
| `blocks/app-embed.liquid` | Optional global runtime + accent theming (App embeds panel). The product blocks work without it. |
| `assets/encore.js` | One shared runtime (Shopify dedupes it) that powers all three blocks. |
| `assets/encore.css` | Scoped styles (`.encore` namespace), all colours via CSS variables. |
| `locales/en.default*.json` | Storefront + theme-editor English strings. |

## How it gets its data (app proxy)

The blocks are thin Liquid shells. On load, `encore.js` calls the app over the
app proxy (`/apps/encore` → app routes `proxy.config` / `proxy.notify`):

- `GET /apps/encore/config?product_id=…&locale=…` → `app/routes/proxy.config.tsx`
  → `getStorefrontConfig()` merges **AppSettings** (general / lowStock /
  backInStock) + the matching **live Campaign** + per-locale **Translation**
  overrides into one JSON payload. The DB is the single source of truth, so
  whatever the merchant saves in the admin is what renders on the storefront.
- `POST /apps/encore/notify` → `app/routes/proxy.notify.tsx` records a
  `WaitlistSubscription` (deduped per email + variant).

Both routes are validated with `authenticate.public.appProxy` (Shopify HMAC).

## Preorder in cart & checkout (line-item properties)

When a product is on preorder, `encore.js` injects hidden inputs into the
product form so the flag follows the item into the cart and checkout:

- `properties[_preorder] = "true"` — hidden (underscore) flag for app logic.
- `properties[_preorder_ship_date] = <ISO date>` — hidden, for webhooks/parsing.
- `properties[<Preorder label>] = "<Ships label> <date>"` — **visible** to the
  shopper in cart and on the order. Label/date come from Settings → Cart.

## Running it on the Mac

No new Prisma models were added, so **no `prisma db push` is needed** this round.

```bash
cd shopify/encore
npm run dev          # or: shopify app dev
```

`shopify app dev` registers the app proxy (already in `shopify.app.toml`) and
serves the extension to your dev store. Then in the dev store:

1. **Online Store → Themes → Customize.**
2. On a **product** template, *Add block* → pick **Preorder button**,
   **Back-in-stock button**, and/or **Low-stock meter** (under "Apps").
3. (Optional) **Theme settings → App embeds** → enable **Storefront runtime**.

### Testing each feature

- **Preorder** — create a **live** preorder (campaign) that targets the product
  (Specific product, or All products). Reload the product page → button + note;
  add to cart → check the line-item properties in the cart.
- **Low stock** — the variant must have **tracked inventory** at or below the
  threshold (Settings → Low stock, or the block's threshold). 0 or untracked = hidden.
- **Back in stock** — set the variant **sold out** and enable Back in stock in
  the app. The "Notify me" button appears; submitting writes a subscriber you'll
  see under **Back in stock** in the admin.

## Deploy

```bash
shopify app deploy   # pushes the extension + app-proxy config to the Partner app
```

## Known limitations (follow-ups)

- **COLLECTION-mode preorder** matching needs an Admin API collection lookup;
  `getStorefrontConfig` currently matches **Specific** and **All** products.
- **"Replace the buy buttons"** placement hides the theme's add-to-cart with
  best-effort selectors — verify on the merchant's theme.
- Deposit / pay-later capture still depends on the **selling-plan service**
  (task #17), not yet wired.
