# OPUS HANDOVER — Encore to Shopify App Store (Workstream E)

**Audience:** the Claude (Opus) session developing Encore (this repo, `github.com/kanwartalha009/encore`) on Kanwar's Mac.
**Read order, every session:** this doc → `../../docs/06-plan/MASTER-PLAN-2026-07-11.md` (phases E0–E4) → `PRE-LAUNCH-AUDIT.md` + `LIVE-READINESS-AUDIT.md` → invoke the `encore-dev-discipline` skill (`.claude/skills/encore-dev-discipline/`) before writing code.

**Product bar (Kanwar's directive):** better than any preorder app on the App Store *and* simple enough that any store owner uses it without help. Simplicity is achieved by progressive disclosure and defaults — never by deleting capability. Every existing feature must remain reachable.

---

## 0. Operating rules (non-negotiable)

1. **One phase at a time (E0→E4).** Start each phase with a numbered task list with acceptance checks; no task = no code.
2. **Measure, never recall.** Numbers come from commands run now. Run `npm run typecheck` and `npm run build` yourself — you are on the Mac; "authored, unverified" is not a deliverable.
3. **Never remove functionality.** UX changes relocate and default; they do not delete. Any capability removal is a C3 change → stop and ask Kanwar.
4. **The `.server` import trap (cost 3 broken prod builds in June):** a route that imports a *value* from a `*.server` module and uses it in the component (not only in loader/action) fails `react-router build` — dev mode won't show it. Pattern: pure values live in `app/lib/*-shared.ts`; `.server` re-exports them; routes import from the shared module. Run `npm run build` after touching any route/server module.
5. **Polaris + App Bridge conventions:** embedded, session-token auth, `s-app-nav` for nav; API version pinned 2025-10. No external redirects for core flows; billing via `appSubscriptionCreate` (test charges in non-prod).
6. **GDPR + privacy are frozen contracts:** the 3 compliance handlers, 48h purge, encrypted Klaviyo tokens. Don't weaken while refactoring.
7. **Nova integration is load-bearing:** `afterAuth → confirmInstall`, webhook forwarding with `_nova` billing enrichment, durable `NovaOutbox`. Never make Nova calls fire-and-forget; everything goes through the outbox. Shared secrets must match the platform deployment.
8. **End every phase with `PHASE-En-AUDIT.md`** (this repo's existing pattern): checks run, evidence, PASS/FAIL. Update stale docs you encounter (NOVA-INTEGRATION-CONTRACT.md status §, PRE-LAUNCH nav count, DELIVERY-PLAN tracker, CHANGE-CONTROL copy).
9. **i18n:** every new/renamed user-facing string goes through translation keys, all 7 locales. No raw English literals.
10. Commit small, push to origin main. Never commit `.env`.

## 1. Verified current state (2026-07-11 audit)

- 40 routes, 12 extensions (theme app-embed, checkout-validation function `encore-preorder-cap`, customer-account UI, 8 Flow), 15 Prisma models (SQLite). Phases 0–5 code-complete; billing (trial + basic/growth/scale, Nova-priced with fallback), all GDPR topics, durable outbox, selling plans w/ PAY_NOW_FALLBACK: built.
- Complexity hot spots: nav = 12 flat items (`app/routes/app.tsx:18-35`); `app.settings.tsx` = 1081 lines, ~43 fields, 13+ card sections; `CampaignForm.tsx` = 1181 lines, 28 fields; Campaign model ~60 columns; store-default vs per-rule duplication (payment/cart/discount/CTA configured in both).
- Gates: `orders/*` webhook subscriptions commented out in `shopify.app.toml:62-77` pending **PCD approval**; `application_url`/redirects/extension runtime URLs = localhost dev values; not deployed; 0 tests; 1 baseline tsc error (`PrismaSessionStorage` — dup `@shopify/shopify-api`, fix via npm `overrides`); ~12 new admin strings untranslated.
- Platform receiving side IS built and live (ignore the stale contract-doc status section; fix it in E0).

## 2. Phase specifications

### E0 — Unblock externals (day 1, before any code)

1. **File the Protected Customer Data request** in the Partner dashboard (org 1710157) for order data: justification = order tagging of preorders, deposit/balance collection, waitlist→purchase conversion measurement. This has the longest lead time in the whole plan.
2. Set up the support email address (goes in listing + app).
3. Draft the listing kit: app name (`Encore — Preorder & Back in Stock`), tagline, long description (lead with simplicity + no-oversell + partial payments), keyword-relevant category copy.
4. Doc fixes: NOVA-INTEGRATION-CONTRACT.md status §, PRE-LAUNCH nav count, DELIVERY-PLAN checkboxes, replace the stale platform CHANGE-CONTROL copy with an Encore-scoped one.

### E1 — Simplicity overhaul (the core UX phase)

Design principles: 3 clicks to first preorder; one obvious path; defaults over decisions; Advanced exists but is closed; merchant vocabulary only.

1. **Nav 12 → 6:** Home · Preorders · Back in stock · Insights · Settings · Plans.
   - Insights = Demand + Benchmark + Low-stock + Cohorts as tabs of one route.
   - Markets → a "Where it applies" section inside the preorder rule + a card in Settings. Translations → Settings tab. Notifications → Settings tab (templates) with a link from the rule form. Waitlist stays as "Back in stock".
2. **Settings mega-page → tabbed page with progressive disclosure:** tabs ≈ General · Storefront (button/design/preview + storefront block) · Payments (deposits/balance/dunning → "Partial payments" in merchant language) · Notifications (templates + Klaviyo/Flow connect) · Advanced (discount compatibility, integrations, danger zone, developer fields). Each tab: essentials visible, the rest in collapsed groups. Target ≤8 visible fields per tab before disclosure.
3. **Onboarding wizard (new):** first-run 3 steps — pick products → choose mode (preorder now / when out of stock / on a date) → style the button (live preview) → Publish. Creates a Campaign with defaults; dashboard empty state routes into it. This is also the reviewer's first-run path — make it flawless.
4. **"Set once, override rarely":** CampaignForm inherits store defaults (payment, cart, discount, CTA copy); collapsed "Override for this preorder" per group replaces duplicated always-open fields. Simple path (existing "three quick steps") becomes the default; everything else under Advanced.
5. **Jargon renames** (labels/help text only, not schema): MOQ → "Minimum orders to confirm", dunning → "Payment reminders", zone overrides → "Regional settings", metafield namespace → Advanced/developer section, ctaPlacement REPLACE/BESIDE/STACK → visual picker.
6. **Get-help form** (nav footer or Settings): subject + message → Nova outbox → platform internal support endpoint (coordinate payload with platform N4; queue via NovaOutbox so it ships even if N4 lands later).
7. i18n all changed strings (7 locales). Gate: `npm run build` + `typecheck` clean; every pre-existing route/capability reachable; screenshot walkthrough of install→first preorder recorded for the listing.

### E2 — Approval readiness

1. Per-env config: parameterize `shopify.app.toml` application_url/redirects + Flow `runtime_url`s + customer-account APP_URL for prod (separate toml via `shopify app config link` or env substitution); keep dev config working.
2. Fix the tsc baseline error with npm `overrides` dedupe of `@shopify/shopify-api`; remove the `as any` on PrismaSessionStorage.
3. Error boundaries on all routes; empty states everywhere a reviewer can land; complete translations.
4. Performance: Lighthouse on a dev store with the theme extension enabled (App Store requires no significant score drop); lazy-load the storefront script.
5. Listing kit final: icon, 6+ screenshots (post-E1 UI), demo store, privacy policy + terms URLs (host on the platform's apps/web — coordinate), pricing table matching in-app plans, reviewer test instructions (test store, how to place a test preorder, billing test mode note).
6. Smoke tests (first tests in repo): billing plan math, campaign visibility resolution, cap-function input building, outbox retry/backoff. Keep it small but real (`npm test` wired).

### E3 — Deploy + the single E2E test (⇄ platform N2)

1. Railway: Docker service from this repo, volume at `/data` (`DATABASE_URL=file:/data/encore.sqlite`), nightly volume backup; envs per `../../docs/deploy/DEPLOY-05-encore.md` (SHOPIFY_API_KEY=98895e88…, secret from Partner dashboard, NOVA_API = platform Railway URL **without** `/v1`, shared secrets identical to platform, ENCORE_CRON_SECRET, APP_ENCRYPTION_KEY).
2. Schedule crons: `/cron/nova-outbox` every 1–2 min, purge + balance-reminder crons per PILOT-RUNBOOK.
3. Update Partner app URLs to the Railway domain; `npm run setup` (migrations); `shopify app deploy` (extensions).
4. When PCD approved: uncomment `orders/*` topics in toml, redeploy, verify order tagging + conversion stamp.
5. **The single full test** (record evidence in PILOT-RUNBOOK results section): fresh dev store → referral install `https://<encore>/install?ref=nova&shop=…` → onboarding wizard → preorder placed (deposit mode) → test subscription charge → verify in Nova admin: Store attributed to agency `nova`, exactly 1 Charge + 1 PENDING Commission → GDPR `shop/redact` test → uninstall → accrual stops. Theme-compat check on 2–3 popular themes.

### E4 — Submit

1. Final `shopify app deploy` + listing submission from the Partner dashboard.
2. Own the review loop: respond to reviewer feedback same-day; keep a `REVIEW-LOG.md` of every reviewer request and the fix commit.
3. Post-approval: verify production billing (real charge on a real store), then the ≥10 cold-install pilot target.

## 3. Session template

(1) `git pull`, read MASTER-PLAN E-phase checkboxes → (2) restate phase goal + task list → (3) implement in small commits, running `typecheck` + `build` (+ `npm test` from E2) each commit → (4) i18n + doc updates in the same commit → (5) tick checkboxes, extend `PHASE-En-AUDIT.md` → (6) close with verified-vs-assumed summary.
