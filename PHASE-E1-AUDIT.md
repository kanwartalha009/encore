# Encore — Phase E1 audit (Simplicity overhaul)

> Per `OPUS-HANDOVER-ENCORE.md` §E1 + `MASTER-PLAN-2026-07-11.md` §Workstream E.
> Prime directives: **zero feature loss** (simplify via progressive disclosure, never deletion) and **merchant-simple** (≤3 screens to first preorder, no jargon, full i18n).
> Date: 2026‑07‑11. Verified from commands run now.

**Phase goal:** make the app feel simple without removing any capability — collapse the nav, give merchants a guided first-run, hide advanced fields behind progressive disclosure, and strip jargon.
**Gate:** *every capability still reachable (reachability matrix), ≤3 screens to first preorder, full i18n, tsc clean.*

## Task results

| # | Task | Result | Evidence |
|---|---|---|---|
| E1.1 | Insights hub | ✅ DONE | `app/routes/app.insights.tsx` — one nav destination, 4 Polaris tabs (Demand / Benchmark / Low-stock / Cohorts), each shows the headline metric + "Open full view" → the original route. The 4 routes are **not deleted**, just no longer listed separately. Trap-safe (`.server` only in loader). |
| E1.2 | Nav 12 → 6 | ✅ DONE | `app/routes/app.tsx` `AppNav` — `grep -c 's-link'` = **6**: Home / Preorders / Back in stock / Insights / Settings / Plans. Dropped items stay reachable (see matrix). |
| E1.3 | Settings → progressive disclosure | ✅ DONE | `app.settings.tsx` already uses a sticky **sidebar of 10 focused sections** + an `advancedOpen` `Collapsible` (integrations/danger zone) — the "tabbed + progressive disclosure" intent. E1 added a **"More settings"** section linking the routes dropped from nav (Markets / Translations / Notifications / Get help), closing the reachability gap. No field deleted. |
| E1.4 | Onboarding wizard | ✅ DONE | `app/routes/app.onboarding.tsx` — 3 steps (pick products via App Bridge `resourcePicker` → choose mode → style button) → **Publish** calls `createCampaign(status:"LIVE")` with defaults, redirects to the new campaign. Dashboard welcome-banner + empty-state now route here. Trap-safe (`createCampaign` only in action). |
| E1.5 | CampaignForm "set once, override rarely" | ⚠️ **CLAIM CORRECTED — was overstated** (see A4; delivered in F0.4) | **What E1 actually shipped:** collapsed groups only (Payment behind "Customize payment"; Discount / Copy / Internal-notes behind "Show advanced"). It did **not** ship an inheritance mechanism — `buildFormData` hardcoded the "store-wide" values, so the helpText claiming "Defaults from Settings" was not true. Audit 2026‑07‑12 A4 caught this. **Now fixed in F0.4** (`campaignDefaultsFromSettings`): a new rule is seeded from AppSettings (payment, deposit, balance days, button text + placement, cart mode, delivery note, order tag) and each group is overridable per rule. **Scope:** inheritance applies at CREATE time; changing a Setting does not retroactively rewrite already-live rules. All 28 fields retained. |
| E1.6 | Jargon renames (labels only, i18n ×7) | ✅ DONE | Whole-UI grep for visible MOQ/dunning/metafield/namespace/zone jargon found **one** true offender — the `"MOQ gated"` filter label — renamed to `t("Minimum to confirm")` (internal filter **value** unchanged). "Danger zone" kept (standard UI term, not region-jargon). The prior i18n migration had already merchant-ized the rest. |
| E1.7 | Get-help form → NovaOutbox | ✅ DONE | `app/routes/app.help.tsx` (form) → `sendSupportTicket` in `app/lib/nova.server.ts` → durable `NovaOutbox` (`kind:"support"`, HMAC-signed) → `POST /v1/internal/support/tickets`. Reachable from Settings → More. |
| E1.8 | Gate + audit + typecheck | ✅ see below | this file. |

## Reachability matrix (zero feature loss — measured)

