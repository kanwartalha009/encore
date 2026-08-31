# Encore 10/10 Plan — phase checklists to "unforgettable" (2026-08-31)

Goal: an app store owners love and recommend — it doesn't just manage preorders, it **tells merchants how to make more revenue** and does the work for them. Publish is intentionally delayed until R0-R1 are done and the walk is clean. Detail lives in `ENCORE-PRODUCT-ROADMAP.md`; findings in `PRODUCT-AUDIT-2026-08-31.md`.

## THE FEATURE RULE (permanent, applies to every session and model)

**No NEW feature is implemented without Kanwar's explicit approval.** Every proposal must be presented first as simple bullets:

- **Why this feature** — the problem or opportunity, one line.
- **How it helps** — the merchant outcome (revenue, time saved, risk avoided).
- **Does it make the merchant's life easier?** — yes/how, or it doesn't ship.
- **How it makes the app more robust** — reliability/trust impact, or "neutral".

Fixes to existing promised behavior (bugs, dead paths, polish) are not "new features" and proceed under normal phase discipline. This rule is also in `.claude/skills/encore-dev-discipline/`.

## Scorecard — what 10/10 means per angle

| Angle | Now | 10/10 definition | Reached at |
|---|---|---|---|
| Truthfulness (every control does what it says) | 7 → 9 after R0 | Zero write-only settings; zero dormant UI without a "coming soon" label | R0 ✓ / PCD |
| Reliability | 5 | Crons scheduled + self-monitoring; tests on money paths; zero silent failures | R0 ops + R1 |
| Simplicity | 7.5 | Install→first preorder ≤3 screens; zero jargon; every screen has an empty state that teaches | R1 |
| Feature completeness vs category | 7 | Parity: countdown, collection badges, import; + our exclusives (auto-convert, checkout-enforced caps) | R1/R3 |
| Revenue impact for the merchant | 4 | The app proactively finds money (Revenue Advisor + AI) — no competitor does this | R2 |
| International | 6 | 100% key coverage ×8 locales, Polaris locale, store-locale autodetect, currency everywhere | R1 |
| Word-of-mouth ("unforgettable") | — | Merchant sees a number the app earned them, weekly; review ask lands at that moment | R2 |

## R0 — Truth & reliability [CODE DONE 2026-08-31 — verify + deploy]

- [x] STOCK trigger wired end-to-end: config serves `preorder.trigger`; widget honors it (stock = only when variant unavailable; always = presale even in stock — this direction was ALSO broken before)
- [x] CampaignForm: "When shoppers see it" select (Always / Only when sold out); silent STOCK→MANUAL downgrade removed; DATE preserved
- [x] Settings: inert "When should preorder be available?" ChoiceList → note pointing to the per-preorder control
- [x] Mixed-cart message now rendered on storefront (was configured-but-invisible)
- [x] SMS toggle hidden until the channel is real (audit O4)
- [x] Welcome banner: dismissible + persisted, "Encore" naming, dead docs domain → in-app Get help (4 sites)
- [x] Outbox health warning on dashboard (stuck>15min or DEAD → visible banner; self-diagnosing delivery)
- [x] Currency threaded into CampaignForm (4 "USD" hardcodes gone); Plans locale fixed
- [x] Crons: in-process scheduler (`app/services/scheduler.server.ts`, started from entry.server) — outbox 2min, reminders+purge hourly, all idempotent; `ENCORE_CRON_SECRET` set on Railway (endpoints remain as manual triggers); single-platform, no external scheduler
- [ ] **Kanwar:** `npm install && npm run typecheck && npm run build` → commit → push → `shopify app deploy` → release
- [ ] Verify on dev store: stock-trigger campaign hides button while in stock, shows when sold out; always-campaign shows while in stock; mixed-cart note visible
- [ ] PHASE-R0-AUDIT.md

