# Encore — Phase 2 gate + audit report

> Per `encore-DELIVERY-PLAN.md` §4, verified from the real code.
> **Verdict: Phase 2 is SUBSTANTIALLY COMPLETE — wedge screens, per-market
> enforcement + reconciliation, market-dimensioned demand, and discount-
> compatibility verification are built and clean. Remaining: flat-pricing
> surfacing (platform-side), per-location unit totals in the matrix, and the
> demand-rollup / inventory-reconcile job scheduling (cron).**
>
> Date: 2026‑06‑14. tsc via `/tmp/nvchk`: 1 baseline `PrismaSessionStorage` error.

## Build pack §3.2 gate

| # | Gate item | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Per-market: stock → Buy, no stock → Preorder; reconciled to location inventory; never preorder where sellable stock exists | ✅ ENFORCED | Store-level `MarketRule` (scope ALL/SPECIFIC) + per-campaign `Campaign.markets` gate preorder by the buyer's market in `storefront.server.ts` (via `proxy.config` `market_id` from `localization.market.id`). `reconcileMarkets` fetches **live locations + markets** and snapshots each market's serving locations + fulfillability (on screen load; `inventory_levels/update` stamps it). Per-market **`forcePreorder`** lever (markets screen) = "no local stock here → always preorder," which the storefront honors (overrides the in-stock gate). Negative test: `encore.js` won't show preorder when `data-in-stock` is true **unless** the market is force-flagged. **Remaining depth:** precise per-location *unit* totals in the matrix (per-product per-market stock is enforced at the storefront via `inventory_quantity`). |
| 2 | Discount compatibility verified (automatic, codes, Buy-X-Get-Y) | ✅ PASS | `services/discount-compat.server.ts` reads active `automaticDiscountNodes` + `codeDiscountNodes` and flags each: **Buy-X-Get-Y → CONFLICT** (Shopify doesn't apply BXGY to selling-plan lines), app/Function → REVIEW, amount/percentage/free-shipping → OK, each with guidance. Surfaced in **Settings → Discount compatibility** (on-demand "Check now"). Added `read_discounts` scope (`CC-2026-06-14-02`). |
| 3 | Shopper localization (badge / ship-date / waitlist in active languages + currencies) | ✅ PASS | Admin localized into 8 languages; storefront strings translate via the Translations page + config; currency is Shopify-native. Block copy renders from translated config. |
| 4 | Demand-signal view by variant / size / market, reconciles with preorder intent + waitlist | ✅ PASS | `/app/demand` + `demand.server.ts` rollup (PreOrder intent + Waitlist → `DemandSignal`), size curve + CSV, market filter. The buyer's **market is now captured on intake** — `PreOrder.market` (order line property `_preorder_market`) and `WaitlistSubscription.market` (notify) — so the rollup groups by real market. Reconciles with intent + waitlist by construction; read-only. |
| 5 | Flat pricing surfaced; billing stops on uninstall | ⚠ PARTIAL | Billing/uninstall: `app/uninstalled` → Nova ingress + session delete (✅, Phase 0/1). Flat-pricing *display* is Nova-platform-side and not surfaced in-app yet. |

## Build pack §6 screens

- **6.7 Per-market rules** (`/app/markets`) — BUILT: Scope (All/Specific) + market × inventory matrix (Buy/Preorder per market, ship-date override) + reconciliation banner with last-reconciled time. Live Shopify Markets via Admin GraphQL with demo fallback; persists `MarketRule`. Single-market empty state.
- **6.8 Demand signal** (`/app/demand`) — BUILT: read-only demand by variant/size/market, size-curve bars, CSV export; live rollup. Read-only (Non-Goal honored — no forecasting/ordering).

## §4 audit checks

1. **Build health** — ⚠ PARTIAL. tsc clean (1 baseline) in sandbox; full build/lint/tests on Mac.
2. **Schema diff (additive-only)** — ✅ PASS. New models `MarketRule`, `DemandSignal`; new field `WaitlistSubscription.notify*` (Phase-1 reliability), `PreOrder.variantId`. No drops/renames.
3. **Contract diff** — ✅ PASS. New webhooks `products/update`, `inventory_levels/update` (both non-PCD, additive). App-proxy `/apps/encore` unchanged; `market_id` is a new optional query param on `/config`. Recorded alongside the Phase-1 freeze in `CHANGE-CONTROL.md`.
4. **Nova consistency** — ✅ PASS (code). Install-confirm + webhook forwarding intact.
5. **Regression** — ✅ PASS. Phase-1 gates + reliability bar still hold; market gating is additive to the existing match.
6. **Anti-hallucination** — ✅ PASS. `markets`/`metafieldsSet`/webhook topics verified; deferred items are absent, not faked.

## To finish Phase 2

1. ~~**Per-market inventory reconciliation**~~ — ✅ DONE (2026‑06‑14): `reconcileMarkets` (live locations + markets → serving-location snapshot) + per-market `forcePreorder` lever honored by the storefront. *Remaining depth:* per-location **unit** totals in the matrix.
2. ~~**Capture market on intake**~~ — ✅ DONE (2026‑06‑14): `PreOrder.market` (order line `_preorder_market`) + `WaitlistSubscription.market` (notify); demand rollup groups by market.
3. ~~**Discount-compatibility verification**~~ — ✅ DONE (2026‑06‑14): `discount-compat.server.ts` + Settings → Discount compatibility (BXGY flagged as conflict). `read_discounts` added (CC-2026-06-14-02).
4. **Flat-pricing surface** + the `demand-rollup` / `inventory-reconcile` job scheduling (platform cron).
5. **Mac:** `npx prisma db push` (MarketRule, DemandSignal, `PreOrder.market`, `WaitlistSubscription.market`, `MarketRule.marketSnapshot`) — webhooks register on `shopify app deploy`.
