# Encore — Phase 5 gate + audit report

> Per `encore-BUILD-PACK.md` §3.5 (Pilot & validation gate).
>
> **Verdict: Phase 5 is INSTRUMENTED & READY.** The recovered-demand benchmark,
> the waitlist→purchase conversion stamp, and the zero-incident proof are built
> and tsc-clean; the rollout runbook + validation-gate tracker are written. The
> gate itself **closes on live pilot data** — deploying to real stores and the
> ≥10 cold-install count are inherently field work, not code, and are scripted in
> `PILOT-RUNBOOK.md`.
>
> Date: 2026‑06‑15. tsc: **1 baseline `PrismaSessionStorage` error**, nothing else.

## §3.5 gate

| # | Gate item | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Deployed to 2–3 portfolio stores; recovered-demand benchmark instrumented | ✅ instrumented · ⏳ deploy | `benchmark.server.ts` `getBenchmark` (waitlist sent/converted/rate, pre-order units+GMV, lift vs incumbent) surfaced on `/app/benchmark` with CSV export + a saved incumbent baseline (`AppSettings.benchmark`). Deploying to the stores is Step 1–2 of the runbook. |
| 2 | Waitlist→purchase conversion beats the incumbent baseline (recovery lift) | ✅ measured · ⏳ result | `markWaitlistConverted` stamps `WaitlistSubscription.convertedAt` when a **notified** (SENT) shopper buys the product (orders/create match by shop+product+email). The benchmark computes Encore's rate and the **lift** in percentage points vs the saved baseline. The *result* needs pilot data (and PCD live — see below). Measured natively, **no ARRS dependency**. |
| 3 | Zero oversell incidents; zero untagged-order incidents | ✅ enforced + measured | The §8 bar enforces both; `reliability.server.ts` measures them and `/app/benchmark` shows the **zero-incident proof** (0/0, green). A non-zero value pauses the gate (runbook Step 4). |
| 4 | ≥10 paying installs from no-prior-Nova merchants before opening broadly | ✅ tracker · ⏳ market | Validation-gate tracker + Go/No-go criteria in `PILOT-RUNBOOK.md`. Achieving the count is market work. |

## What was built (Phase 5)

- **`app/services/benchmark.server.ts`** — `getBenchmark(shop)` (recovered-demand scorecard incl. lift vs the saved incumbent baseline) + `markWaitlistConverted(shop, order)` (conversion stamp, SENT-only = true recovery).
- **`app/routes/app.benchmark.tsx`** — pilot scorecard screen: conversion / units / GMV metrics, "Beat the incumbent" baseline input (saved to the new `benchmark` settings section), the zero-incident proof, CSV export. Nav link added in `app.tsx`.
- **Conversion wiring** — `webhooks.orders.create` calls `markWaitlistConverted` (best-effort; dormant until PCD enables `orders/*`).
- **`AppSettings.benchmark`** — new isolated settings section (schema + `settings.server.ts`), so saving the baseline never touches other settings (§8 item 4).
- **`PILOT-RUNBOOK.md`** — store selection, onboarding, measurement window, success criteria, iterate loop, validation-gate + scoreboard tables, Go/No-go.

## §4 audit checks

1. **Build health** — ⚠ PARTIAL. tsc clean (1 baseline). Live run on the Mac/pilot.
2. **Schema diff (additive-only)** — ✅. New: `AppSettings.benchmark` (String, default "{}"). `convertedAt` already existed. Needs `prisma db push`.
3. **Contract diff** — ✅. Additive: `/app/benchmark` (admin screen) + a new settings section. **No new scopes, no new webhooks.** Recorded as `CC-2026-06-15-03`.
4. **Nova consistency** — ✅. No change to install/billing/ingress.
5. **Regression** — ✅. Benchmark is read-only; the conversion stamp is best-effort and never blocks the order ack; the baseline save is its own isolated section.
6. **Anti-hallucination** — ✅. Conversion reads real `convertedAt`/`notifyStatus`; lift is computed, not asserted. Deploy + install-count items are explicitly **field work, not faked as done**.

## Critical dependency

The conversion numerator (and therefore the lift) only moves once **Protected
Customer Data is approved and `orders/*` is live** — `markWaitlistConverted`
rides orders/create, like order tagging. **Do not start the measurement window
before PCD is enabled** (runbook Prerequisites).

## To finish (field work)

1. **Mac:** `prisma db push` + `shopify app deploy`; enable `orders/*` after PCD.
2. **Pilot:** run `PILOT-RUNBOOK.md` on 2–3 stores; weekly scoreboard; prove lift > 0 and 0/0 incidents.
3. **Validation gate:** reach ≥10 cold paying installs, then open broadly.
