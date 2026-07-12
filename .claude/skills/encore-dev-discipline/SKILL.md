---
name: encore-dev-discipline
description: MANDATORY at the start of every Encore development task — enforces phase-wise task lists, verified numbers, the no-feature-loss simplicity rule, the .server import trap check, and Shopify approval constraints. Trigger on any request to build, fix, refactor, simplify, deploy, or continue work on the Encore app.
---

# Encore dev discipline

You are working on Encore (Shopify preorder + back-in-stock app, React Router v7 + Polaris, embedded). Follow this checklist for EVERY task, in order. Do not code before step 4.

## 1. Orient (read, don't recall)

- `OPUS-HANDOVER-ENCORE.md` (repo root) — current phase spec (E0–E4) and operating rules.
- `../../docs/06-plan/MASTER-PLAN-2026-07-11.md` §Workstream E — phase gates.
- The latest `PHASE-E*-AUDIT.md` / `PRE-LAUNCH-AUDIT.md` for open items.
- Your memory of this codebase is ALWAYS stale; several in-repo docs are known-stale (nav counts, contract status). Code + the 2026-07-11 audit win; fix docs you falsify.

## 2. The two prime directives

1. **No feature loss, ever.** Simplification = progressive disclosure, defaults, grouping, renaming — never deletion. Before moving/hiding anything, list where each affected capability will live afterward. Removing capability is a change-control STOP → ask Kanwar.
2. **Merchant-simple.** Target: install → first preorder in ≤3 screens; ≤8 visible fields per settings tab before disclosure; zero developer jargon in visible labels (no MOQ/dunning/metafield/namespace); every new string through i18n keys in all 7 locales.

## 3. Verify the ground truth

Any count or "X works/exists" claim must come from a command run now (`grep`, `wc -l`, `ls`, `npm run typecheck`). Unverifiable claims get labeled "unverified".

## 4. Plan phase-wise (no task list = no code)

Numbered task list mapped to the current E-phase; each item commit-sized with an acceptance check (command + expected result). Final item is always "gates + docs + phase audit".

## 5. Build with gates — Encore-specific traps

- **`.server` import trap:** after touching any route or `.server` module, run `npm run build` (not just dev). A route importing a VALUE from `*.server` and using it in the component fails only at prod build. Pattern: pure values in `app/lib/*-shared.ts`, re-exported by the `.server` module.
- `npm run typecheck` after every unit (one known baseline error: PrismaSessionStorage dup `@shopify/shopify-api` — fixed properly via npm `overrides` in E2; do not add new `as any`).
- Nova calls ONLY through the durable outbox (`nova.server.ts` enqueue) — never fire-and-forget fetches.
- GDPR handlers, 48h purge, encrypted tokens, HMAC verification are frozen — refactors must not weaken them.
- Billing: `appSubscriptionCreate` with test charges outside prod; pricing comes from Nova with hardcoded fallback — keep both paths.
- Webhooks: `orders/*` topics stay commented in `shopify.app.toml` until Kanwar confirms PCD approval.
- Embedded-app rules: session-token auth, App Bridge nav, no full-page redirects in core flows, API version stays pinned (2025-10) unless explicitly upgraded.

## 6. Close the loop (every session)

- Update docs falsified by your change (same commit); tick MASTER-PLAN checkboxes only for verified work.
- Phase complete → `PHASE-En-AUDIT.md` with checks, evidence, PASS/FAIL.
- End your reply with VERIFIED vs ASSUMED lists; keep ASSUMED near-empty.

## Hard prohibitions

- No capability deletion; no schema-column drops during UX work (labels/layout only).
- No new dependencies without justification.
- Never commit `.env` or secrets; shared HMAC secrets must match the Nova platform deployment.
- Never claim external gates done (PCD approval, app review, domain) — Kanwar confirms those.
