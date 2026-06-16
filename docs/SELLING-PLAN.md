# Encore — selling-plan service

Makes **deposit** and **pay-later** preorders actually work by mapping each
campaign onto a Shopify-native **pre-order Selling Plan**. Shopify then vaults the
card and collects the balance per the plan — Encore doesn't touch money directly.

Core: `app/models/selling-plan.server.ts`.

## What it does

`syncCampaignSellingPlan(admin, shop, campaignId)` — idempotent. Called after
create, edit, and status changes:

- **Eligibility:** status `LIVE`/`SCHEDULED` + `productMode === SPECIFIC` + at
  least one product. Otherwise any existing plan is torn down.
- **Create / update:** `sellingPlanGroupCreate` (or `sellingPlanGroupUpdate`),
  then reconciles the group's products (add/remove diff).
- **Stores** `sellingPlanGroupId` / `sellingPlanId` / `sellingPlanStatus` on the
  Campaign.

`deleteCampaignSellingPlan(...)` — `sellingPlanGroupDelete`, clears the GIDs
(runs before the campaign row is deleted).

`detectPaymentCapability(admin)` — informational; see fallback below.

### Config → Shopify policy mapping

| Encore payment mode | `checkoutCharge` | `remainingBalanceChargeTrigger` |
|---|---|---|
| **Pay now** (full, ship later) | 100% | `NO_REMAINING_BALANCE` |
| **Deposit + balance** | deposit % or fixed | `EXACT_TIME` (ship date − N days) or `TIME_AFTER_CHECKOUT` (`P{N}D`) if no ship date |
| **Pay later** (vault, charge on ship) | 0% | `EXACT_TIME` (ship date) or `TIME_AFTER_CHECKOUT` `P30D` |

Delivery `fulfillmentTrigger: UNKNOWN`; inventory `reserve: ON_FULFILLMENT`;
optional **percentage** discount → `pricingPolicies`. (`category: PRE_ORDER`.)

### Payment-capability detection (deferred eligibility)

Deferred charges need a gateway that can defer payment (e.g. Shopify Payments).
There's no reliable proactive Admin field, so the **authoritative check happens at
publish**: if Shopify rejects the deferred plan, the service **transparently
retries as pay-in-full** and records `sellingPlanStatus = PAY_NOW_FALLBACK` (the
rejection messages come back in `warnings`). Pay-now preorders work on any gateway.

## Storefront

`proxy.config` now returns the **numeric** `sellingPlanId` in the preorder block.
`encore.js` injects a hidden `selling_plan` field into the product form on
add-to-cart, so Shopify applies the deposit/pay-later billing. Without a synced
plan it falls back to a plain add-to-cart + the line-item properties.

## Running it on the Mac

Two one-time steps before `npm run dev`:

```bash
cd shopify/encore
npx prisma db push     # adds Campaign.sellingPlanGroupId / sellingPlanId / sellingPlanStatus
shopify app dev        # picks up the new scope: write_purchase_options
```

The new scope means the merchant **re-grants permissions** on next load
(handled by the existing `app/scopes_update` webhook). Then publish a deposit or
pay-later preorder on a **specific product** and check the product's selling plans
in the Shopify admin, and the cart shows the plan name at checkout.

## Hard no-oversell (Cart & Checkout Validation Function)

Two layers cap preorders:

1. **Offer-level** (`models/capacity.server.ts`) — the storefront config hides the
   preorder offer + skips the `selling_plan` once a campaign/variant cap is hit.
2. **Hard guard** (`extensions/encore-preorder-cap`) — a Cart & Checkout
   Validation **Function** that blocks checkout when a line's quantity exceeds the
   variant's `encore.preorder_remaining` metafield.

The metafield is the bridge (Functions can't hit the DB): `models/preorder-cap.server.ts`
writes `encore.preorder_remaining` / `encore.preorder_cap` per capped variant —
on selling-plan sync (`remaining = unitsOffered − sold`) and decrements on
`orders/create`. It also creates the two `PRODUCTVARIANT` metafield definitions
(idempotent) so the Function can read them.

**Build / deploy on the Mac:**

```bash
cd shopify/encore
shopify app deploy   # compiles the Function to Wasm (javy) + registers it
```

Then in the dev store: **Settings → Checkout → (Cart and checkout validation)** —
add the *Encore preorder cap* validation. Set a per-variant `unitsOffered` on a
preorder, publish, and try to add more than the cap → checkout is blocked.

> If the CLI's Function scaffold differs from this version, run
> `shopify app generate extension` (Function → Cart and checkout validation →
> JavaScript) and drop in `src/cart_validations_generate_run.{js,graphql}`. If the
> validation can't read the metafield, confirm the `encore.preorder_remaining`
> definition exists (the app creates it on first sync). The `target: "$.cart"` in
> the run file is JSONPath; older API versions use `"cart"`.

**Residual race:** the metafield isn't transactionally decremented at validation
time, so two simultaneous last-unit checkouts are still a known Shopify edge —
true atomicity needs inventory-backed caps.

## Limitations / follow-ups

- Selling plans attach to **specific products** — `All products` / `Collection`
  preorders fall back to the inventory-rules path (no deferred billing).
- Fixed-amount **discounts** are left to native Shopify discounts (only
  percentage discounts go into the plan) to avoid currency assumptions.
- Deposit/balance **tracking rows** (`PreOrder`) still populate from the
  `orders/*` webhooks, which stay disabled until PCD approval — the *money* is
  handled by Shopify via the plan regardless.