## R1 — Parity + polish (pre-publish) [CODE DONE 2026-08-31 — see GO-LIVE-AND-TEST-GUIDE.md]

- [x] Countdown timer block — `blocks/countdown.liquid` + campaign start/end served in config; same stock/trigger gating as the button
- [x] Collection-page preorder badges — app-embed setting + injector; `/apps/encore/badges` proxy (ALL+SPECIFIC campaigns, 60s cache; COLLECTION-mode intentionally excluded from badges v1)
- [x] Waitlist CSV import — Import CSV on Waitlist page (email + product_id/product_handle + optional variant_id, locale; 5000-row cap, dedupe, handle resolution); switching guide is in GO-LIVE-AND-TEST-GUIDE.md
- [x] Onboarding: inherits Settings default button label; empty-catalog guidance; `?welcome=1` success banner on the campaign page
- [x] Empty states: Insights (all tabs), low-stock, notifications, translations, benchmark, plans (+ dashboard cohorts card); help already taught
- [x] i18n backfill: 145 missing keys ×7 locales (0 missing verified); Polaris locale wiring ×8; store-locale autodetect (shop primaryLocale)
- [x] Cohort-name locale fix — autoCohortName now locale-aware (admin locale threaded through the form)
- [x] Vitest suite: 33 tests / 6 files — storefront match loop incl. trigger paths + countdown dates, selling-plan builder (deposit/pay-later/fallback), cap function, Flow key renames, outbox backoff, CSV parser (`npm test`)
- [ ] **Kanwar:** `npm install && npm run typecheck && npm test && npm run build` → commit → push → `shopify app deploy` → release (full walk in GO-LIVE-AND-TEST-GUIDE.md)
- [ ] Verify on dev store per GO-LIVE-AND-TEST-GUIDE.md (countdown, badges, CSV import, onboarding, locales)
- [ ] Lighthouse re-run with extension enabled; screenshots ×6 refreshed on final UI
- [ ] PHASE-R1-AUDIT.md → **submit to Shopify App Store**

## R2 — Revenue Advisor + AI ("the reason they talk about us") — post-first-installs

Every item below was proposed under THE FEATURE RULE and **APPROVED by Kanwar 2026-08-31** (all are merchant-approved suggestions — the app never self-creates live preorders):

- [ ] Revenue Advisor: low-stock scan → "enable preorder" suggestion cards — APPROVED
- [ ] Revenue Advisor: OOS-with-demand → one-click preorder prompt — APPROVED
- [ ] Revenue Advisor: best-seller presale suggestions — APPROVED
- [ ] Incoming-inventory prompt (new PO / incoming transfer while OOS → offer preorder) — APPROVED
- [ ] AI Copilot: plain-words prompt → drafted campaign with review card (proposal to come before build)
- [ ] AI copywriter: notification templates ×8 locales (proposal to come before build)
- [ ] Weekly revenue digest email + in-app ("your waitlist holds $X — approve these 2 preorders") — APPROVED
- [ ] Review ask: triggered at the moment the digest shows earned revenue — APPROVED
- [ ] PHASE-R2-AUDIT.md

## R3 — Channels, scale, moat

- [ ] SMS via merchant's Klaviyo (no carrier cost) → evaluate push/WhatsApp
- [ ] Waitlist→preorder auto-convert with priority window (category-first; feature proposal first)
- [ ] Postgres migration + real migration history + Session index; per-block JS split (<10KB)
- [ ] Built for Shopify application when metrics qualify
- [ ] Nova agency cross-store preorder dashboard (uncopyable moat)
- [ ] PHASE-R3-AUDIT.md

## Operating notes

Trigger evaluation is init-time per page load (variant-switch re-evaluation = R1 nice-to-have). The dashboard outbox banner is the app's first self-monitoring surface — extend the pattern (webhook failures, notify retries) in R1 tests week. Every phase ends: typecheck + build + deploy + walk + audit file + this checklist updated.
