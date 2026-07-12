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
| F0.4 | Real inherit-store-defaults in CampaignForm (A4) | ⛔ **BLOCKED — awaiting Kanwar's decision** (NOT silently deferred) | Confirmed real: `buildFormData` hardcodes `ctaPlacement:"REPLACE"`, `allowGuestCheckout:"on"`, `orderTags:["preorder"]`, `metafieldNamespace`, `restockAlert`, `merchantAlert*` and reads the rest from `CAMPAIGN_FORM_DEFAULTS` — no AppSettings inheritance. See "F0.4 decision" below. |
| F0.5 | Currency hardcode (A6) + nav i18n keys (A7) + residual I‑1…I‑10 refs | ✅ **DONE** | **A6 was wider than the audit cited**: not just `app.insights.tsx:64` — `app/lib/format.ts:formatGmv` also hardcoded `$`/en‑US and feeds dashboard, cohorts, campaigns index + detail, benchmark. Added `models/shop.server.ts:getShopCurrency` (Admin `shop { currencyCode }`, memoized, "USD" fallback) + `formatMoney(minor, currency, locale)`; threaded through all 6 screens. `grep -c 'en-US.*USD' app.insights.tsx` = **0**. **A7:** nav now `t("nav.insights")`/`t("nav.plans")`; `grep -cE 't\("Insights"\)\|t\("Plans"\)' app.tsx` = **0**; `grep -c '"nav.insights"' i18n.tsx` = **8** (EN + 7 locales). Residual `I-1…I-10` refs in CHANGE-CONTROL/DELIVERY-PLAN → replaced with Encore frozen-contract language; `grep` = **none**. |
| F0.6 | Phase audit + commit | ✅ this file | |

## Gate verdict — **PASS with two open items**

- Build gate (the one E1 never ran): **PASS**, both commands exit 0.
- Working tree: **clean**, 6 commits.
- **Open 1 (Kanwar):** `git push origin main` — I cannot push from here.
- **Open 2 (Kanwar):** the F0.4 decision below. E2 can start regardless; F0.4 does not block it.

## F0.4 decision needed

The execution order's acceptance check is *"changing a Setting changes non-overridden **live** rules' behavior"* — that is **runtime** inheritance, which requires nullable override columns on `Campaign` plus fallback resolution (`campaign.override ?? settings.default`) in the storefront resolver, selling-plan sync, cap function and order tagging. That touches the **deposit / selling-plan money path** and needs a schema change on a DB with **no migration history** (A8), days before submission. My judgement: **too risky to do silently.** Options:

1. **Seed-at-create + override groups (recommended).** New-rule loader seeds the form from AppSettings; payment/cart/discount/CTA collapse under "Override for this preorder"; `buildFormData` writes inherited-or-overridden values. No schema change, no money-path risk. Delivers "set once, override rarely" for new rules. Does **not** retroactively change existing live rules → I would amend the E1 audit claim to say exactly that.
2. **Full runtime inheritance.** Matches the acceptance check literally; highest risk (money path + schema, pre-submission).
3. **Defer + amend the claim.** No inheritance work now; strike the overstated claim from `PHASE-E1-AUDIT.md`, log A4 as known debt, revisit post-approval.

Until Kanwar picks, the E1 audit's "set once, override rarely" line stands as **overstated** — flagged here so it is not carried into the listing or the review.

## External gates (Kanwar only — NOT claimed done here)

- **PCD request** (Partner org 1710157) — unfiled. Longest lead item.
- **Support email** for `LISTING-KIT.md:13` — still a placeholder.
- App review outcome — n/a.

## VERIFIED vs ASSUMED

- **VERIFIED (commands now):** typecheck exit 0; build exit 0 (no `.server` trap); working tree clean; 6 commits ahead of origin/main; push credentials absent; nav = 6 `s-link`; A6 fixed across 6 screens and 0 `en-US/USD` left in insights; `nav.insights` present in 8 locale blocks; 0 residual `I-n` refs; `p.novaOutbox` undefined ⇒ no outbox table ⇒ nothing to purge; support payload matches `internalTicketSchema` (read both sides).
- **ASSUMED / not verifiable here:** runtime behaviour against a live store (resourcePicker, `Collection.hasProduct`, `shop { currencyCode }`) — E3's live E2E covers it; that the Mac's `npm ci` restores the darwin binaries (it will — package.json/lock unchanged).
