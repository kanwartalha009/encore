# Encore Submission-Readiness Audit — 2026-07-12

**Scope:** shopify/encore end-to-end completeness, anomalies, and Shopify App Store submission readiness. Fresh snapshot taken today; all prior findings re-verified from code (E0 and E1 landed since the 2026-07-11 audit). Counts measured; citations inline. Requirements cross-checked against Shopify's current app-requirements checklist.

## 1. Direct answers

| Question | Answer |
|---|---|
| Ready to submit to the App Store today? | **No.** E0 is partial, E1 is unverified-on-Mac, and E2/E3/E4 have not started. Nothing is deployed; every production URL is still localhost. Ordered path in §6. |
| Are functionalities complete end to end? | **Core features: yes, verified** (preorder rules, deposits/selling plans, back-in-stock, no-oversell function, billing with trials, GDPR, notifications, markets, insights). **Two holes:** the new Get-help form silently loses every ticket (A1, P0 bug), and all `orders/*`-dependent features (order tagging, conversion tracking, preorder-placed messaging) are dormant until PCD approval. The money-path E2E has never been run live. |
| Anomalies? | 8 found (§4), one P0. |

## 2. What changed since 2026-07-11 (verified)

E0 executed: listing kit drafted (`LISTING-KIT.md`), all four doc-drift fixes (D1/D3/D4/D6) landed and verified in the files. E1 executed: nav 12 → 6 (`app/routes/app.tsx:21-30`, `grep -c s-link` = 6: Dashboard, Preorders, Back in stock, Insights, Settings, Plans); Insights hub with 4 tabs linking to preserved full views (`app.insights.tsx:29-32,105-146`); 3-step onboarding wizard that creates a LIVE campaign and is linked from the dashboard empty state (`app.onboarding.tsx:54-63`; `app._index.tsx:510-519`); settings gained a section switcher + "More settings" links to Markets/Translations/Notifications/Help (`app.settings.tsx:252-264,1040-1043`); Get-help form added (`app.help.tsx`); demo-data pickers replaced with real resourcePicker/collection fetches (`AUDIT-E2E-2026-07-11.md` findings 1,2,5 fixed). Platform side: a real `support` module now exists with the internal ticket endpoint (`apps/api/src/modules/support/support.controller.ts:107-122`). **No feature loss detected:** all 8 old routes still exist and are reachable via Insights tabs or Settings links.

Route files: 46 tsx (was 40+auth); nav 6 (was 12); settings 1109 lines / 39 controls (was 1081/43); CampaignForm 1134 lines (was 1181); Prisma models 15 (unchanged); tests 0 (unchanged).

## 3. Anomalies

| # | Finding | Severity | Evidence |
|---|---|---|---|
| A1 | **Get-help tickets are silently lost.** Encore sends `{shopDomain, message, email: null}`; the platform's `internalTicketSchema` requires `shop` and `body` and rejects `email: null` (null fails `.optional()`). zodParse throws 422 → outbox retries → DEAD, while the merchant sees "your message is on its way." Fix: rename `shopDomain`→`shop`, `message`→`body`, omit null email. | **P0** | nova.server.ts:161-169 vs packages/shared/src/schemas/support.ts:9-15; support.controller.ts:121; app.help.tsx:56 |
| A2 | **E1 work is uncommitted.** 33 modified/untracked files in the Encore working tree (git status), nothing pushed to `kanwartalha009/encore`. A machine failure loses the whole overhaul. | High | git status: 21 M + 12 untracked |
| A3 | **E1 never verified on Mac.** Both PHASE-E0/E1 audits punt `npm run typecheck` + `npm run build` to the Mac (sandbox lacks rollup arm64). tsc-on-disk was 0 errors, but the prod build — the `.server`-trap gate — has not run. Static scan found no trap suspects, but the gate is the build itself. | High | PHASE-E1-AUDIT.md:58,64,69 |
| A4 | **"Inherit store defaults / override per rule" was not actually implemented.** One helpText string claims it (CampaignForm.tsx:735); `buildFormData` (:450-471) still hardcodes defaults with no inheritance mechanism. The E1 gate claim overstates this. Duplicated store-vs-rule config — the core UX complaint — remains. | Medium | CampaignForm.tsx:450-471,735 |
| A5 | **Settings is still one 1109-line monolith** with an in-page section switcher, not decomposed; acceptable UX-wise (11 sections, progressive) but the file remains the maintenance hot spot and grew +28 lines. | Low | app.settings.tsx wc -l; :252-264 |
| A6 | Insights money formatting hardcodes USD (`Intl.NumberFormat("en-US" … USD)`) regardless of shop currency. | Low | app.insights.tsx:63-64 |
| A7 | Nav keys `t("Insights")` / `t("Plans")` use raw literals instead of `nav.*` keys (works via RETROFIT catalog; style drift). Residual "I-1…I-10" platform references linger in CHANGE-CONTROL/DELIVERY-PLAN bodies after the D6 fix. | Low | app.tsx:24,29; CHANGE-CONTROL.md C3 row |
| A8 | Production DB posture is `prisma db push` with a single ancient migration (Session only); 14 models have no migration history. Fine for SQLite pilot, no rollback story. | Low | package.json:14; prisma/migrations |

