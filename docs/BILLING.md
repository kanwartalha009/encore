# Encore — Billing (Nova-controlled plans + Shopify subscriptions)

Built 2026‑06‑15. Closes the #1 launch blocker from `LIVE-READINESS-AUDIT.md`.
Encore CC `CC-2026-06-15-07`; Nova-side changes noted below. tsc clean (Encore).

## Plans (Nova-controlled — change without code)

| Plan | Monthly | Annual (−20%) | Pre-orders / mo | Notify-me / mo | Trial |
|---|---|---|---|---|---|
| **Basic** | $19.99 | $191.90 | 100 | 500 | 14 days |
| **Growth** | $49.99 | $479.90 | 1,000 | 5,000 | 14 days |
| **Scale** | $129.99 | $1,247.90 | Unlimited | Unlimited | — |

These are the **seed defaults**. The **source of truth is the Nova platform**
(`AppPlan` rows): edit price, limits, annual amount, and trial in the **Nova admin**
(`POST /v1/admin/apps/:id/plans`) — no app deploy. Encore reads them live.

## How it works

```
Nova admin (CRUD)  ──►  AppPlan rows  ──►  GET /v1/apps/encore/plans
                                                   │
Encore  plans.server.ts (fetch + cache + fallback) ◄┘
   │  /app/plans screen (3 plans, Monthly/Annual toggle, usage)
   │  billing.server.ts → appSubscriptionCreate (Nova price, honors planOverride)
   │        └─► Shopify approval (confirmationUrl) ─► app_subscriptions/update
   │                                                       │
   └─ BillingState (plan/status/period) ◄──────────────────┘  + forward to Nova ingress
```

- **Pricing is never hardcoded** — `plans.server.ts` fetches `GET {NOVA_API}/v1/apps/encore/plans`; a baked-in fallback (mirrors the seed) keeps the app working if Nova is unreachable.
- **Subscribe** → `appSubscriptionCreate` with the fetched price + interval (`EVERY_30_DAYS` / `ANNUAL`); `test: true` in non-prod. Per-store comp (`planOverride` FREE/PERCENT/FIXED from Nova) is applied as a discount or a free record.
- **`app_subscriptions/update`** keeps `BillingState` authoritative **and forwards to the Nova ingress** (signed) — this is the billing→commissions channel the audit found missing.

## Metering + enforcement (soft + reliability-safe)

`usage.server.ts` counts the shop's pre-orders + notify-me signups for the
**current calendar month** vs the plan limits. Enforcement is **soft**:

- Over the **pre-order** limit → the storefront stops *offering new* pre-orders (`storefront.server` returns it inactive). Existing pre-orders, orders, and checkout are **never** touched (no §8 violation).
- Over the **notify-me** limit → `proxy.notify` stops accepting *new* signups (soft 200). Existing waitlist untouched.
- **No plan / unlimited** → never gated (new installs + Scale are never blocked).

The `/app/plans` screen shows live usage bars + an upgrade prompt at the limit.

## Nova platform changes (this build)

- `AppPlan` += `annualAmount`, `preorderLimit`, `notifyLimit` (schema).
- `upsertAppPlanSchema` (zod) + `upsertPlan` service write them → admin CRUD accepts them.
- New **public** endpoint `GET /v1/apps/:slug/plans` (`AppPublicController`) → serves the app's plans.
- Seed: the 3 Encore plans above.

## Mac / deploy steps

1. **Encore:** `prisma db push` (`BillingState`); `shopify app deploy` (registers `app_subscriptions/update`). Set `ENCORE_BILLING_TEST=1` until going live.
2. **Nova:** `pnpm --filter @nova/database prisma migrate dev` (AppPlan fields) + `prisma db seed`; rebuild the API.
3. Enable **billing** for the app in the Partner Dashboard (no OAuth scope needed).

## Remaining

- **Nova admin form** — add the 3 new fields (annual / pre-order limit / notify limit) to the plan-edit UI (the API + schema already accept them).
- **Platform ledger (P6)** — the forwarded `app_subscriptions/update` must be turned into Charge/Commission rows on the Nova side (inbound-billing module — platform work, not Encore).
- **`planOverride` endpoint** — Encore reads `GET /v1/apps/encore/installations/:shop/plan-override` (defaults to none); add it on Nova when per-store comps are needed (needs an `Installation.planOverride` field).
- Align metering to the **billing period** (currently calendar month).
