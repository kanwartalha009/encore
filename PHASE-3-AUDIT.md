# Encore — Phase 3 gate + audit report

> Per `encore-BUILD-PACK.md` §3.3, verified from the real code.
> **Scope decision (Kanwar, 2026‑06‑15): build Phase 3 _without ARRS_.** Encore
> stays a standalone app with no ARRS dependency; ARRS behavioural recovery is
> deferred and can be added later as an extra Flow action + event emit without
> reworking anything below.
>
> **Verdict: Phase 3 (minus ARRS) is COMPLETE — waitlist capture + reliable
> restock dispatch (Phase 1), Flow triggers + a Flow action, and a Customer
> Account pre-orders/waitlist surface are all built and clean.**
>
> Date: 2026‑06‑15. tsc (encore's own `node_modules` + `.react-router` typegen):
> **1 baseline `PrismaSessionStorage` error**, nothing else. The customer-account
> extension builds with its own SDK on the Mac (excluded from the app tsconfig).

## Build pack §3.3 gate

| # | Gate item | Verdict | Evidence |
|---|-----------|---------|----------|
| 1 | Waitlist captures contact + variant interest with explicit GDPR consent → status visible, never silently dropped (ARRS emit **out of scope**) | ✅ PASS (minus ARRS) | `proxy.notify` records `WaitlistSubscription` (email/phone + product/variant + market) with dedupe + the storefront consent checkbox. Dispatch (`waitlist-notify.server.ts`) ends every subscriber in `SENT` or `FAILED`-with-reason — never dropped (Phase-1 reliability bar §8). **ARRS emit intentionally omitted** per scope decision. |
| 2 | On restock, the recovery flow fires reliably (delivery confirmed, `notifiedAt` set) | ✅ PASS | `webhooks.products.update` (non-PCD) detects 0→in-stock and runs `notifyRestocked`; `SENT` sets `notifiedAt`, `FAILED` records a reason + is retryable (`retryFailed`, attempt cap). |
| 3 | Flow triggers (preorder placed / waitlist signup / restock) fire with correct payloads; the action is idempotent | ✅ PASS | Three `flow_trigger` extensions + `flow.server.ts` emit via `flowTriggerReceive` (payload keys = trigger field keys), wired into orders/create (PCD-gated), proxy.notify, products/update. Action `encore-tag-order` → `POST /flow/tag-order` verifies `x-shopify-hmac-sha256` = `base64(HMAC-SHA256(raw_body, client_secret))` then `tagsAdd` (no-op if the tag exists → safe for Flow retries; 5xx asks Flow to retry on transient failure). |
| 4 | Customer account shows the shopper's pre-orders (ship date, balance due) + waitlist; GA surfaces only, no Checkout MCP | ✅ PASS | `extensions/encore-customer-account` (`customer-account.order-index.block.render`) → `POST /customer/portal`. The endpoint verifies the customer-account **session token** (HS256, app secret; checks exp/nbf/aud), resolves the customer's email via Admin `customer{defaultEmailAddress}` (`read_customers`), and returns **that customer's** pre-orders (campaign name, ship date, amount paid, balance due from `PreOrder`) + waitlist (restock status). GA components only; the waitlist rows carry `productId` so the future P2 MCP "rebuild my cart" return path can be added without rework. |

## What was built (Phase 3, minus ARRS)

- **`app/services/flow.server.ts`** — `emitFlow(shop, handle, payload)` via `flowTriggerReceive`; best-effort (swallows its own errors so a Flow emit can never fail the order/notify/restock path). Exports the three handles.
- **Flow trigger extensions** — `extensions/encore-flow-{preorder-placed,waitlist-signup,restock-detected}/shopify.extension.toml` (text fields; all fields are sent on every emit per Flow's "all trigger fields required" rule).
- **Flow action extension + endpoint** — `extensions/encore-flow-tag-order/` + `app/routes/flow.tag-order.tsx` (HMAC-verified, idempotent tag add).
- **Customer Account extension + endpoint** — `extensions/encore-customer-account/` (`PreordersBlock.tsx`, `locales/en.default.json`, `package.json`, own `tsconfig.json`) + `app/routes/customer.portal.tsx` (token-verified data API, CORS-open with the Bearer token as the trust boundary).
- **Emit wiring** — `webhooks.orders.create` (preorder placed), `proxy.notify` (waitlist signup, only on a genuinely new signup), `webhooks.products.update` (restock detected, one per restocked variant **that had waiters**, so merchants aren't spammed).

## §4 audit checks

1. **Build health** — ⚠ PARTIAL. tsc clean (1 baseline) for the app; the customer-account extension type-checks/builds with its own `@shopify/ui-extensions` SDK on the Mac (`shopify app dev`/`deploy`), excluded from the app tsconfig so its absent SDK can't pollute the app build.
2. **Schema diff** — ✅ PASS. **No schema change this phase.** Pre-orders/waitlist read existing columns (`PreOrder.customerEmail/balanceAmount/…`, `WaitlistSubscription.email/notifiedAt`).
3. **Contract diff** — ✅ PASS. Additive only — 4 new extensions + 2 new routes (`/flow/tag-order`, `/customer/portal`). **No new scopes** (`write_orders` + `read_customers` already granted). Recorded as `CC-2026-06-15-01`.
4. **Nova consistency** — ✅ PASS. No change to install-confirm / webhook forwarding / billing.
5. **Regression** — ✅ PASS. Every emit is best-effort and isolated; the core paths are byte-for-byte unchanged except for the appended best-effort calls.
6. **Anti-hallucination** — ✅ PASS. `flowTriggerReceive`, `tagsAdd`, `customer.defaultEmailAddress`, and the Flow action HMAC scheme were each verified on shopify.dev (2025-10). ARRS is **absent, not faked**.

## To finish / deferred

1. **ARRS** — out of scope by decision. When added: one more `flow_action` ("Emit ARRS recovery event") + an emit in `waitlist-notify` / the restock path. None of the Phase-3 code needs to change.
2. **Preorder-placed trigger** fires from `orders/create`, which stays **PCD-gated** (commented in `shopify.app.toml`) until Protected Customer Data is approved — same gate as order tagging. Waitlist-signup + restock-detected are live now (non-PCD paths).
3. **Per-variant restock fan-out** — currently one emit per restocked variant with waiters; a multi-variant product restock emits per variant (fine). Representative product title comes from the `products/update` payload.
4. **Mac:** `shopify app deploy` to register the four extensions; set the action `runtime_url` + the extension `APP_URL` to the deployed app/tunnel URL; add the triggers/action/block inside a Flow / the customer account to test end-to-end. No `prisma db push` needed (no schema change).
