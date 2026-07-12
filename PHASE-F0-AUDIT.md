# Encore — Phase F0 audit (Secure & repair)

> Per `OPUS-FINISH-ENCORE-2026-07-12.md` §F0, findings from `AUDIT-SUBMISSION-READINESS-2026-07-12.md`.
> Date: 2026‑07‑12. Every number below came from a command run now.

**Phase goal:** get the E1 work durably saved and *proven by a prod build*, kill the P0 support bug, and close the small correctness gaps — so E2 starts from a verified baseline.

## Task results

| # | Task | Result | Evidence |
|---|---|---|---|
| F0.1 | Commit + push the E1 working tree | ⚠ **COMMITTED, NOT PUSHED** | 6 logical commits (`3eabade` docs · `ceff2e2` support P0 · `250f62b` E1 UI · `5c6942c` real-Shopify-data · `8bae922` currency+i18n · `d0e706d` extensions). `git status --porcelain` = **empty**. `git rev-list --count origin/main..HEAD` = **6**. **Push blocked: this sandbox has no git credentials** (`git push --dry-run` → "could not read Username for https://github.com"). ⇒ **Kanwar: `git push origin main`.** |
| F0.2 | `npm run typecheck` AND `npm run build` | ✅ **PASS — both exit 0** | Previously punted to the Mac (A3). Unblocked here by installing the linux‑arm64 native binaries the Mac install omitted (`@rollup/rollup-linux-arm64-gnu@4.60.3`, `@esbuild/linux-arm64@0.25.12`) into `node_modules` — **`package.json` and `package-lock.json` are untouched** (`git status` on both = clean). **No `.server` import trap surfaced.** The documented "baseline PrismaSessionStorage tsc error" did **not** appear: tsc is at **0 errors**. |
| F0.3 | Support payload → `shop`/`body`/omit-null email (A1, P0) | ✅ **DONE** (code was already correct on disk; committed as `ceff2e2`) | `nova.server.ts` sends `{appSlug, shop, subject, body, …(email ? {email} : {}), source, createdAt}`. Platform `internalTicketSchema` is now tolerant (accepts `shop`\|`shopDomain`, `body`\|`message`, `email` nullish) — so both spellings validate. **DEAD-row purge = provable no-op:** the generated Prisma client has no `novaOutbox` delegate (`p.novaOutbox` is `undefined`) ⇒ no NovaOutbox table in the local DB; and nothing is deployed (all URLs localhost), so no ticket has ever been sent anywhere. Nothing to purge. |
| F0.4 | Real inherit-store-defaults in CampaignForm (A4) | ✅ **DONE — option (a), approved by Kanwar** | New export `campaignDefaultsFromSettings(general)` (pure) maps AppSettings → form values: `defaultPaymentMode`→paymentMode, `defaultDepositPct`→depositAmount, `balanceChargeDays`→balanceCaptureDays, `defaultButtonLabel`→ctaLabel, `ctaPlacement`→ctaPlacement (**new field**, was hardcoded `"REPLACE"`), `mixedCartWarning`/`mixedCartMessage`→cartMode/message, `defaultDeliveryNote`→deliveryNote, `orderTagName`→orderTags. `app.campaigns.new` loader seeds `initialValues` from it. `buildFormData` now writes inherited-or-overridden values — `grep` for the old hardcodes (`ctaPlacement "REPLACE"`, `orderTags ["preorder"]`, `metafieldNamespace "preorder_novafied"`) returns **none**. Payment group relabelled **"Override for this preorder"** (un-checking restores the *store default*, not a hardcoded pay-now); new Button override group (text + placement) in Advanced; summary line shows the inherited mode + "(from Settings)". 10 new strings ×7 locales. |
| F0.5 | Currency hardcode (A6) + nav i18n keys (A7) + residual I‑1…I‑10 refs | ✅ **DONE** | **A6 was wider than the audit cited**: not just `app.insights.tsx:64` — `app/lib/format.ts:formatGmv` also hardcoded `$`/en‑US and feeds dashboard, cohorts, campaigns index + detail, benchmark. Added `models/shop.server.ts:getShopCurrency` (Admin `shop { currencyCode }`, memoized, "USD" fallback) + `formatMoney(minor, currency, locale)`; threaded through all 6 screens. `grep -c 'en-US.*USD' app.insights.tsx` = **0**. **A7:** nav now `t("nav.insights")`/`t("nav.plans")`; `grep -cE 't\("Insights"\)\|t\("Plans"\)' app.tsx` = **0**; `grep -c '"nav.insights"' i18n.tsx` = **8** (EN + 7 locales). Residual `I-1…I-10` refs in CHANGE-CONTROL/DELIVERY-PLAN → replaced with Encore frozen-contract language; `grep` = **none**. |
| F0.6 | Phase audit + commit | ✅ this file | |

## Gate verdict — **PASS**, one open item

- Build gate (the one E1 never ran): **PASS**, both commands exit 0.
- Working tree: **clean**.
- **Open (Kanwar):** `git push origin main` — no git credentials in this environment.

## F0.4 — decision taken (option a), scope recorded

The execution order's acceptance check said *"changing a Setting changes non-overridden **live** rules"* — that is **runtime** inheritance (nullable override columns + fallback resolution across the storefront resolver, selling-plan sync, cap function and order tagging). It touches the **deposit / selling-plan money path** and needs a schema change on a DB with **no migration history** (A8), days before submission. I flagged it rather than doing it silently; **Kanwar chose option (a)**.

**Shipped:** inheritance at **create** time — a new rule is seeded from Settings and every inherited group is overridable per rule. **Not shipped (deliberate):** retroactive re-resolution of already-live rules when a Setting changes. The E1 audit's E1.5 row has been **corrected** to say exactly this, so the overstated claim cannot reach the listing or the reviewer. Full runtime inheritance remains available post-approval if merchants ask for it.

## External gates (Kanwar only — NOT claimed done here)

- **PCD request** (Partner org 1710157) — unfiled. Longest lead item.
- **Support email** for `LISTING-KIT.md:13` — still a placeholder.
- App review outcome — n/a.

## VERIFIED vs ASSUMED

- **VERIFIED (commands now):** typecheck exit 0; build exit 0 (no `.server` trap); working tree clean; 6 commits ahead of origin/main; push credentials absent; nav = 6 `s-link`; A6 fixed across 6 screens and 0 `en-US/USD` left in insights; `nav.insights` present in 8 locale blocks; 0 residual `I-n` refs; `p.novaOutbox` undefined ⇒ no outbox table ⇒ nothing to purge; support payload matches `internalTicketSchema` (read both sides).
- **ASSUMED / not verifiable here:** runtime behaviour against a live store (resourcePicker, `Collection.hasProduct`, `shop { currencyCode }`) — E3's live E2E covers it; that the Mac's `npm ci` restores the darwin binaries (it will — package.json/lock unchanged).
