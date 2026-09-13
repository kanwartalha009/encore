# Encore — configuration & storefront audit (2026-09-13)

Every row is backed by something run today: a real click / `fetch` on the dev store, a schema or docs lookup on shopify.dev, or a test run. Nothing below is marked VERIFIED from memory. Sources are linked where a Shopify rule is asserted.

Store: `dev-novasolutions.myshopify.com` · published theme **Debut** (`theme_store_id 796`, role `main`) · app `encore-production-7c8f.up.railway.app` · storefront runtime **encore-11** (20,139 B) at the time of the checks.

## 1. Why "product is not adding to checkout"

| Step | Evidence (real clicks, no injected code) | Result |
|---|---|---|
| PDP → Preorder button | `/cart/clear` → PDP → click → landed on `/cart` with 1 line, `selling_plan_allocation.selling_plan.id = 5191565474`, `properties._preorder = true` | VERIFIED |
| Cart → **Check out** button | Click does nothing. Cause found in the page source: the Debut theme's cart template contains a leftover custom block — `<form id="custom_cart_checkout">` + a jQuery `$(document).on('click','input[name="checkout"]')` handler that calls `e.preventDefault()` and posts the cart to `http://127.0.0.1:8000/cart` | **THEME BUG — not Encore** |
| Checkout itself | Submitting the cart form directly renders checkout with both lines, the selling plan and the ship-date property (screenshot 2026-09-13) | VERIFIED |

**Fix (Kanwar):** Online Store → Themes → Debut → Edit code → search `custom_cart_checkout` → delete that `<form>` and the two `<script>` tags after it (jQuery CDN + the `127.0.0.1:8000` handler). Save.

## 2. Configuration vs Shopify's rules

