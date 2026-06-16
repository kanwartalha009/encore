# Encore — Live-readiness audit (2026‑06‑15)

Whole-app audit verified **from the code**, with a focused check on what Encore
sends to the Nova platform. tsc: 1 baseline `PrismaSessionStorage` error.

## TL;DR

Encore's **product** is in great shape (preorder core, no-oversell, reliability,
notifications, GDPR). But it is **not yet sellable**: the **billing layer is
entirely unbuilt**, and because of that the **billing channel to Nova is missing** —
so on the current code a merchant can't be charged and **Nova never sees revenue,
so agency commissions never appear**. That's the #1 thing between here and live.

> **Update 2026‑06‑15 — RESOLVED.** Billing is now built (`docs/BILLING.md`,
> `CC-2026-06-15-07`): 3 **Nova-controlled** plans (pre-order + notify-me monthly
> limits, annual −20%), `appSubscriptionCreate`, usage metering + soft enforcement,
> the **`app_subscriptions/update` webhook forwarding to Nova**, and the GDPR
> webhooks now forward too. The only remaining Nova-channel item is platform-side:
> turning the forwarded billing webhook into Charge/Commission ledger rows (Nova P6).

## Is Encore sending info to Nova correctly? (your specific question)

| Channel (build pack §5) | Status | Evidence |
|---|---|---|
| **Install-confirm** (§5.1) | ✅ **Correct** | `shopify.server.ts` `afterAuth` → `confirmInstall` → signed `POST {NOVA_API}/v1/internal/installations/confirm` (HMAC `NOVA_INSTALL_CONFIRM_SECRET`, body `{shopDomain, appSlug:"encore", installedAt}`). |
| **Forward `app/uninstalled`** (§5.2) | ✅ Correct | `webhooks.app.uninstalled` → `forwardToIngress` (HMAC `NOVA_INGRESS_HMAC_SECRET` → `/v1/webhooks/shopify/encore`). |
| **Forward `app_subscriptions/update`** (§5.2 — billing) | ❌ **MISSING** | No `app_subscriptions/update` topic in `shopify.app.toml`, no handler, no forward. **This is "how charges → commissions are derived in the platform ledger" (§5.2) — the revenue channel is absent.** |
| **Forward GDPR (`data_request`/`redact`/`shop_redact`)** (§5.2) | ❌ Missing forward | The three handlers exist + purge locally (Phase 4) but **do not** `forwardToIngress`. §5.2 says forward them. |
| Signing / resilience | ✅ Correct (with caveat) | HMAC scheme + `X-Nova-*` headers correct. Best-effort: no-ops if `NOVA_API` unset, never throws. ⚠ **No durable outbox/retry** (`nova.server.ts` TODO) — a dropped billing forward = a lost commission. |

**Verdict:** install-confirm is wired correctly; **billing forwarding is entirely
missing and GDPR forwarding is missing.** The single most important Nova channel
(billing → commissions) does not exist yet because billing itself isn't built.

## Missing for live — critical (blockers)

1. **Billing / FREEMIUM plans — entirely unbuilt (#1 blocker).** No `billing` config in `shopify.server.ts`, no Free/Growth/Scale plan constants, no plan-selection screen, no `appSubscriptionCreate` (Billing API or Managed Pricing), no `Installation.planOverride` handling (build pack §4, §5.3). For a Nova **App** (Shopify-billed, agency-commission) this is the revenue engine — without it there's nothing to sell and nothing for Nova to take commission on.
2. **`app_subscriptions/update` webhook** — subscribe + handle + **forward to Nova** (the billing→ledger channel). Depends on (1).
3. **GDPR forwarding to Nova** — add `forwardToIngress` to the three compliance handlers (§5.2).
4. **PCD approval (external)** — `orders/*` is dormant, so order tagging, waitlist→purchase conversion, and the preorder-placed Flow/Klaviyo messages don't fire until Protected Customer Data is approved and the topics are enabled.

## Anomalies / smaller gaps

- **No durable outbox for Nova forwarding** — best-effort only. Tolerable for lifecycle, **risky for billing** (a missed `app_subscriptions/update` silently loses a commission). Build the outbox + retry before charging real merchants.
- **Baseline tsc error** — `PrismaSessionStorage` type mismatch from two copies of `@shopify/shopify-api` (the app's + the library's nested one). Benign at runtime, but resolve it (dedupe the dependency) for a clean build/CI.
- **Hardcoded dev URLs** — Flow `runtime_url`s, the customer-account `APP_URL`, and the Klaviyo redirect default all point at `encore.nova-platform.localhost:3003`; set them per environment before `shopify app deploy`.
- **No automated tests** — no test suite. Not strictly blocking, but the no-oversell + tagging + billing paths warrant at least smoke tests before charging merchants.
- **Newest admin strings untranslated** — Notifications / Benchmark / Reliability labels render English in the 7 non-English locales (cosmetic; the `t()` fallback handles it).
- **Session-only state** — no `Shop`/installation-state model locally; billing/plan state will need a home (a model, or read from Shopify/Nova).

## External / manual (live gates, not code)

- Register the **Klaviyo OAuth app** + redirect; submit for the **App Marketplace** (+ branded metrics, flow templates).
- Export the **`.flow`** template files in the Flow editor.
- **App Store**: listing, privacy policy, pricing, and **app review** (compliance webhooks are already in place ✅).
- **Pilot**: theme-compatibility matrix + Lighthouse on real stores (`PILOT-RUNBOOK.md`).
- **Mac**: `prisma db push` (all the additive fields across P1–N4) + `shopify app deploy`; schedule the `purge-uninstalled` + `balance-reminders` crons.

## What's solid (so this is balanced)

Preorder core + 2-minute enable; **no-oversell** (offer cap + Checkout Validation Function, measured); the **§8 reliability bar** enforced *and* shown on the dashboard; **GDPR** (200 / 401-on-bad-HMAC / purge-by-shop + 48h purge job); **notifications** (Klaviyo + Shopify-Flow, 4 messages, editable+translatable copy, OAuth, native BIS, buyer-locale); per-market rules + demand; the recovered-demand **benchmark**; security (HMAC/JWT/token on every external endpoint, `.env` git-ignored). Schema changes are all additive.

## Recommended order to go live

1. **Billing** — `billing` config + Free/Growth/Scale + plan-selection screen + `appSubscriptionCreate` honoring `planOverride`.
2. **`app_subscriptions/update`** — subscribe + handle + forward to Nova; **GDPR forwarding** to Nova.
3. **Durable outbox** for Nova forwarding (at least for billing).
4. **PCD** submission → enable `orders/*`.
5. Resolve the tsc baseline + set per-env URLs + smoke tests.
6. External: Klaviyo OAuth/marketplace, `.flow` exports, App Store listing + review, pilot.
