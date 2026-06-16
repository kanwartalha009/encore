# Change Control

This document is the contract for how changes are requested and applied. Its purpose: **a change to one module must never silently alter the architecture or other modules.**

## Invariants (architecture-level, frozen)

Changing any of these is an **architecture change**, never a module change:

1. **I-1 Monorepo layout** — `apps/{api,web,admin,agency}` + `packages/{database,shared,tsconfig}`. Turborepo + pnpm.
2. **I-2 Single API** — all business logic lives in `apps/api` (NestJS). Next.js apps never talk to the database directly; they call the API.
3. **I-3 Single schema package** — all Prisma models live in `packages/database`. No app defines its own tables.
4. **I-4 Module boundaries** — backend modules (see `02-modules/`) communicate through service interfaces, never by reaching into another module's repository/tables.
5. **I-5 Money is a ledger** — `Charge`, `Commission`, `Payout` rows are append-only. Corrections are new reversal entries, never updates/deletes.
6. **I-6 Billing source of truth** — revenue enters the system only via Shopify Billing webhooks (verified HMAC). Commissions are derived, never manually inserted (manual adjustments use a typed `ADJUSTMENT` ledger entry).
7. **I-7 Payout providers are pluggable** — payouts go through the `PayoutProvider` interface (`manual`, `stripe-connect`, `paypal`). Adding a provider never touches commission logic.
8. **I-8 Attribution** — agency referral is captured at install time (`Installation.agencyId`) and is immutable for the life of the installation.
9. **I-9 Multi-tenancy** — agency-scoped data is always filtered by `agencyId` at the API layer; the agency app resolves its tenant from the subdomain.
10. **I-10 AuthN/AuthZ** — JWT (access+refresh) issued by the API; RBAC permissions enforced by guards in the API only. UI hiding is cosmetic, not security.

## Change classification

When a change is requested, classify it before writing code:

| Class | Definition | Process |
|---|---|---|
| **C1 — Module-internal** | Touches one module's spec + code; no API contract or schema change consumed by others | Update the module spec, implement, done |
| **C2 — Contract** | Changes an API endpoint shape, shared type, or Prisma model used by >1 module/app | Update module spec + `domain-model.md`, list consumers, migrate all consumers in the same change |
| **C3 — Architecture** | Violates or amends an invariant above | **STOP. Do not implement.** Produce an impact report: which invariant, which modules affected, migration steps, rollback plan. Get explicit approval, then record an ADR in `01-architecture/decisions/`. |

## Working agreement with the assistant

When Kanwar requests a change, the assistant must:

1. State the classification (C1/C2/C3) and which module spec(s) it maps to.
2. For C2: list every consumer that must change.
3. For C3: refuse to implement immediately; propose resolution steps and wait for approval.
4. Never invent endpoints, models, or fields not present in these specs — if something is missing, flag it as a spec gap first.

---

## Encore app — contract change log

Frozen at Phase 0: 9 OAuth scopes, app-proxy base `/apps/encore`, webhook topics, token-exchange auth. Selling-plan / order-tag / metafield contracts are defined and frozen in Phase 1 (below).

### CC-2026-06-14-01 — Add `write_purchase_options` scope · **C2** (contract, additive)

