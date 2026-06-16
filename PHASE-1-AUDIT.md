# Encore — Phase 1 gate + audit report

> Per `encore-DELIVERY-PLAN.md` §4, verified from the **real code** (not checkboxes).
> **Verdict: Phase 1 is NOT complete — FLAGGED.** Core mechanics that ship money
> (selling plans) and the storefront block are PASS; order‑side mechanics
> (tagging, ship‑date metafield, no‑oversell) are missing or PCD‑gated.
>
> Date: 2026‑06‑14. Harness: tsc via `/tmp/nvchk` (1 baseline `PrismaSessionStorage` error).

## Context: deliberate product divergence

The app was intentionally re‑scoped this cycle from the build pack's OOS‑scanner
framing (§6.2) to a **campaign model** (Preorder Novafied / Globo‑aligned): a
merchant *creates a preorder* and picks products, rather than scanning OOS
variants. Gate items are judged against intent where the framing moved.

## Build pack §3.1 gate

| # | Gate item | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | OOS scanner flags every zero/neg variant; one‑click + bulk enable, idempotent | ⚠ DIVERGED | No scanner route. Replaced by campaign create flow (`app.campaigns.new.tsx`, `CampaignForm.tsx`) — product re‑scope, not a regression. The "scan OOS → enable" screen does **not** exist. |
| 2 | Selling plan group created/linked per config; pay‑now / deposit / charge‑later configurable | ✅ PASS | `app/models/selling-plan.server.ts` (`sellingPlanGroupCreate`/`Update`, all 3 modes → billing policy); wired in create/edit/bulk actions; GIDs stored on Campaign. Live charge verify pending on Mac. |
| 3 | No‑oversell: preorder limit enforced — reverts to sold‑out/waitlist at cap, no error | ⚠ ENFORCED (offer‑level) | **Implemented** (2026‑06‑14): `models/capacity.server.ts` computes live remaining vs `maxPerCampaign` + per‑variant `unitsOffered` (new `PreOrder.variantId` for per‑variant counts). `getStorefrontConfig` returns `soldOut`/`remaining`; at the cap the preorder offer is hidden, the `selling_plan` is **not** injected, and `encore.js` hands off to the back‑in‑stock button — reverts to sold‑out/waitlist, no error. Reversible (refund frees capacity). **Hard guard added** (2026‑06‑14): a Cart & Checkout Validation **Function** (`extensions/encore-preorder-cap`) blocks checkout when a line's qty exceeds the variant's `encore.preorder_remaining` metafield, which `preorder-cap.server.ts` maintains on selling‑plan sync + `orders/create`. Builds to Wasm on `shopify app deploy`. Residual: the metafield isn't transactionally decremented at validation time, so two simultaneous last‑unit checkouts remain a known Shopify edge (true atomicity needs inventory‑backed caps). |
| 4 | Every preorder line tagged 100% (verified post‑write); ship‑date written to order/line metafield; clear customer confirmation | ⚠ CODE DONE · PCD‑gated | **Implemented** (2026‑06‑14): `applyPreorderOrderMetadata` in `services/orders.server.ts` runs `tagsAdd` (`preorder` + configured tag) + `metafieldsSet` (`encore.is_preorder` boolean, `encore.ship_date` date) and **verifies post‑write** (re‑queries order tags + flag; webhook returns 500 to force retry until confirmed). Wired in `webhooks.orders.create.tsx`. **Activation still PCD‑gated** — `orders/*` stays commented in the toml until Protected Customer Data is approved. Customer confirmation remains partial (storefront note + cart line label + selling‑plan name); no confirmation email yet. |
| 5 | Storefront block placeable via theme customizer (no code edits), CLS‑safe | ✅ PASS | Placeable: 3 app blocks + embed in `extensions/encore-storefront/` (theme editor). **CLS:** the preorder block now reserves the button's 44px height (skeleton, `preorder.liquid` + `encore.css`) for products that already carry a preorder selling plan, so the real button swaps in at the same height — no shift; non‑plan products render nothing. Residual: ALL/COLLECTION (no‑plan) preorders still pop in (server‑side eligibility = follow‑up). |
| 6 | Stable settings — changing one setting never alters an unrelated one | ✅ PASS | `models/settings.server.ts` persists each section as one JSON blob keyed by field; ~37 independent `useState` fields in `app.settings.tsx`; no cross‑writes. |

## §4 audit checks

