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

## Phase map (updated 2026-09-04)

| Phase | Goal | Gate to exit | Est. effort |
|---|---|---|---|
| R0 Truth & reliability | ✅ done, verified live | — | — |
| R1 Parity + polish | ✅ code done, verified live | — | — |
| **R1.5 Submission** | App on the App Store | Reviewer-grade E2E proof + external gates | 2–3 days (mostly waiting on PCD/assets) |
| R2 Revenue Advisor + AI | "The app finds money for me" | 3 advisor cards live on ≥1 real store, digest sent weekly | 3–4 weeks |
| R3 Channels, scale, moat | Category exclusives + BFS | Auto-convert live, BFS application filed | 3–4 weeks |
| P Platform factory | 50 apps at Encore quality | New app scaffold → E2E-green in CI in < 1 day | 2–3 weeks, parallel to R2 |

Ordering rule: **R1.5 first, then P (registry + release gates + test-mode token) BEFORE R2** — R2 features need real order data (PCD) and every R2 item is verified 10× faster once the test-mode token exists.

## R0 — Truth & reliability [DONE — verified live 2026-09-01/04]

- [x] STOCK/always trigger truth end-to-end; "When shoppers see it" control; inert Settings ChoiceList replaced
- [x] Mixed-cart message rendered on storefront; SMS toggle hidden until real
- [x] Welcome banner truthful + dismissible; outbox health banner; currency threaded
- [x] Built-in scheduler (verified `[scheduler] started` + 2-min ticks in Railway logs)
- [x] `/health` endpoint (db + scheduler heartbeat + outbox counts) — live 2026-09-04

## R1 — Parity + polish [DONE — verified live 2026-09-04]

- [x] Countdown block; collection badges + `/apps/encore/badges`; waitlist CSV import; onboarding polish; empty states; i18n backfill ×7 locales + Polaris locale; cohort-name locale; vitest 34 tests
- [x] QA MEDIUM pass: shared statusToTone, Intl relativeTime, Polaris confirm modals, Polaris tokens, a11y, benchmark copy, honest translation count
- [x] **Universal app embed** — button/notify/low-stock auto-mount on any theme (verified on Debut)
- [x] Webhook hardening — side-effect gating on redelivery, concurrent notify paths, ack timing; delivery verified 200
- [x] Cap-function input query rename (typecheck clean)

## R1.5 — Submission [IN PROGRESS] — see KANWAR-CHECKLIST.md for the owner view

Each line: owner · acceptance check.