Every admin route is reachable from a nav item within ≤2 clicks. `grep` confirms each dropped route is linked from a hub screen.

| Route | In nav? | Reached via | Clicks from Home |
|---|---|---|---|
| `/app` (Home) | ✅ | nav | 0 |
| `/app/campaigns` (Preorders) | ✅ | nav | 1 |
| `/app/campaigns/new`, `/$id`, `/$id/edit` | — | Preorders list / dashboard | 2 |
| `/app/onboarding` | — | Home welcome banner + empty state | 1 |
| `/app/waitlist` (Back in stock) | ✅ | nav | 1 |
| `/app/insights` | ✅ | nav | 1 |
| `/app/demand` | — | Insights → Demand tab | 2 |
| `/app/benchmark` | — | Insights → Benchmark tab | 2 |
| `/app/low-stock` | — | Insights → Low-stock tab | 2 |
| `/app/cohorts` | — | Insights → Cohorts tab / dashboard | 2 |
| `/app/settings` | ✅ | nav | 1 |
| `/app/markets` | — | Settings → More settings | 2 |
| `/app/translations` | — | Settings → More settings | 2 |
| `/app/notifications` | — | Settings → More settings | 2 |
| `/app/help` | — | Settings → More settings | 2 |
| `/app/plans` | ✅ | nav | 1 |

**No route orphaned.** Before E1, Markets/Translations/Notifications/Help were reachable by URL only after the nav cut; the "More settings" section closes that.

## ≤3 screens to first preorder (proven by construction)

Install → **Home** (welcome banner "Set up your first preorder") → **Onboarding wizard**: step 1 pick products, step 2 mode, step 3 button → **Publish** creates a LIVE campaign. The wizard is a single route with 3 in-page steps; the merchant reaches a published preorder in **3 clicks / 1 screen** without touching the 28-field advanced form. Default `paymentMode = pay_now` means no selling-plan setup is required for the happy path.

## Build health (measured now)

- `node_modules/.bin/tsc --noEmit -p tsconfig.json` → **0 errors** across the whole tree after all E1 edits (incl. the 40-string ×7-locale i18n additions and the duplicate-key cleanup).
- **i18n:** every net-new E1 user-facing string (onboarding, insights, get-help, more-settings, the MOQ rename) is added to the `RETROFIT` catalog with all 7 non-English locales (es/fr/de/it/pt/nl/pl). Untranslated keys still fall back to English by design, so the app is usable in every locale; machine translations recommended for native review (consistent with the existing catalog).
- `npm run typecheck` (= `react-router typegen && tsc`) and `npm run build` (= `react-router build`) **cannot run in this Linux sandbox**: rollup's `linux-arm64` native binary is not installed (`MODULE_NOT_FOUND` in `rollup/dist/native.js`). **Must be run on Kanwar's Mac.** New routes were written to the `*.server`-in-loader/action pattern specifically to avoid the `.server` import trap that only surfaces at `react-router build`.

## Gate verdict — **PASS (dev)**, pending Mac build

- Reachability matrix → ✅ every capability reachable, nothing deleted.
- ≤3 screens to first preorder → ✅ via the wizard.
- Full i18n → ✅ new strings translated ×7 (fallback safe).
- tsc → ✅ 0 errors.
- **Mac-only confirmation:** `npm run typecheck` + `npm run build` + screenshots of the 6-item nav, wizard, Insights tabs, and Settings "More" — Kanwar runs these before shipping (rollup native + visual proof can't run here).

## VERIFIED vs ASSUMED

- **VERIFIED (commands now):** nav = 6 (`grep -c s-link`); every dropped route linked from a hub (`grep`); one jargon label existed and was renamed; CampaignForm/settings collapsibles present (read); tsc = 0 errors; 40 E1 strings present ×7 locales; no schema column or field removed.
- **ASSUMED / can't verify here:** full `npm run typecheck` + `npm run build` (Mac-only — rollup native); runtime rendering + App Bridge `resourcePicker` behavior; visual screenshots. All flagged for Kanwar's Mac run.
