# Encore — Pilot & validation runbook (Phase 5, §3.5)

The pilot proves Encore beats the incumbent on **recovered demand** on real
portfolio stores, then earns the right to open to cold merchants. The
instrumentation is built (`app/services/benchmark.server.ts` + `/app/benchmark`);
this runbook is the operating plan to run it and close the gate.

## Gate (from §3.5) — what "done" means

1. Deployed to **2–3 portfolio stores** running incumbents; recovered-demand benchmark instrumented.
2. **Waitlist→purchase conversion beats the incumbent baseline** (the recovery lift).
3. **Zero oversell incidents; zero untagged-order incidents** across the pilot.
4. Validation gate: **≥10 paying installs from merchants with no prior Nova relationship** before opening broadly.

Items 1 (instrument) and 3 (enforce + measure) are **built**; the pilot supplies
the live data and the install count.

## Prerequisites (once, on the Mac)

- [ ] `npx prisma db push` — picks up `PreOrder.tagged`, `UninstalledShop`, `AppSettings.benchmark`.
- [ ] `shopify app deploy` — registers all extensions + the GDPR webhooks.
- [ ] Set `ENCORE_CRON_SECRET`; schedule `POST /cron/purge-uninstalled` daily.
- [ ] **PCD approval** (Partner Dashboard → Protected customer data) → uncomment `orders/*` in `shopify.app.toml` and redeploy. This activates order tagging **and** the waitlist→purchase conversion stamp (`markWaitlistConverted`), which the benchmark depends on. *Until PCD is live the conversion numerator stays 0 — do not start the measurement window before this.*

## Step 1 — Select the pilot stores

Pick **2–3 portfolio stores** that (a) run a known incumbent preorder/back-in-stock
app today, (b) have real drop/restock volume, and (c) will let you read their
numbers. Record the incumbent name + its current waitlist→purchase rate (from the
incumbent's own reporting) per store.

## Step 2 — Onboard each store

1. Install Encore; enable preorder on the live drop SKUs (OOS scanner / campaign setup).
2. Add the storefront blocks (preorder button, notify-me, low-stock) to the theme; tick the **theme compatibility matrix** (`docs/PHASE-4-COMPLIANCE-AND-PERF.md`).
3. **App → Benchmark → Beat the incumbent**: enter the incumbent name + its conversion rate. This is the baseline the lift is computed against.
4. Confirm the **Reliability** card on App Home reads **0 / 0 / green** at start.

## Step 3 — Instrumentation (already wired — just verify it's live)

| Metric | Where it comes from | Screen |
|---|---|---|
| Waitlist notified / converted / rate | `WaitlistSubscription.notifyStatus=SENT` + `convertedAt` (stamped by `markWaitlistConverted` on orders/create) | `/app/benchmark` |
| Pre-order units + GMV captured | `PreOrder` aggregate | `/app/benchmark` |
| Lift vs incumbent | Encore rate − saved incumbent baseline (percentage points) | `/app/benchmark` |
| Oversell / untagged incidents | `reliability.server.ts` (real audit) | App Home + `/app/benchmark` |

Export the scorecard any time via **Benchmark → Export CSV**.

## Step 4 — Measurement window

- Run **≥1 full drop + restock cycle** per store (recommended 4–6 weeks or 2 drops, whichever is longer) so the waitlist has time to fire and convert.
- Weekly: export each store's CSV, log it (table below), and confirm reliability is still 0/0. **Any oversell or untagged incident pauses the gate** until root-caused (it's a §8 "must never").

## Step 5 — Success criteria

- [ ] **Lift > 0** on each pilot store (Encore waitlist→purchase rate beats the incumbent baseline). A positive `lift_points` on `/app/benchmark`.
- [ ] **0 oversell, 0 untagged** across the whole window, every store.
- [ ] Pre-order capture is non-trivial (units + GMV that would otherwise be lost).

If lift is flat/negative, iterate (timing of the notify, copy, deposit vs pay-now,
per-market gating) and re-measure — don't open to cold merchants yet.

## Step 6 — Validation gate (before opening broadly)

Track installs from merchants with **no prior Nova relationship**. Open to cold
merchants only at **≥10 paying** such installs.

| # | Store | Cold (no Nova tie)? | Plan | Paying since | Notes |
|---|-------|---------------------|------|--------------|-------|
| 1 | | | | | |
| 2 | | | | | |
| … | | | | | |
| 10 | | | | | |

## Pilot scoreboard (fill weekly)

| Store | Incumbent | Incumbent rate | Encore rate | Lift (pts) | Units captured | GMV captured | Oversell | Untagged |
|-------|-----------|----------------|-------------|------------|----------------|--------------|----------|----------|
| A | | | | | | | 0 | 0 |
| B | | | | | | | 0 | 0 |
| C | | | | | | | 0 | 0 |

## Go / No-go

**Go (open broadly)** when: lift > 0 on every pilot store, 0 oversell + 0 untagged
across the window, and ≥10 cold paying installs. Otherwise iterate and re-run the
window.