| Area | What Encore does | Shopify rule (source) | Status |
|---|---|---|---|
| Continue selling | LIVE campaign variants → `inventoryPolicy: CONTINUE` via `productVariantsBulkUpdate`; cap exhausted / paused / ended → `DENY`. Runs on save, status change, `orders/create`, boot, hourly | Continue-selling is the documented way to sell past zero while keeping inventory tracked (untracking would blind low-stock/BIS). Live evidence: after the deploy the campaign's variants read `policy: continue` in the PDP inventory JSON | VERIFIED (2 of 3 variants — see §4) |
| Selling plan (deferred purchase) | `sellingPlanGroupCreate` with `category: PRE_ORDER`, fixed billing (`checkoutCharge` full / deposit, `remainingBalanceChargeTrigger`), `deliveryPolicy.fixed.fulfillmentTrigger: UNKNOWN`, `inventoryPolicy.reserve: ON_FULFILLMENT`; scope `write_purchase_options` | Matches [About pre-order and TBYB](https://shopify.dev/docs/apps/build/purchase-options/deferred): pricing/delivery/inventory/billing policies on a selling plan group; `UNKNOWN` is a valid fulfillment trigger; reserve on fulfillment is the documented preorder choice | VERIFIED (cart line carries plan 5191565474 named "Short Sleeve preorder — preorder") |
| **Cap validation function** | Function `encore-preorder-cap` (target `cart.validations.generate.run`) deployed; app writes `encore.preorder_remaining` variant metafields | A deployed validation function does **nothing** until a `Validation` is created with `validationCreate` — "Requires `write_validations` access scope" ([validationCreate](https://shopify.dev/docs/api/admin-graphql/2025-10/mutations/validationCreate)). Encore never called it and lacked the scope | **FIXED today**: `write_validations` added to `shopify.app.toml`; `ensureCapValidation()` (idempotent create / re-enable, `blockOnFailure:false`) runs whenever caps are written. Needs push + `npm run deploy` + accepting the new scope when the app next opens |
| **orders/* webhooks** | Handlers exist; subscriptions commented out (PCD) → **no PreOrder rows are ever recorded** on this store, so caps never count down, dashboards stay empty, order tagging/metafields never run | [Protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data): "If your app is for testing or installed only on a development store, you can access customer data in development after Step 5. You don't need to submit for review." Step 5 = select a distribution method, request PCD access + the fields (email, name), fill in Data protection details | **BLOCKED on Kanwar** (Partner Dashboard, ~10 min). Then I uncomment the three subscriptions and you run `npm run deploy` |
| Compliance webhooks | `customers/data_request`, `customers/redact`, `shop/redact` declared as `compliance_topics` | Mandatory for App Store ([Privacy law compliance](https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance)) | VERIFIED (toml) |
| Non-PCD webhooks | `products/update`, `inventory_levels/update`, `app_subscriptions/update`, `app/uninstalled`, `app/scopes_update` | — | VERIFIED live 2026-09-01 (200s in Railway logs); not re-fired today |
| App proxy | `/apps/encore/*` → `/proxy/*`; `authenticate.public.appProxy` HMAC | Today: `config` (JSON, `cart` block present), `badges`, `notify` (`{"ok":true,"deduped":false}` for a test email on the white variant) | VERIFIED |
| Scopes in use vs declared | `write_products` (variants policy, selling plans, variant metafield definitions), `write_purchase_options`, `read_inventory`, `read_orders/write_orders` (tags, metafields), `read_markets`, `read_customers`, `write_metaobjects*`, **`write_validations` (new)** | — | VERIFIED by grep of mutations vs toml |
| Email delivery (BIS, preorder emails) | Resend via `RESEND_API_KEY` / `EMAIL_FROM` | Env vars missing on Railway (verified 2026-09-01) → signups are stored, nothing is sent | BLOCKED on Kanwar |
| Database | SQLite on a Railway volume, `prisma db push` at boot | Not a Shopify rule, but `db push` cannot add constraints on a live table (2026-09-13 hotfix) | Move to Postgres + `prisma migrate` before listing |

## 3. Storefront behaviour fixed today (found while auditing)

| Finding | Fix | Evidence |
|---|---|---|
| Campaigns are configured **per variant** (units offered on each variant row) but the storefront decided at **product** level: a variant that is not in the campaign still showed the Preorder button (and Shopify then rejected the add), and a variant at its cap was never shown as sold out | Config now returns `preorder.variantScoped` + `preorder.variants[{id}] = { soldOut, remaining }`; runtime re-evaluates on every variant change: **preorder** (button, badge, selling plan + properties armed, theme buttons hidden) / **sold out** (disabled Sold-out button, badge hidden, fields cleared, Notify-me shown) / **not in campaign** (Encore UI hidden, theme buttons restored, fields cleared). Notify-me follows the same per-variant rule | Injected the new runtime on the live PDP with a mocked variant map: red → Preorder + 5 form fields; black (mock sold out) → "Sold out" disabled, badge hidden, 0 fields, Notify-me visible; white (not in campaign) → Encore hidden, theme "Sold out" restored, Notify-me visible; back to red → restored |
| Variant changes were not detected on Debut (unnamed option selects, master `select[name=id]` updated programmatically) | `onVariantChange` now listens to any change in the form, `variant:change`/`variantChange`/`variant:changed` events, `popstate`, a MutationObserver on the form, and a 400 ms watch on the master variant id | Same test as above (state flipped on each pick) |
| Selling plan + `_preorder` properties stayed on the form after switching to a non-preorder variant → the theme's own Add-to-cart would have submitted a selling plan for a variant that has none | `clearEncoreFields()` on sold-out / not-in-campaign; re-armed on preorder | Same test: `fields: 0` on black/white |

Unit tests: 8 files / **40 tests** green (`inventory-policy` ×4, `storefront-config` +2 for variant scoping). `tsc` clean apart from the container's prisma-engine baseline; `npm run build` clean.

## 4. Open observations

- Short Sleeve **white** (`43628276154530`) is still `deny` while red/black are `continue` → the campaign's variant rows cover only red + black. That is now the intended behaviour on the storefront (white shows the theme's Sold out + Notify-me); if white should be preorderable, add it to the campaign.
- `Units offered` defaults to **100** per variant in the campaign form. With `orders/create` disabled the count never moves, so nothing will ever sell out on this store until the PCD step in §2 is done.
- The `/health` scheduler heartbeat could not be re-fetched fresh from the container today (egress blocked; WebFetch returned a cached 10:21Z body). Not a regression signal — check Railway logs for `[scheduler/inventory-policy]` after the next deploy.

## 5. Theme compatibility — what is verified vs reasoned

| Theme family | Mechanism | Status |
|---|---|---|
| **Debut** (vintage, published here) | App embed only (no app blocks on vintage themes); universal auto-mount into `form[action*="/cart/add"]`; direct `/cart/add.js` post bypasses the theme's disabled-button guard; badge inline after `.price-item--regular`; private `_preorder*` rows hidden in cart | VERIFIED by real clicks and screenshots today |
| Dawn and other OS 2.0 themes (Sense, Craft, Refresh, Ride, Studio, Spotlight…) | Same embed + optional app blocks (`preorder`, `notify-me`, `low-stock`, `countdown`); price selectors include Dawn's `.price__regular .price-item--regular`; variant changes detected via section re-render (MutationObserver + id watch); `shopify:section:load` re-init in the editor | REASONED from selectors and Shopify's app-block/app-embed model — **not clicked today**. Add Dawn (free) to the store and I will run the same E2E via `?preview_theme_id=` |
| Third-party (Impulse, Prestige, Turbo, Flex, Warehouse…) | Universal embed keys on the standard cart form; badge falls back through `.product__price`, `.product-price`, `[data-product-price]`, `.price`, then `[class*="price"]`, then the image, then above the button; cart drawer themes get the `cart:refresh` / `encore:added` events, though the runtime currently redirects to `/cart` after a preorder add | REASONED — untested. Cart-drawer "open drawer instead of redirect" would be a new behaviour (Feature Rule: needs your approval) |
| Headless / Hydrogen | App proxy JSON + `EncoreProxyBase` override; no Liquid | Out of scope for the theme extension |

## 6. Kanwar — in order

1. **Theme:** delete the `custom_cart_checkout` block from Debut's cart section (§1). Re-test Check out.
2. **Push + deploy** the six files already on your Mac (`git add -A && git commit -m "per-variant preorder offer, cap validation activation" && git push` then `npm run deploy`). Open the app once afterwards and accept the new `write_validations` scope.
3. **PCD on the dev store (10 min, no review needed):** Partner Dashboard → Apps → Encore → Distribution → choose a method; API access requests → Protected customer data → request, select **Email** and **Name**, give reasons; complete Data protection details. Tell me "PCD done" → I uncomment `orders/create`, `orders/paid`, `orders/cancelled` → you `npm run deploy`.
4. Railway: `RESEND_API_KEY` + `EMAIL_FROM` (verified domain) so BIS and preorder emails actually send.
5. Then the sold-out proof: set Units offered = 1 on red, place one test order → PDP flips to Sold out, badge disappears, variant returns to Deny. I'll capture it.
6. Optional but recommended before listing: install Dawn on the dev store so I can run the OS 2.0 E2E.
