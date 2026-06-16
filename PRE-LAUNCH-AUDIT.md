# Encore — Pre-launch readiness audit (Phases 0–5)

> End-to-end verification across the whole app, **from the code** — 2026‑06‑15.
> Scope: build health, schema↔code, route/webhook/nav/scope parity, security,
> the §8 reliability bar, and launch-gating dependencies.
>
> **Verdict: READY pending field work.** No code blockers found. One stale-doc
> issue was fixed during the audit; the rest are minor polish flags or external
> launch gates (PCD, deploy, pilot). tsc: 1 baseline `PrismaSessionStorage` error.

## Area-by-area

| Area | Result | Evidence |
|---|---|---|
| **Build health** | ✅ PASS | `tsc` = 1 baseline error only; no broken imports (a broken import fails tsc). All 33 route files compile. |
| **Schema ↔ code** | ✅ PASS | Every narrow-cast field resolves to a real column: `tagged`, `convertedAt`, `notifyStatus`/`notifyAttempts`, `market`, `variantId`, `benchmark`, selling-plan GIDs, `marketSnapshot`, `lastReconciledAt`, and `model UninstalledShop`. No orphaned references. |
| **Routes / nav parity** | ✅ PASS | All 10 nav `s-link`s resolve to real routes (`/app`, campaigns, cohorts, demand, markets, benchmark, waitlist, low-stock, translations, settings). |
| **Webhook parity** | ✅ PASS | All 7 active toml topics have handlers (uninstalled, scopes_update, products/update, inventory_levels/update, + 3 GDPR). The 3 `orders/*` topics are commented (PCD) with handlers present but dormant. |
| **Scopes ↔ usage** | ✅ PASS (1 doc fix) | Declared scopes are used: `read_discounts` (discount-compat), `write_purchase_options` (selling-plan), `read_customers` (customer portal). **Fixed:** `.env.example` SCOPES was stale (9 vs the toml's 13) → synced + noted the toml is source of truth. |
| **Security** | ✅ PASS | Every `webhooks.*` route uses `authenticate.webhook` (auto-401 on bad HMAC). Flow action `/flow/tag-order` verifies the HMAC; `/customer/portal` verifies the customer-account JWT (exp/nbf/aud); `/cron/purge-uninstalled` is token-guarded; `proxy.*` use `authenticate.public.appProxy`. **`.env` is git-ignored and NOT tracked**; no secret files tracked; `SHOPIFY_API_SECRET` blank in the example. |
| **Reliability §8 (must never)** | ✅ PASS | All 7 backed in code: oversell (offer cap + Validation Function + measured), untagged (verify+retry+`tagged`+measured), discounts (discount-compat), settings isolation (per-section saves), waitlist (SENT/FAILED, never silent), payment fallback (`PAY_NOW_FALLBACK`), no billing after uninstall (session delete + ingress). |
| **Extensions** | ✅ PASS | 7 extensions, each with a valid `shopify.extension.toml` (storefront, preorder-cap Function, 3 Flow triggers, Flow action, customer-account). Flow emit handles match the trigger tomls. |

## Flags (non-blocking)

1. **New admin strings not yet translated** — Phase 4/5 labels (Benchmark, Reliability, Pilot benchmark, Oversell incidents, etc.) aren't in the `i18n.tsx` catalog, so they render **English** in the 7 non-English locales via the `t()` fallback. Functional, cosmetic only. *Fix: add ~12 keys × 7 langs when convenient.*
2. **Nova ingress forwarding is best-effort** — `nova.server.ts` carries `TODO(phase4): durable outbox + retry`. `forwardToIngress` no-ops/never-throws, so a failed forward of a lifecycle/billing event isn't durably retried. Mitigated by Shopify's own webhook retries + Nova-side reconciliation, but a durable outbox is the robust answer at scale. *Flag for post-pilot.*
3. **Per-env URLs** — `flow-tag-order` `runtime_url` and the customer-account `APP_URL` are hardcoded to the dev URL; set them to the deployed URL before `shopify app deploy` (already in the Phase-3 doc).
4. **Cosmetic** — an unused `TextField` suppression placeholder in `app.campaigns._index.tsx` (future search-by-id). Harmless.

## Launch gates (external / field — not code)

- [ ] **PCD approval** (Partner Dashboard → Protected customer data) → uncomment `orders/*` in `shopify.app.toml` + redeploy. Activates order tagging, the waitlist→purchase conversion stamp, and the "Preorder placed" Flow trigger.
- [ ] **`npx prisma db push`** — applies all additive fields across P1–P5 (`tagged`, `UninstalledShop`, `AppSettings.benchmark`, market/selling-plan/reconcile fields).
- [ ] **`shopify app deploy`** — registers all 7 extensions + the 3 GDPR compliance webhooks.
- [ ] **`ENCORE_CRON_SECRET`** set; schedule `POST /cron/purge-uninstalled` daily.
- [ ] **Pilot** (`PILOT-RUNBOOK.md`) — 2–3 stores, theme-compat matrix + Lighthouse, prove lift > 0 and 0/0 incidents.
- [ ] **Validation gate** — ≥10 cold paying installs before opening broadly.

## Bottom line

Encore Phases 0–5 are **code-complete and internally consistent** — no broken
wiring, every external surface is authenticated, the reliability guarantees are
enforced *and* measured, and secrets are clean. What stands between here and
launch is entirely field work: PCD approval, the Mac deploy steps, and the live
pilot. Recommend proceeding to the Mac deploy + PCD submission next.