Not anomalies (verified clean): `.server` import discipline across all routes; i18n coverage of all new strings in 7 locales (RETROFIT map, i18n.tsx:314-795); billing test-charge gating (`test: NODE_ENV !== "production"`, billing.server.ts:55-58,83-135); GDPR topics + purge crons intact; `collections.server.ts` exports match importers.

## 4. Submission checklist vs Shopify requirements

| Requirement | Status |
|---|---|
| OAuth immediately, session tokens, embedded App Bridge | Met (token exchange, App Bridge v4, embedded=true) |
| Billing via Shopify Billing API, plan changes without reinstall | Met (appSubscriptionCreate, trials; charges in admin history) |
| Mandatory GDPR webhooks | Met (3 compliance topics + handlers + 48h purge) |
| Lighthouse: ≤10-point drop with theme extension | **Not run** (E2) |
| Icon 1200x1200, 3-6 screenshots 1600x900, feature media | **Missing** (E2; copy drafted, assets unchecked in LISTING-KIT.md:59-63) |
| Privacy policy URL (mandatory) + terms | **Missing — pages do not exist**; apps/web has no privacy/terms routes (verified) |
| Support contact | **Placeholder** `<support@…>` (LISTING-KIT.md:13) |
| Reviewer test instructions + demo store credentials | Instructions drafted; **demo store missing** |
| Production application_url / redirects / extension runtime_urls | **All localhost** (shopify.app.toml:7,16,81; 2 Flow extension tomls) |
| App deployed and installable | **Not deployed** (E3) |
| Protected customer data approval (orders/*) | **Not filed** — E0.6 external, only Kanwar can do it; toml:62-77 still commented |
| No deprecated APIs | Met (API pinned 2025-10) |

## 5. End-to-end status of the single test

The "single full test" (referral install → onboarding → preorder → test charge → 1 Charge + 1 Commission in Nova admin → redact → uninstall-stops-accrual) has **never been run**; `AUDIT-E2E-2026-07-11.md` is a static grep/tsc audit (it says so, lines 4-6), not a live run. It fixed 3 critical demo-data findings but left runtime behavior (resourcePicker, Collection.hasProduct) unverified against a live store.

## 6. Ordered path to submission

1. Commit + push the E1 working tree (A2), then on the Mac: `npm run typecheck && npm run build` (A3).
2. Fix A1 (3-line payload fix) + A6; add the missed inherit-defaults mechanism or amend the E1 audit claim (A4).
3. Kanwar: file PCD request; confirm support email (E0 closes).
4. E2: prod URL parameterization, tsc overrides dedupe, error boundaries, Lighthouse, privacy/terms pages on apps/web, icon + screenshots + demo store, smoke tests.
5. E3: Railway deploy + crons + the single live E2E test (⇄ platform N2); uncomment `orders/*` on PCD approval.
6. E4: submit.

## 7. Verdict

Encore is functionally deep, architecturally clean, and after E1 genuinely simple to start with — the overhaul preserved every capability (verified route by route). But it is **not submission-ready**: one P0 integration bug, the work uncommitted and unverified by a prod build, zero listing assets, no privacy policy, no deployment, no live E2E, and the PCD request — the longest external lead — still unfiled. Realistic remaining work is E2+E3 plus roughly a day of fixes, then submission awaits only Shopify's own PCD/review clocks.