1. [ ] Kanwar · Retarget "test" campaign to Short Sleeve (3 variants) + Save · `fetch('/apps/encore/config?product_id=8021084340386')` returns `preorder.active: true`
2. [ ] Kanwar · `git push` the BIS-default fix (`storefront.server.ts`) · config returns `backInStock.enabled: true` with no saved settings
3. [ ] Claude · Storefront E2E in Chrome: button + badge on PDP, collection badge, add-to-cart carries `properties[_preorder]` + ship date + selling plan, mixed cart with Echo Bag shows the notice, checkout reached (stop before pay) · screenshots + cart JSON in `PHASE-R1-AUDIT.md`
4. [ ] Claude · Admin render-walk of every route by URL + all nav links · table in the audit; in-frame buttons listed for Kanwar's spot-check
5. [ ] Kanwar · Request Protected Customer Data access in Partners (orders; name/email; reason: preorder tracking + notifications) · approval email / status "Approved"
6. [ ] Claude (on Kanwar's word) · Uncomment `orders/create|paid|cancelled` in `shopify.app.toml` · Kanwar runs `npm run deploy`; a test order produces `POST /webhooks/orders/create 200` and a PreOrder row
7. [ ] Kanwar · `RESEND_API_KEY` + verified `EMAIL_FROM` on Railway · a notify-me signup + restock produces a real email
8. [ ] Claude · Remove diagnostics (`client-log` route, ClientErrorReporter probe, dispatch beacons) · grep shows zero `sendBeacon`; gates green
9. [ ] Claude · DB unique index `PreOrder(shop, shopifyOrderId, orderRef)` migration · Kanwar runs `npx prisma migrate deploy`; redelivered order creates 0 new rows
10. [ ] Kanwar · Nova decision: bring Nova up OR approve `NOVA_DISABLED=1` · outbox `dead` stops growing on `/health`
11. [ ] Both · Listing assets: icon 1200², 6 screenshots, demo store + reviewer creds, support email, privacy/terms URLs · LISTING-KIT.md assets checklist all ticked
12. [ ] Claude · `PHASE-R1-AUDIT.md` (checks, evidence, PASS/FAIL) + Lighthouse with extension enabled
13. [ ] Kanwar · Partners → Distribution (Custom vs Public) → submit

## P — Platform factory [NEXT after R1.5; runs parallel to R2]

1. [ ] App registry generator: script walks an app → `platform/registry/<app>.yaml` (routes, services, models, webhooks, scopes, extensions, env vars, platform contracts) · Encore YAML produced with zero hand edits
2. [ ] Knowledge graph artifact rendered from the registry (nodes/edges, click-through to files) · answers "which apps need PCD?" from data
3. [ ] Release gate script (`npm run gate`): toml-vs-routes parity, docs-vs-routes truth check, generated-files policy, extension version stamped into `/health` · fails on the three real drifts we hit this week
4. [ ] Test-mode session token (HMAC, `ENCORE_TEST_MODE=1` only, dev stores only) so Playwright drives the embedded admin outside the iframe · Playwright suite: create campaign → save → config shows it, green in CI
5. [ ] Shared packages: `settings-defaults` (one source for UI + server), `ui-kit` (statusToTone, relativeTime, ConfirmModal, tokens), `outbox` with reachability circuit breaker · Encore consumes all three with zero behavior change
6. [ ] New-app scaffold from the Encore skeleton + the three saved skills baked into `.claude/skills` · scaffold → gate green → E2E green in < 1 day

## R2 — Revenue Advisor + AI [APPROVED items only; each proposal card before code]

Prereqs: R1.5 #5–6 (real order data), P #4 (fast verification).

1. [ ] Advisor data layer: nightly scan per shop → `AdvisorSuggestion` rows (type, product/variant, evidence numbers, estimated revenue, dismissedAt) · idempotent re-scan; unit tests on the 3 detectors
2. [ ] Card: low-stock → "enable preorder" (uses low-stock scan + sell-through) · one-click creates a DRAFT campaign with the review card, never live silently
3. [ ] Card: OOS-with-waitlist-demand → one-click preorder (waitlist count × price = evidence) · same review-card flow
4. [ ] Card: best-seller presale suggestion (30-day velocity, in stock, no campaign) · same flow
5. [ ] Incoming-inventory prompt (PO / transfer detected while OOS) → offer preorder · requires `inventory_levels/update` + purchase-order read; proposal first if a new scope is needed
6. [ ] Weekly digest (in-app card + email via Resend): "your waitlist holds $X; approve these N" · dedupe per week; unsubscribe link; i18n ×8
7. [ ] Review ask triggered when the digest shows earned revenue ≥ threshold · once per shop, App Bridge review API
8. [ ] AI Copilot (proposal first): prompt → structured campaign JSON → review card → `createCampaign` · never silent-create; evals on 20 prompts
9. [ ] AI copywriter (proposal first): notification templates ×8 locales from brand voice · merchant edits before save
10. [ ] `PHASE-R2-AUDIT.md`

## R3 — Channels, scale, moat

1. [ ] SMS via merchant's Klaviyo (no carrier cost) → evaluate push/WhatsApp
2. [ ] Waitlist→preorder auto-convert with priority window (proposal first) — the unclaimed category exclusive
3. [ ] Per-block storefront JS split (<10KB per block); Postgres migration history; Session index
4. [ ] Built for Shopify application when metrics qualify
5. [ ] Nova agency cross-store preorder dashboard
6. [ ] `PHASE-R3-AUDIT.md`

## Operating notes

Trigger evaluation is init-time per page load (variant-switch re-evaluation = R1 nice-to-have). The dashboard outbox banner is the app's first self-monitoring surface — extend the pattern (webhook failures, notify retries) in R1 tests week. Every phase ends: typecheck + build + deploy + walk + audit file + this checklist updated.
