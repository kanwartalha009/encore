# Phase 0 — Blocking spikes (desk verification)

> Facts verified against shopify.dev (June 2026). **Final acceptance for both spikes is a
> LIVE test on the EU multi-market dev store** (Shop Pay on) + a non-Shopify-Payments store —
> deferred until those stores + secrets exist. This doc resolves the *engineering questions*;
> it does not substitute for the live pass.

## Spike A — Per-market selling plans (blocks Phase 2)

**Verified:**
- Pre-order selling plans are created with `sellingPlanGroupCreate` and are **linked to products
  and product variants — not to markets**. Inventory is **location-based**. Shopify has **no
  native per-market scoping** of a selling plan.

**Therefore the "in-stock here, preorder there" rule is app-layer logic:**
1. Storefront block calls the app proxy (`/apps/encore/preorder`) with the product + buyer context.
2. App detects the **buyer's market** (Markets `@inContext` / shipping destination) and checks the
   **real location inventory** mapped to that market.
3. Sellable stock for that market → render **Buy** (no selling plan). No sellable stock → render
   **Preorder** and apply the variant's pre-order selling plan.
4. `inventory-reconcile` job + the `inventory_levels/update` webhook flip Buy/Preorder as stock moves.
5. **Negative guarantee** (never preorder where sellable stock exists for that market) is enforced
   at both the proxy check and the reconcile job.

**Live acceptance (deferred):** a market with sellable stock shows Buy; a market without shows
Preorder — same product, reconciled to location inventory.

## Spike B — Payment-method dependency + fallback (blocks Phase 1)

**Verified:**
- Deferred/charge-later relies on Shopify **vaulting the customer's payment method** so the merchant
  can "collect the remaining balance amount **without contacting the customer**," then charging it
  via `orderCreateMandatePayment` against a `PaymentMandate` (query `vaultedPaymentMethods` on the
  Order; the mutation is **idempotent**, requires an `idempotencyKey`). This vault-and-mandate path
  is a **Shopify Payments / Shop Pay** capability — third-party gateways don't expose it.
- Plan shape: `sellingPlanGroupCreate` → `category: PRE_ORDER`, `billingPolicy.fixed.checkoutCharge`
  (deposit at checkout), `remainingBalanceChargeTrigger: ON_FULFILLMENT` (**GA in API 2026-01**;
  our `api_version 2026-04` supports it) or a fixed date.
- **One deferred due date per order** (earliest applies; `ON_FULFILLMENT` takes precedence).
- **Selling-plan records are deleted 48h after uninstall** (`SellingPlanGroup`, `SellingPlan`,
  policies, product associations). Products/variants are not deleted. → the `purge-uninstalled` job
  and any restore expectation must account for this.
- **App responsibilities** (verified division of labor): schedule the charge (`ChargeSchedule` +
  `charge-later-collect` job), automate payment-failure handling, idempotent mandate charge.
  Shopify owns vaulting, customer consent, and collecting the initial payment.
- Vaulting is permitted **only** for deferred/recurring payments (prohibited: installments,
  layaway, crowdfunding, overbilling).

**Fallback design (never a broken checkout):** detect Shop Pay/Shopify Payments at install
(`Shop.paymentCapability`) and per checkout. Available → deposit + charge-later (`ON_FULFILLMENT`).
Not available (Mollie / Viva / Klarna-gateway) → **deposit-only** or **pay-now** selling plan; no
vaulted later-charge is attempted.

**Live acceptance (deferred):** deposit charges at checkout on a Shopify-Payments store, balance
collects on fulfilment, one due date per order; and a non-Shopify-Payments store falls back cleanly.

## Related (confirm live, not blocking Phase 0)
- **EU BNPL** (Scalapay / Klarna / seQura) as the deposit mechanism — these are checkout payment
  methods (no app key); confirm they can serve the deposit inside the selling-plan flow on the store.
- **Discount compatibility** — Shopify states selling plans are "compatible with all platform
  features (including discounts)"; the build pack still requires live verification against automatic
  discounts, codes, and Buy-X-Get-Y (Phase 2).
