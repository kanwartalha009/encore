# Encore — Phase 0 gate + audit report

> Per encore-DELIVERY-PLAN.md §4. **Verdict: Phase 0 is NOT complete — FLAGGED. Do not start Phase 1.**
> Everything implementable from code is done and statically verified; the open items are all
> **runtime** (need Kanwar's Mac + secrets + dev store) or a **platform dependency** (the Nova
> receiving endpoints aren't built). Date: 2026-06-12.

## Build pack §3.0 gate

| # | Gate item | Status | Evidence |
|---|---|---|---|
| 1 | Scaffolded (React Router); toml has 9 scopes, app proxy `/apps/encore`, all webhooks incl. GDPR three | ✅ PASS | `shopify.app.toml`; 7 webhook URIs ↔ 7 handlers cross-checked; scopes + proxy verified on shopify.dev |
| 2 | Embedded token-exchange auth; installs on EU multi-market dev store | ⏸ BLOCKED (runtime) | `shopify.server.ts` token-exchange + `afterAuth` wired; **install needs `.env` + dev store** |
| 3 | Per-app Postgres migrated; `Shop` + `AppSettings` exist | ⏸ BLOCKED (runtime) | `prisma/schema.prisma` (Postgres, Session+Shop+AppSettings) authored; **`prisma migrate` needs `APP_DB_URL__ENCORE`** |
| 4 | Nova install-confirm implemented — platform shows Installation ACTIVE | ⏸ BLOCKED (platform) | App sending side done (`lib/nova.server.ts`, called in `afterAuth`); **platform endpoint is a `_status` placeholder** |
| 5 | Webhook forwarding to ingress verified — event lands in ingress log | ⏸ BLOCKED (platform) | Forwarding done (lifecycle + GDPR handlers); **ingress endpoint is a `_status` placeholder** |
| 6 | SPIKE: per-market selling-plan mechanism | ⏸ PARTIAL | Desk-verified + designed (`PHASE-0-SPIKES.md`); **live acceptance needs the multi-market store** |
| 7 | SPIKE: payment-method fallback (no broken checkout) | ⏸ PARTIAL | Desk-verified + designed; **live acceptance needs SP + non-SP stores** |

## §4 audit checks

1. **Build health** — ⏸ BLOCKED on Mac. Can't run in this sandbox (node_modules are macOS-built; Prisma client not generated; `react-router typegen` needs esbuild's native binary). *Static* checks PASS: toml↔routes consistent, no leftover `.js/.jsx` duplicates, code's Prisma models all exist. Run on Mac: `npm install && npx prisma generate && npm run typecheck && npm run build`.
2. **Schema diff (additive-only)** — ✅ PASS (baseline). Phase 0 establishes Session + Shop + AppSettings; nothing dropped. Later phases add the rest additively.
3. **Contract diff** — ✅ PASS (baseline frozen here): 9 scopes, webhook topics, app-proxy `/apps/encore`, auth mode (token exchange). Selling-plan/tag/metafield contracts arrive Phase 1+.
4. **Nova consistency** — ⏸ BLOCKED (platform). Contract defined in `NOVA-INTEGRATION-CONTRACT.md`; receiving endpoints must be built to it before charges/commissions can be verified.
5. **Regression** — N/A. Phase 0 has no predecessor.
6. **Anti-hallucination** — ✅ PASS. Every route/scope/field referenced exists (cross-checked); `api_version 2026-04`, webhook topics, `afterAuth`, and all selling-plan/charge facts verified on shopify.dev / the installed `@shopify/shopify-api@13`. The Nova HMAC gap was flagged + a contract defined, not invented.
7. **Report** — this document.

## What's done (this repo, all TypeScript)
- `shopify.app.toml` — 9 scopes, app proxy, full webhook set + GDPR three, `api_version 2026-04`.
- `prisma/schema.prisma` — Postgres, `Session` + `Shop` + `AppSettings`.
- `app/shopify.server.ts` — token-exchange + `afterAuth` (Shop upsert, AES-256-GCM token encryption, AppSettings seed, install-confirm call).
- `app/lib/crypto.server.ts`, `app/lib/nova.server.ts`.
- Webhook handlers: GDPR compliance, app/uninstalled + app_subscriptions/update (forward to ingress), orders/create, orders/paid, inventory, products (Phase-0 stubs).
- `NOVA-INTEGRATION-CONTRACT.md`, `PHASE-0-SPIKES.md`, `.env.example`.

## To close Phase 0 (Kanwar — on the Mac)
1. Fill `.env` from `.env.example` (secrets: `SHOPIFY_API_SECRET`, `APP_DB_URL__ENCORE`, `APP_ENCRYPTION_KEY` [32-byte hex], `NOVA_INGRESS_HMAC_SECRET`, `NOVA_INSTALL_CONFIRM_SECRET`, `ARRS_*`).
2. `npx prisma migrate dev --name init` → creates Session/Shop/AppSettings in Postgres.
3. `npm run typecheck && npm run build` → build health.
4. `shopify app dev` → install on the EU multi-market dev store (Shop Pay on); confirm token-exchange OAuth.
5. Build the platform endpoints (`/internal/installations/confirm` + `/webhooks/shopify/encore`) to `NOVA-INTEGRATION-CONTRACT.md`; verify Installation ACTIVE + an event in the ingress log.
6. Run both spikes live on the dev stores.

**Phase 1 stays locked until the above pass.**