- **What:** `shopify.app.toml` access scopes 9 → 10 — added `write_purchase_options`.
- **Why:** `sellingPlanGroupCreate/Update/AddProducts/RemoveProducts/Delete` (deposit / pay-later preorders, task #17) require `write_products` **+** `write_purchase_options`.
- **Classification:** C2 — additive and backward-compatible. Touches no architecture invariant (I-1…I-10); alters no existing scope, endpoint, or model.
- **Consumers:** `app/models/selling-plan.server.ts` only. No other module depends on it.
- **Migration:** merchants re-grant on next load via the existing `app/scopes_update` webhook (`webhooks.app.scopes_update.tsx`); `shopify app deploy` pushes the new scope set.
- **Rollback:** drop the scope + the selling-plan service calls; preorders fall back to the pay-now line-item-property flow.
- **Proof:** scope + mutations verified against the Admin GraphQL reference on shopify.dev (PHASE-1-AUDIT §4.6).

### CC-2026-06-14-02 — Add `read_discounts` scope · **C2** (contract, additive)

- **What:** access scopes +`read_discounts`.
- **Why:** Phase-2 discount-compatibility verification reads `automaticDiscountNodes` / `codeDiscountNodes` to flag BXGY-vs-preorder conflicts (`services/discount-compat.server.ts`).
- **Classification:** C2 — additive, read-only, backward-compatible; no invariant touched.
- **Consumers:** `app/services/discount-compat.server.ts` only.
- **Migration:** re-grant on next load via `scopes_update`; `shopify app deploy` pushes it.
- **Rollback:** drop the scope + the discount-compat card; nothing else depends on it.

### CC-2026-06-15-01 — Phase 3 Flow + Customer Account surfaces · **C2** (contract, additive)

- **What:** four new app extensions + two new public app endpoints — no new OAuth scopes.
  - Flow **triggers**: `encore-preorder-placed`, `encore-waitlist-signup`, `encore-restock-detected` (emitted via `flowTriggerReceive` from `app/services/flow.server.ts`).
  - Flow **action**: `encore-tag-order` → runtime endpoint `POST /flow/tag-order` (HMAC-verified, `tagsAdd`, idempotent).
  - Customer Account **UI extension**: `encore-customer-account` (`customer-account.order-index.block.render`) → data endpoint `POST /customer/portal` (customer-account session-token verified; returns the signed-in shopper's pre-orders + waitlist).
- **Why:** Phase-3 differentiators — make Encore a node in merchants' Flow automations and give shoppers a self-serve pre-order/waitlist view. **ARRS intentionally omitted** (Encore stays independent; an "emit ARRS event" Flow action can be added later without touching these).
- **Classification:** C2 — additive. No invariant touched; no existing endpoint/model/scope altered. Both new endpoints are new routes.
- **Scopes:** none added. The action uses `write_orders` (already granted); the customer-account email lookup uses `read_customers` (already granted).
- **Consumers:** `flow.server.ts` (emit) wired into `webhooks.orders.create` (PCD-gated — fires once `orders/*` is enabled), `proxy.notify`, `webhooks.products.update`. `flow.tag-order.tsx` + `customer.portal.tsx` are self-contained routes.
- **Migration:** `shopify app deploy` registers the extensions; merchants add the triggers/action/block to their own Flow/account. `runtime_url` (action) and `APP_URL` (extension) must be set to the deployed app URL per environment.
- **Rollback:** delete the four extension dirs + the two routes + `flow.server.ts`; the core order/waitlist/restock paths are unchanged (every emit is best-effort and swallows its own errors).
- **Proof:** `flowTriggerReceive` + `tagsAdd` + `customer{defaultEmailAddress}` validated on shopify.dev (2025-10); Flow action HMAC scheme = `base64(HMAC-SHA256(raw_body, client_secret))` per the Flow action-endpoints reference; tsc clean (1 baseline).

### CC-2026-06-15-02 — Phase 4 GDPR compliance + purge job + reliability audit · **C2** (contract, additive)

- **What:** three mandatory GDPR compliance webhooks + a purge cron + two additive schema fields — no new OAuth scopes.
  - Compliance webhooks: `customers/data_request`, `customers/redact`, `shop/redact` (declared via `compliance_topics` in `shopify.app.toml`; routes `webhooks.customers.data_request/redact` + `webhooks.shop.redact`; logic in `app/services/gdpr.server.ts`). HMAC-verified by `authenticate.webhook` (auto-401), respond 200, purge/export by `shop` + email.
  - Purge job: `POST /cron/purge-uninstalled` (token-guarded by `ENCORE_CRON_SECRET`) hard-deletes shop data 48h after uninstall.
  - Schema (additive): `PreOrder.tagged` (Boolean, default false) + model `UninstalledShop` (shop, uninstalledAt, purgedAt).
  - Reliability audit (`app/services/reliability.server.ts`) + Dashboard reliability card — read-only, real counters.
- **Why:** Phase-4 reliability hardening + Built-for-Shopify / App-Store compliance (mandatory privacy webhooks; 48h data purge; the §8 "must never" bar measured, not estimated).
- **Classification:** C2 — additive. No invariant touched; no existing endpoint/model/scope altered.
- **Scopes:** none added (the GDPR webhooks need no scope; reliability reads existing tables).
- **Consumers:** `gdpr.server.ts` (3 GDPR routes + `cron.purge-uninstalled` + `shop/redact`), `reliability.server.ts` (dashboard loader), `webhooks.app.uninstalled` (stamps `UninstalledShop`), `webhooks.orders.create` (stamps `PreOrder.tagged`).
- **Migration:** `prisma db push` (`PreOrder.tagged`, `UninstalledShop`); `shopify app deploy` registers the GDPR webhooks; set `ENCORE_CRON_SECRET` + schedule the purge.
- **Rollback:** remove the 3 GDPR routes + cron + the two services; drop the two schema additions. Core paths unchanged.
- **Proof:** compliance webhook HMAC/200/401 + the `compliance_topics` toml shape verified on shopify.dev; deposits use Shopify-native per-market tax (no hand-computed VAT); tsc clean (1 baseline).

### CC-2026-06-15-03 — Phase 5 recovered-demand benchmark · **C2** (contract, additive)

- **What:** the pilot benchmark instrumentation — one admin screen, one settings section, one additive column; no new scopes/webhooks.
  - `/app/benchmark` (admin screen) + `app/services/benchmark.server.ts` (`getBenchmark` + `markWaitlistConverted`).
  - `markWaitlistConverted` stamps `WaitlistSubscription.convertedAt` from `orders/create` (best-effort; dormant until PCD).
  - New isolated settings section `AppSettings.benchmark` (incumbent baseline) — schema + `settings.server.ts`.
- **Why:** Phase-5 pilot/validation gate — measure Encore's waitlist→purchase recovery lift vs the incumbent and the zero-incident proof, natively (no ARRS dependency).
- **Classification:** C2 — additive. No invariant touched; no existing endpoint/model/scope altered.
- **Scopes:** none added. Conversion uses the existing `orders/*` (PCD-gated) path; the benchmark reads existing tables.
- **Consumers:** `benchmark.server.ts` (the `/app/benchmark` loader/action + the orders/create conversion stamp). The new `benchmark` settings section is written only by `/app/benchmark`.
- **Migration:** `prisma db push` (`AppSettings.benchmark`); enable `orders/*` after PCD so the conversion numerator moves.
- **Rollback:** remove `/app/benchmark` + `benchmark.server.ts` + the orders/create call + the `benchmark` column/section. Nothing else depends on it.
- **Proof:** conversion reads real `convertedAt`/`notifyStatus`; lift is computed from a saved baseline; tsc clean (1 baseline). Deploy + install-count are field work (PILOT-RUNBOOK.md), not code.

### CC-2026-06-15-04 — Notifications N1 (provider choice + Flow/Klaviyo email paths) · **C2** (contract, additive)

- **What:** customer-email notifications via the merchant's existing tooling — no new scopes, no new merchant cost.
  - `AppSettings.notifications` section (provider + editable/translatable templates) — schema + `settings.server.ts`.
  - Services: `notifications.server.ts` (4 message types, resolve+render), `email.server.ts` (env-pluggable transactional transport), `klaviyo.server.ts` (event helper).
  - Flow **action** `encore-send-email` → `POST /flow/send-email` (HMAC-verified; renders the template + sends). 3 per-customer **triggers**: `back-in-stock-ready`, `ship-date-updated`, `balance-due`.
  - Back-in-stock dispatch now routes by provider (Klaviyo event + copy props / per-customer Flow trigger / off); `Encore Preorder Placed` Klaviyo event on orders/create. Screen `/app/notifications` + nav.
- **Why:** ride Shopify Flow + Klaviyo (most stores have one) so Encore never charges merchants for email. Klaviyo flows are delivered as **templates** (Create-Flow API is beta/non-production); the Shopify-Flow path uses a custom **Send email** action because Flow's built-in email is staff-only.
- **Classification:** C2 — additive. No invariant/endpoint/model/scope altered.
- **Scopes:** none. (Klaviyo uses the merchant's pasted key; the transactional transport is Encore-side env.)
- **Consumers:** `waitlist-notify` (provider routing), `webhooks.orders.create` (Klaviyo preorder event), `flow.send-email` (action). New `notifications` settings section written only by `/app/notifications`.
- **Migration:** `prisma db push` (`AppSettings.notifications`); `shopify app deploy` (1 action + 3 triggers); set `ENCORE_EMAIL_*` if any store uses the Shopify-Flow provider; export `.flow` templates in the Flow editor.
- **Rollback:** remove the services + routes + extensions + the `notifications` section; back-in-stock reverts to the prior Klaviyo-only dispatch.
- **Proof:** Flow action HMAC + Klaviyo events/metrics + the staff-only Flow-email limitation verified on shopify.dev / developers.klaviyo.com; tsc clean (1 baseline). Ship-date/balance-due emit points + `.flow` files are documented as remaining wiring (NOTIFICATIONS-N1.md).

### CC-2026-06-15-05 — Notifications N1b (ship-date + balance-due + buyer locale) · **C2** (contract, additive)

- **What:** completes the N1 message set — no new scopes.
  - Schema (additive): `WaitlistSubscription.locale`, `PreOrder.balanceRemindedAt`.
  - `notify-events.server.ts` (`notifyShipDateChanged`, `remindBalancesDue`) — per-customer dispatch by provider.
  - **Ship-date** emit wired into the campaign edit action (snapshot → diff → notify each customer). **Balance-due** via new `POST /cron/balance-reminders` (token-guarded by `ENCORE_CRON_SECRET`; idempotent via `balanceRemindedAt`; charge stays Shopify-native). **Buyer locale** captured at signup (`proxy.notify` + storefront `data-locale`) → back-in-stock copy translates.
- **Classification:** C2 — additive. No invariant/endpoint/model/scope altered.
- **Scopes:** none. Reuses `ENCORE_CRON_SECRET` (Phase 4) + the N1 transport.
- **Consumers:** `app.campaigns.$id.edit` (ship-date), `cron.balance-reminders` (balance), `waitlist-notify` (locale). `notify-events.server` is the only writer of `balanceRemindedAt`.
- **Migration:** `prisma db push` (2 fields); schedule `/cron/balance-reminders` daily.
- **Rollback:** remove `notify-events.server` + the cron + the edit-action hook + the 2 fields; back-in-stock locale falls back to `en`.
- **Proof:** tsc clean (1 baseline). Order-driven messages still resolve `en` (no storefront locale on orders) — documented as remaining work.

### CC-2026-06-15-06 — Notifications N3/N4 (native BIS + Klaviyo OAuth + order locale) · **C2** (contract, additive)

- **What:** deepen the Klaviyo integration + translate order emails — no new Shopify scopes.
  - Schema (additive): `KlaviyoConnection` (encrypted OAuth token), `PreOrder.locale`.
  - **N3 native BIS:** `subscribeBackInStock` (Klaviyo native back-in-stock via the synced catalog variant) at notify-me signup when `klaviyoBisMode = native`; restock dispatch defers to Klaviyo. Mode toggle on `/app/notifications`.
  - **N4 OAuth:** `/klaviyo/connect` + `/klaviyo/callback` (PKCE, signed cookie), `klaviyo-oauth.server.ts` (exchange/refresh), `app/lib/crypto.server.ts` (AES-256-GCM at rest); `klaviyo.server` resolves OAuth bearer (preferred) → pasted key. Connect button + status on the screen. New env `ENCORE_KLAVIYO_CLIENT_ID/SECRET`.
  - **Order locale:** `PreOrder.locale` from `order.customer_locale` → preorder/ship-date/balance emails translate.
- **Classification:** C2 — additive. No invariant/endpoint/model/scope altered. New routes only.
- **Scopes:** no Shopify scopes added. Klaviyo OAuth scopes are set in the Klaviyo app registration.
- **Consumers:** `klaviyo.server` (auth), `proxy.notify` (native subscribe), `waitlist-notify` (mode), `notify-events` + `orders.create` (locale), `app.notifications` (connect UI).
- **Migration:** `prisma db push` (`KlaviyoConnection`, `PreOrder.locale`); register the Klaviyo app + set `ENCORE_KLAVIYO_*`. `.flow` templates exported on the Mac.
- **Rollback:** remove the OAuth routes/service + crypto + native-BIS branch + the two schema additions; Klaviyo falls back to the pasted key + Encore events.
- **Proof:** Klaviyo native BIS endpoint shape, OAuth (authorize/token, PKCE), and `customer_locale` verified on developers.klaviyo.com / shopify.dev; tsc clean (1 baseline). Marketplace listing + branded metrics + `.flow` files are external/manual (documented).

### CC-2026-06-15-07 — Billing (Nova-priced plans) + billing/GDPR forwarding · **C2** (contract, additive)

- **What:** the revenue layer — closes the audit's #1 blocker. No new OAuth scopes (billing needs none).
  - Encore: `plans.server` (fetch plans from Nova + fallback), `billing.server` (`appSubscriptionCreate`, `BillingState`), `usage.server` (meter + limits), `/app/plans` screen, `app_subscriptions/update` webhook (record + **forward to Nova**), soft enforcement in `storefront.server` (pre-order) + `proxy.notify` (notify). **GDPR webhooks now forward to Nova** too (§5.2). Schema: `BillingState`.
  - Nova: `AppPlan` += `annualAmount`/`preorderLimit`/`notifyLimit`; `upsertAppPlanSchema` + `upsertPlan` write them; new public `GET /v1/apps/:slug/plans` (`AppPublicController`); seed Basic/Growth/Scale.
- **Why:** plans + pricing controlled in Nova (CRUD, no code); merchants billed via Shopify; the billing webhook now reaches Nova so charges → commissions can be derived.
- **Classification:** C2 — additive. New routes + a new webhook topic; no existing endpoint/model/scope altered.
- **Scopes:** none. (`appSubscriptionCreate` requires no scope; enable billing in the Partner Dashboard.)
- **Consumers:** `app.plans` (screen), `webhooks.app_subscriptions.update` (state + forward), `storefront.server`/`proxy.notify` (enforce). Plans fetched from Nova; the fallback mirrors the seed.
- **Migration:** Encore `prisma db push` (`BillingState`) + `shopify app deploy` (registers `app_subscriptions/update`); Nova `prisma migrate` + seed. `ENCORE_BILLING_TEST=1` until live.
- **Rollback:** remove the billing services/screen/webhook + `BillingState`; revert the Nova AppPlan fields/endpoint. Storefront enforcement no-ops when no plan.
- **Proof:** `appSubscriptionCreate` shape verified on shopify.dev; the public plans endpoint + admin CRUD follow the platform's existing apps-registry patterns; Encore tsc clean (1 baseline). Platform ledger (forwarded webhook → Charge/Commission) is platform P6 work, documented.

### Phase-1 frozen contracts (new this phase)

- **Order tag(s):** `preorder` + the merchant's configured `orderTagName`.
- **Order metafields:** `encore.is_preorder` (boolean), `encore.ship_date` (date), `encore.ship_dates` (list.date).
- **Selling plan:** group `merchantCode = encore-{campaignId}`, category `PRE_ORDER`, one plan per campaign; GIDs stored on `Campaign.sellingPlanGroupId/sellingPlanId`.
- **App proxy:** `GET /apps/encore/config`, `POST /apps/encore/notify` (base `/apps/encore` unchanged).
- **Additive schema (Phase 1):** `Campaign.markets/sellingPlanGroupId/sellingPlanId/sellingPlanStatus`, `PreOrder.variantId`, `AppSettings`, `Translation` — no drops/renames.
