# PHASE R1 / R1.5 AUDIT — Encore (started 2026-09-07, living document until submission)

Every row: what was checked, the evidence (command / screenshot / log line run on the date shown), and PASS / FAIL / PENDING. No row is marked PASS from memory.

## 1. Server & operations

| Check | Evidence | Result |
|---|---|---|
| Deploy live | `GET /health` → `status: ok, db: ok, scheduler.started: true, lastOutboxTickAt` 38 s old, outbox pending 0 / dead 11 (2026-09-04) | PASS |
| Scheduler ticking | Railway deploy logs filter `scheduler`: `[scheduler] started — outbox every 2min…` at boot; `[scheduler/outbox]` ticks with backoff | PASS |
| Outbox delivery | `sent=0 failed=N` on every tick → Nova backend offline; 11 rows DEAD. Nothing lost; needs R1.5-10 decision | PENDING (Kanwar decision) |
| Webhook delivery | Real inventory change 0→1→0 → `POST /webhooks/inventory_levels/update 200`, `POST /webhooks/products/update 200` (2026-09-01) | PASS |
| Webhook idempotency | orders/create dedupes by (shop, orderGid, orderRef); side-effects gated on `createdCount > 0`; unique index added to schema + P2002-tolerant create (2026-09-07) | PASS (code) / index applies on next deploy |
| orders/* subscriptions | Commented in `shopify.app.toml` (PCD gating) — no order reaches the app until R1.5-5/6 | **FAIL until PCD** |
| Email sending | Railway variables: no `RESEND_API_KEY`, no `EMAIL_FROM` (2026-09-01) | **FAIL until R1.5-7** |
| GDPR + uninstall webhooks | Routes present, compliance topics subscribed in toml | PASS (config) |
| Diagnostics removed | `grep -rn sendBeacon\|client-log app` → 0; `client-log.tsx` moved to `_to_delete/` (2026-09-07) | PASS (pending push) |

## 2. Admin (render-walk 2026-09-07, every route by URL + every nav link)

| Route | Result |
|---|---|
| `/app` dashboard | PASS — real zeros, outbox banner truthful, Reliability "All clear" |
| `/app/campaigns` | PASS — list, filters, relative time "6 days ago" |
| `/app/campaigns/:id` | PASS — real KPIs, cohort copy new; subtitle shows raw product GID while campaign targets the fake product (resolves after retarget) |
| `/app/campaigns/:id/edit` | PASS — form pre-filled |
| `/app/campaigns/new` | PASS — Publish disabled until required fields |
| `/app/cohorts` | PASS — empty state |
| `/app/waitlist` | PASS — honest zeros, import/export present |
| `/app/insights` (4 tabs) | PASS — empty states |
| `/app/demand`, `/app/benchmark`, `/app/low-stock`, `/app/markets` | PASS — benchmark copy merchant-language, markets reconciled timestamp real |
| `/app/notifications`, `/app/translations` | PASS — translations "0 / 8 translated" honest, samples as placeholders |
| `/app/settings`, `/app/plans`, `/app/help`, `/app/onboarding` | PASS |
| Nav links ×6 (parent-side) | PASS — each click lands on its route (URL verified) |
| In-frame buttons (bulk actions, pickers, Save, Choose plan) | PENDING — human spot-check (KANWAR-CHECKLIST #10); automation cannot click inside the embedded frame |

Cosmetic notes (non-blocking): sub-pages not in the nav highlight "Dashboard" (App Bridge default); markets reconciled time uses locale short date.

## 3. Storefront (dev-novasolutions, Debut theme)

| Check | Evidence | Result |
|---|---|---|
| Extension released + embed ON | PDP JS: `autoWrap: true, preInForm: true, notInForm: true, encoreJs: true` (2026-09-04) | PASS |
| Universal auto-mount | Preorder + notify shells relocated into `form[action*="/cart/add"]` next to the buy button | PASS |
| Config proxy | `/apps/encore/config?product_id=8021084340386` → `preorder.active: true`, `sellingPlanId: 5191565474`, `shipDate: 2026-09-30`, `badgePosition: auto`, `backInStock.enabled: true` (2026-09-13) | PASS |
| Preorder button on PDP | Rendered in the buy box with "Order will be shipped by September 30, 2026" (2026-09-13 screenshot) | PASS |
| Badge next to price | `encore-8` fell back to above-button (Debut's `.grid__item` layout column was mis-read as a product card). `encore-9` live: badge `encore-badge--inline` as next sibling of `.price-item--regular` (2026-09-13 screenshot) | PASS |
| Collection badge | `/collections/all`: `.encore-card-badge--overlay` on the Short Sleeve card; `/apps/encore/badges` → `{enabled:true, handles:["short-sleeve"]}` (2026-09-13 screenshot) | PASS |
| Preorder click → cart | FAIL on `encore-8`: Debut's `submit` handler calls `preventDefault()` while its own Add-to-cart is `aria-disabled` (sold out), so `form.requestSubmit()` was swallowed silently. Fixed runtime POSTs `FormData(form)` to `/cart/add.js` directly — verified in-page: request sent with `id`, `selling_plan=5191565474`, `properties[_preorder]=true`, `properties[_preorder_ship_date]`, `properties[Preorder]=Ships September 30, 2026`, `properties[_preorder_market]` | PASS (`encore-9` live) |
| Add-to-cart accepted by Shopify | Before deploy: 422 "already sold out" (all variants `deny`). After the Railway deploy the boot reconcile flipped the campaign's variants to `continue` (PDP JSON: 43628276088994 + 43628276121762 `continue`; 43628276154530 still `deny` — check the campaign's variant selection covers it). Real click on Preorder → `/cart` with 1 line (2026-09-13 screenshot) | PASS |
| Notify-me vs Preorder exclusivity | FAIL on `encore-8`: "Notify me when available" stacked above Preorder. Fixed: hidden while a preorder is active (and `[hidden]` now wins over `.encore-btn` display) — verified in-page `display: none` | PASS (`encore-9` live) |
| Stray badge on Share / Pin-it links | FAIL on `encore-8`: collection-badge scanner matched the product URL inside the Pinterest share href. Fixed: same-host links only, skip current product + share/breadcrumb/nav | PASS (`encore-9` live) |
| Cart line carries preorder data | `/cart.js`: `properties[_preorder]=true`, `_preorder_ship_date=2026-09-30T00:00:00.000Z`, `Preorder=Ships September 30, 2026`, `_preorder_market=931594402`, `selling_plan_allocation.selling_plan.id=5191565474` ("Short Sleeve preorder — preorder") | PASS |
| Mixed cart (Echo Bag, published 2026-09-04) + notice | Echo Bag added via theme (no Encore UI on it — correct). Cart = 1 regular + 1 preorder. FAIL on `encore-9`: the notice was an unconditional line under the PDP button and never on `/cart`. Fixed: `/apps/encore/config` now returns `cart.{mixedCartWarning,mixedCartMessage}`; runtime renders the notice above the cart form only when `/cart.js` holds both kinds, and the PDP line only when the cart already has in-stock items. Verified in-page on Debut (2026-09-13 screenshot) | PASS (pending push + `npm run deploy`) |
| Private `_preorder*` properties hidden in cart | FAIL on Debut (vintage theme prints `_preorder: true` rows). Fixed: runtime hides rows whose label matches `_preorder*`; merchant-facing "Preorder: Ships …" stays. Verified in-page | PASS (pending deploy) |
| Checkout reached (no payment) | Checkout page rendered with both lines, selling plan "Short Sleeve preorder — preorder" and "Preorder: Ships September 30, 2026" on the line, total Rs 119.48 incl. tax, test-gateway instructions shown; stopped before payment (2026-09-13 screenshot). NOTE: the dev store's Debut cart template contains a leftover custom script (`form#custom_cart_checkout` + jQuery handler posting to `http://127.0.0.1:8000/cart`) that `preventDefault()`s the Check out button — not Encore; reached checkout via a direct form submit. Kanwar: delete that block from the theme's cart section | PASS (with theme caveat) |

## 4. Build gates (container mirror, 2026-09-13)

`react-router typegen && tsc --noEmit` → baseline noise only (prisma engine unavailable in container; Kanwar's Mac typecheck is the authority) · `npm run build` → 0 errors · `vitest run` → 7 files, 34 tests passed.

## 5. Verdict so far

Storefront E2E complete on Debut: PDP button → cart (properties + selling plan) → mixed cart with notice → checkout, all PASS on 2026-09-13. Two runtime fixes from this run (mixed-cart notice, private-property hiding) plus the `cart` config block are committed and await push + `npm run deploy`. Submission remains gated on PCD approval + email keys (external). This file is updated as each PENDING row resolves.
