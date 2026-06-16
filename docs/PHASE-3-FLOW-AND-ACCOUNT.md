# Phase 3 — Shopify Flow connectors + Customer Account portal (no ARRS)

Built 2026‑06‑15. Encore stays independent — **no ARRS dependency**. This doc is
the Mac run/test guide; the gate is in `PHASE-3-AUDIT.md`, the contract entry is
`CC-2026-06-15-01`.

## What shipped

| Piece | Files | Surface |
|---|---|---|
| Flow trigger: **Preorder placed** | `extensions/encore-flow-preorder-placed/` + emit in `webhooks.orders.create.tsx` | Flow |
| Flow trigger: **Waitlist signup** | `extensions/encore-flow-waitlist-signup/` + emit in `proxy.notify.tsx` | Flow |
| Flow trigger: **Restock detected** | `extensions/encore-flow-restock-detected/` + emit in `webhooks.products.update.tsx` | Flow |
| Flow action: **Tag order** | `extensions/encore-flow-tag-order/` + `app/routes/flow.tag-order.tsx` | Flow |
| Customer Account: **My pre-orders / waitlist** | `extensions/encore-customer-account/` + `app/routes/customer.portal.tsx` | Customer account |
| Emit helper | `app/services/flow.server.ts` | — |

All emits are **best-effort**: `emitFlow` swallows its own errors, so a Flow
hiccup can never fail an order, a waitlist signup, or the restock dispatch.

## Before deploy — set the two URLs

Both default to the dev URL `https://encore.nova-platform.localhost:3003`. Point
them at your real app/tunnel URL per environment:

1. `extensions/encore-flow-tag-order/shopify.extension.toml` → `runtime_url`
2. `extensions/encore-customer-account/src/PreordersBlock.tsx` → `APP_URL`

(`shopify app dev` updates `application_url` automatically; these two extension
URLs are set explicitly because Flow and the account block call your app from
outside the embedded admin.)

## Deploy

```bash
# from shopify/encore
shopify app deploy        # registers the 4 new extensions + pushes config
```

No `prisma db push` this phase — Phase 3 adds **no schema** (it reads existing
`PreOrder` / `WaitlistSubscription` columns).

## Test the Flow triggers

1. Admin → **Settings → Notifications → Flow** (or the Flow app) → **Create workflow**.
2. Trigger → search **"Encore"** → pick e.g. *Encore — Waitlist signup*.
3. Add an action (e.g. *Send internal email* or *Add customer tags*) using the
   trigger fields (`email`, `product`, `variant_id`, `market`).
4. Turn the workflow on, then fire the event:
   - **Waitlist signup** — submit the storefront notify-me popup (live now).
   - **Restock detected** — take a waitlisted variant 0 → in stock (live now).
   - **Preorder placed** — place a pre-order. ⚠️ This emit lives in the
     `orders/create` handler, which is **PCD-gated** (commented in
     `shopify.app.toml`); enable `orders/*` after Protected Customer Data is
     approved and it starts firing.

`flowTriggerReceive` returns no error even when no workflow uses the trigger yet
(we log it and move on) — so emitting before a merchant builds a workflow is safe.

## Test the Flow action (Tag order)

1. In any workflow, add action → **Encore — Tag order**.
2. Set **Order** = the workflow's order, **Tag** = e.g. `preorder-3pl`.
3. Run it → the order gets the tag. Re-running is safe (`tagsAdd` is a no-op when
   the tag exists). The endpoint rejects any request whose
   `x-shopify-hmac-sha256` doesn't verify against the app secret.

## Test the Customer Account block

1. After `deploy`, the **My pre-orders** block is available on the customer's
   **Order index** page. Add/position it in the account editor if needed.
2. Sign in to the account as a customer who has an Encore pre-order or waitlist
   entry → the block lists pre-orders (ship date + balance due) and waitlist
   items (restock status).
3. Security: the block sends its session token; `/customer/portal` verifies it,
   resolves the email server-side, and only ever returns **that** shopper's rows.
   It fails closed — if the call errors, the block renders nothing rather than
   breaking the Orders page.

## Adding ARRS later (when you want it)

Nothing here needs to change. Add one `flow_action` extension ("Emit ARRS
recovery event") whose runtime endpoint posts to ARRS, and/or call an ARRS emit
from `waitlist-notify.server.ts` / the restock path. The triggers, the tag-order
action, and the customer portal are all independent of it.
