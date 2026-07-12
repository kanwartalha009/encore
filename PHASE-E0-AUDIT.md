# Encore — Phase E0 audit (Unblock externals)

> Per `OPUS-HANDOVER-ENCORE.md` §E0 + `MASTER-PLAN-2026-07-11.md` §Workstream E.
> E0 is a **zero-code** phase (long-lead externals + doc-drift fixes).
> Date: 2026‑07‑11. Verified from commands run now.

**Phase goal:** get the long-lead external items in flight and kill doc drift.
**Gate:** *PCD submitted (external) + listing kit drafted.*

## Task results

| # | Task | Result | Evidence |
|---|---|---|---|
| E0.1 | Listing kit | ✅ DONE | `LISTING-KIT.md` — name, tagline, long description (simplicity + no-oversell + partial payments), category/keywords, pricing table (matches in-app plans), reviewer test instructions, E2 assets checklist. |
| E0.2 | D1 — `NOVA-INTEGRATION-CONTRACT.md` status | ✅ DONE | Status § rewritten: sending side = durable `NovaOutbox`; receiving side = **built + live** (`installations.internal.controller` `@Public POST confirm` + `verifyNovaSignature`; `webhooks.controller` `@Public` ingress → `billing.recordFromWebhook` → `Charge`). Verified against `apps/api` code. |
| E0.3 | D3 — `PRE-LAUNCH-AUDIT.md` nav count | ✅ DONE | Was "10"; measured `grep -c 's-link' app/routes/app.tsx` = **12**; updated to 12 + full list + "E1 collapses 12→6". |
| E0.4 | D4 — `encore-DELIVERY-PLAN.md` tracker | ✅ DONE | Phases 0–5 ticked (each has a PASS `PHASE-n-AUDIT.md`); billing+notifications noted; Workstream E added, **E0 current**. |
| E0.5 | D6 — `CHANGE-CONTROL.md` scope | ✅ DONE | Platform monorepo invariants (I-1…I-10) preamble replaced with **Encore frozen contracts** (no-feature-loss, GDPR, Nova outbox, no-oversell, billing, PCD gate, embedded conventions); classification + Encore CC log kept. |
| E0.6 | **File PCD request** | ⏳ EXTERNAL — Kanwar | Partner dashboard, org 1710157. **Not ticked** (external gate; skill prohibition). |
| E0.7 | **Confirm support email** | ⏳ EXTERNAL — Kanwar | Placeholder in `LISTING-KIT.md`. **Not ticked** (external). |
| E0.8 | Gate + audit + typecheck/build | ⚠ see below | this file. |

## Build health (measured now)

- `node_modules/.bin/tsc --noEmit -p tsconfig.json` → **0 errors** in the current tree. The `PrismaSessionStorage` baseline error documented in the 2026‑07‑11 audit appears **resolved** on disk — re-confirm with full `npm run typecheck` on the Mac (E2 tracks the overrides dedupe).
- `npm run typecheck` (= `react-router typegen && tsc`) and `npm run build` **cannot run in this Linux sandbox**: rollup's native binary for `linux-arm64` is not installed (`react-router typegen` → `MODULE_NOT_FOUND` in `rollup/dist/native.js`). Must be run on Kanwar's Mac. **E0 changed only `.md` files** (no routes / `.server` modules), so the `.server` import trap and prod-build risk do not apply this phase.

## Gate verdict — **PARTIAL** (executable work complete; external item pending)

- "Listing kit drafted" → ✅ met.
- "PCD submitted" → ⏳ **pending Kanwar** (external — I do not and cannot mark it done).

E0 closes fully once Kanwar files the PCD request and confirms the support email.
No code was written; no capability changed; no frozen contract touched.

## VERIFIED vs ASSUMED

- **VERIFIED:** nav = 12 (grep); receiving side built (read `apps/api` controllers/services); tsc = 0 errors now; 5 docs edited to match ground truth; listing kit exists.
- **ASSUMED / can't verify here:** full `npm run typecheck` + `npm run build` (Mac-only — rollup native); PCD + support email (Kanwar's external actions).
