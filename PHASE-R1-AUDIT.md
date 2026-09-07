# PHASE R1 / R1.5 AUDIT — Encore (started 2026-09-07, living document until submission)

Every row: what was checked, the evidence (command / screenshot / log line run on the date shown), and PASS / FAIL / PENDING. No row is marked PASS from memory.

## 1. Server & operations

| Check | Evidence | Result |
|---|---|---|
| Deploy live | `GET /health` → `status: ok, db: ok, scheduler.started: true, lastOutboxTickAt` 38 s old, outbox pending 0 / dead 11 (2026-09-04) | PASS |
| Scheduler ticking | Railway deploy logs filter `scheduler`: `[scheduler] started — outbox every 2min…` at boot; `[scheduler/outbox]` ticks with backoff | PASS |
| Outbox delivery | `sent=0 failed=N` on every tick → Nova backend offline; 11 rows DEAD. Nothing lost; needs R1.5-10 decision | PENDING (Kanwar decision) |
| Webhook delivery | Real inventory change 0→1→0 → `POST /webhooks/inventory_levels/update 200`, `POST /webhooks/products/update 200` (2026-09-01) | PASS |
| Webhook idempotency | orders/create dedupes by (shop, orderGid, orderRef); side-effects gated on `createdCount > 0`; unique index added to schema + P2002-tolerant create (2026-09-07) | PASS (code) / index applies on next deploy |
| orders/* subscriptions | Commented in `shopify.app.toml` (PCD gating) — no order reaches the app until R1.5-5/6 | **FAIL until PCD** |
| Email sending | Railway variables: no `RESEND_API_KEY`, no `EMAIL_FROM` (2026-09-01) | **FAIL until R1.5-7** |
| GDPR + uninstall webhooks | Routes present, compliance topics subscribed in toml | PASS (config) |
| Diagnostics removed | `grep -rn sendBeacon\|client-log app` → 0; `client-log.tsx` moved to `_to_delete/` (2026-09-07) | PASS (pending push) |

## 2. Admin (render-walk 2026-09-07, every route by URL + every nav link)

| Route | Result |
|---|---|
| `/app` dashboard | PASS — real zeros, outbox banner truthful, Reliability "All clear" |
| `/app/campaigns` | PASS — list, filters, relative time "6 days ago" |
| `/app/campaigns/:id` | PASS — real KPIs, cohort copy new; subtitle shows raw product GID while campaign targets the fake product (resolves after retarget) |
| `/app/campaigns/:id/edit` | PASS — form pre-filled |
| `/app/campaigns/new` | PASS — Publish disabled until required fields |
| `/app/cohorts` | PASS — empty state |
| `/app/waitlist` | PASS — honest zeros, import/export present |
| `/app/insights` (4 tabs) | PASS — empty states |
| `/app/demand`, `/app/benchmark`, `/app/low-stock`, `/app/markets` | PASS — benchmark copy merchant-language, markets reconciled timestamp real |
| `/app/notifications`, `/app/translations` | PASS — translations "0 / 8 translated" honest, samples as placeholders |
| `/app/settings`, `/app/plans`, `/app/help`, `/app/onboarding` | PASS |
| Nav links ×6 (parent-side) | PASS — each click lands on its route (URL verified) |
| In-frame buttons (bulk actions, pickers, Save, Choose plan) | PENDING — human spot-check (KANWAR-CHECKLIST #10); automation cannot click inside the embedded frame |

Cosmetic notes (non-blocking): sub-pages not in the nav highlight "Dashboard" (App Bridge default); markets reconciled time uses locale short date.

## 3. Storefront (dev-novasolutions, Debut theme)

| Check | Evidence | Result |
|---|---|---|
| Extension released + embed ON | PDP JS: `autoWrap: true, preInForm: true, notInForm: true, encoreJs: true` (2026-09-04) | PASS |
| Universal auto-mount | Preorder + notify shells relocated into `form[action*="/cart/add"]` next to the buy button | PASS |
| Config proxy | `/apps/encore/config` returns JSON; `preorder: null` because the live campaign targets `gid://shopify/Product/1001` | PENDING (R1.5-1) |
| Preorder button + badge on PDP | — | PENDING (after R1.5-1) |
| Collection badge | — | PENDING |
| Add-to-cart carries `_preorder`, ship date, selling plan | — | PENDING |
| Mixed cart (Echo Bag, published 2026-09-04) + notice | — | PENDING |
| Checkout reached (no payment) | — | PENDING |
| Notify-me on OOS product | `backInStock.enabled` false until the BIS-default fix is pushed (R1.5-2) | PENDING |

## 4. Build gates (container mirror, 2026-09-07)

`react-router typegen && tsc --noEmit` → baseline noise only (prisma engine unavailable in container; Kanwar's Mac typecheck is the authority) · `npm run build` → 0 errors · `vitest run` → 7 files, 34 tests passed.

## 5. Verdict so far

Server, admin rendering, webhooks, universal embed: PASS. Submission is gated on the PCD approval + email keys (external) and the storefront E2E proof, which is gated on the campaign retarget. This file is updated as each PENDING row resolves.