1. **Build health** — ⚠ PARTIAL. `tsc` clean in sandbox (1 known baseline). Full `npm run build`, lint, and tests run on the Mac (sandbox can't — macOS‑built `node_modules` / rollup native binary). No automated test suite exists yet.
2. **Schema diff (additive‑only)** — ✅ PASS. All Phase‑1 additions are additive: `Campaign.markets`, `AppSettings`, `Translation`, `Campaign.sellingPlanGroupId/sellingPlanId/sellingPlanStatus`, `WaitlistSubscription`. Nothing dropped/renamed.
3. **Contract diff** — ✅ PASS (change‑controlled). Scope `+write_purchase_options` (9 → 10) **recorded** as C2 `CC‑2026‑06‑14‑01` in `CHANGE‑CONTROL.md` (additive, backward‑compatible, re‑grant via `scopes_update`). Phase‑1 contracts now **frozen** there: order tag(s) (`preorder` + configured), order metafields (`encore.is_preorder`/`ship_date`/`ship_dates`), selling‑plan (`merchantCode = encore-{id}`, `PRE_ORDER`), app‑proxy `/apps/encore`. Webhook topics unchanged (orders/* still PCD‑disabled).
4. **Nova consistency** — ✅ PASS (code) / pending (live). `app/uninstalled` + `app/scopes_update` forward to the Nova ingress (`lib/nova.server.ts`); `afterAuth` install‑confirm intact. Charges/commissions are platform‑side; verify in admin + app‑admin on the Mac.
5. **Regression (earlier gates + reliability bar §8)** — ⚠ MOSTLY GREEN. Reliability bar: *never oversell* (✅ offer‑level cap; hard checkout guarantee = follow‑up Function), *never untagged* (✅ code done + verified post‑write — dormant until PCD enables the webhook), *graceful payment fallback* (✅ selling‑plan pay‑now fallback), *never bill after uninstall* (✅ uninstall → ingress + session delete), *back‑in‑stock never silently fails* (✅ `products/update` restock → dispatch pipeline in `services/waitlist-notify.server.ts`: idempotent, retryable, every subscriber ends `SENT` or `FAILED`‑with‑reason and is surfaced in the admin; Klaviyo sender + manual Notify/Retry). Phase 0 frozen contracts otherwise intact.
6. **Anti‑hallucination** — ✅ PASS. Every referenced route/field/scope exists; `sellingPlanGroupCreate/Update/AddProducts/RemoveProducts/Delete`, `PRE_ORDER` category, billing/delivery/inventory policies, and `write_purchase_options` all verified against shopify.dev. No invented APIs; the missing tag/metafield writes are *absent*, not faked.
7. **Report** — One or more FLAGs ⇒ **Phase 1 not done.**

## What IS done (PASS) this phase

- Selling‑plan service (deposit / pay‑later / pay‑now) + publish‑time capability fallback (`PAY_NOW_FALLBACK`).
- Storefront theme app extension (preorder button + line‑item props, back‑in‑stock popup, low‑stock meter) over the app proxy; `selling_plan` attached on add‑to‑cart.
- Full admin: dashboard, campaigns list/create/edit/detail, orders/cohorts, low stock, back in stock, settings — persisted; localized into 8 languages.

## To close Phase 1 (gap list, priority order)

1. ~~**Order tagging + ship‑date metafield**~~ — ✅ DONE (2026‑06‑14): `applyPreorderOrderMetadata` tags + writes `encore.is_preorder`/`encore.ship_date`, verified post‑write, wired into `orders/create`. *Activation still needs the webhook (item 2).*
2. **Re‑enable `orders/*` webhooks** after PCD (Protected Customer Data) approval; add the GDPR compliance topics. (Until then the tagging code is dormant.)
3. ~~**No‑oversell enforcement**~~ — ✅ DONE (2026‑06‑14): offer‑level cap (`capacity.server.ts`) **+ hard guard** — Cart & Checkout Validation Function (`extensions/encore-preorder-cap`) reading the app‑maintained `encore.preorder_remaining` metafield. Build/deploy on Mac via `shopify app deploy`; merchant adds the validation in checkout settings.
4. ~~**CLS**~~ — ✅ DONE (2026‑06‑14): the block reserves the button's 44px height (skeleton) for products that already carry a preorder selling plan, so the button swaps in without shifting; non‑plan products render nothing. *Residual:* ALL/COLLECTION (no‑plan) preorders still pop in — server‑side eligibility for those is the follow‑up.
5. ~~**Change‑control the scope bump**~~ — ✅ DONE: `CC‑2026‑06‑14‑01` in `CHANGE‑CONTROL.md`.
6. **Build health on Mac** — `npm install && npx prisma generate && npx prisma db push && npm run build`; add a minimal test for the selling‑plan mapping + no‑oversell.
7. **Decide the OOS‑scanner divergence** — either accept the campaign model as the Phase‑1 surface (update build pack §3.1/§6.2) or add a scanner view.
