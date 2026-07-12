# OPUS EXECUTION ORDER — Finish Encore to App Store Submission (2026-07-12)

**Audience:** the Claude (Opus) session working in `shopify/encore` on Kanwar's Mac.
**This doc is the execution order.** It sequences everything left, with the 2026-07-12 audit findings baked in. Detailed phase specs remain in `OPUS-HANDOVER-ENCORE.md`; findings and evidence in `AUDIT-SUBMISSION-READINESS-2026-07-12.md`. Invoke the `encore-dev-discipline` skill first, work strictly phase-wise, and run `npm run typecheck` AND `npm run build` before calling anything done.

**State when written:** E0 partial (PCD + support email pending — Kanwar), E1 done in code but uncommitted and unverified by a prod build; E2/E3/E4 not started. One P0 bug (F0.3).

---

## Phase F0 — Secure & repair (do first, same day)

| # | Task | Acceptance check |
|---|---|---|
| F0.1 | Commit the E1 working tree (33 files: 21 modified + 12 untracked) in logical commits (E0 docs / E1 nav+insights / onboarding / settings / help / e2e-audit fixes). Push to `kanwartalha009/encore` main. | `git status` clean; `git log origin/main..` empty |
| F0.2 | `npm run typecheck && npm run build` — the prod build is the `.server`-trap gate E1 never ran. Fix anything it surfaces using the `app/lib/*-shared.ts` pattern. | Both exit 0 |
| F0.3 | **Fix A1 (P0):** in `app/lib/nova.server.ts` (~:161-169) the support payload must match the platform's `internalTicketSchema` (`packages/shared/src/schemas/support.ts:9-15`): rename `shopDomain`→`shop`, `message`→`body`, and OMIT `email` when null (never send `email: null`). Keep `appSlug`. Also purge any DEAD outbox rows created by the old payload. | Manual test: submit Get-help against local platform API → ticket row created; outbox row SENT |
| F0.4 | **Fix A4:** implement the real "inherit store defaults" mechanism in `CampaignForm.tsx` — payment/cart/discount/CTA groups read defaults from AppSettings, each group collapsed under "Override for this preorder"; `buildFormData` (~:450-471) only writes overridden values. If you judge this too risky pre-submission, STOP and ask Kanwar to choose (implement vs amend the E1 audit claim + defer). Do not silently defer. | New rule with no overrides renders storefront using Settings values; changing a Setting changes non-overridden live rules' behavior (or Kanwar's explicit deferral recorded) |
| F0.5 | Fix A6 (Insights currency: use the shop's currency from settings/shop query, not hardcoded USD) and A7 (nav keys → `nav.insights`/`nav.plans` with catalog entries ×7 locales; sweep residual "I-1…I-10" refs in CHANGE-CONTROL/DELIVERY-PLAN). | grep shows no `"en-US"…USD` in insights; no raw-literal nav keys |
| F0.6 | Phase audit `PHASE-F0-AUDIT.md`; tick MASTER-PLAN items; commit + push. | Audit PASS |

**Kanwar's parallel actions (remind him at F0 close, do not do for him):** file the PCD request (Partner org 1710157; justification: order tagging of preorders, deposit/balance collection, waitlist→purchase conversion measurement), confirm the support email for `LISTING-KIT.md:13`.

## Phase E2 — Approval readiness (per OPUS-HANDOVER-ENCORE.md §E2, with these audit additions)

1. Per-env config: production `application_url` + redirect + app-proxy in `shopify.app.toml`, plus the 2 Flow extension `runtime_url`s and customer-account `APP_URL` (DEPLOY-CHECKLIST.md table rows 1-5). Keep dev config working (`shopify app config link` envs).
2. Fix the tsc baseline properly: npm `overrides` dedupe of `@shopify/shopify-api`; remove `as any` on PrismaSessionStorage.
3. Error boundaries on all routes; empty states on every reviewer-reachable screen.
4. **Privacy policy + Terms pages — platform repo task:** create `apps/web/src/app/privacy/page.tsx` + `terms/page.tsx` in the platform repo (repo root, separate commit/push there; they do not exist — verified). Put the deployed URLs into `LISTING-KIT.md`.
5. First tests (wire `npm test`, vitest): billing plan math, campaign visibility resolution, cap-function input building, outbox retry/backoff, and a support-payload schema test pinned to `internalTicketSchema` (regression guard for F0.3).
6. Lighthouse run on a dev store with the theme extension enabled — record scores before/after enable; must be within 10 points.
7. Listing assets: 1200x1200 icon, 3-6 screenshots at 1600x900 of the post-E1 UI (dashboard, wizard, rule form, insights, storefront button), demo store set up with seeded preorders, reviewer credentials + refreshed test instructions in LISTING-KIT.md.
8. `shopify app deploy` (extensions) succeeds with zero URL warnings. Phase audit → PASS.

## Phase E3 — Deploy + the single E2E test (coordinate with platform N2)

Follow OPUS-HANDOVER-ENCORE.md §E3 and `DEPLOY-CHECKLIST.md` literally: Railway Docker service + `/data` volume (+ nightly backup), env per `../../docs/deploy/DEPLOY-05-encore.md`, shared HMAC secrets identical to the platform deployment (they were rotated in platform N0 — get current values from Kanwar's secret manager, never from `scripts/.env.secrets`), crons scheduled (nova-outbox 1-2 min, purge, balance reminders), Partner app URLs → Railway domain, `npm run setup`, `shopify app deploy`.

Then run **the single full test** and record evidence in PILOT-RUNBOOK: fresh dev store → referral install `/install?ref=nova&shop=…` → onboarding wizard → preorder placed (deposit mode) → test subscription charge → Nova admin shows Store attributed to agency `nova` + exactly 1 Charge + 1 PENDING Commission → **submit a Get-help ticket and verify it appears in Nova admin support** (proves F0.3) → GDPR `shop/redact` test → uninstall → accrual stops. Theme-compat on 2-3 popular themes. When Kanwar confirms PCD approval: uncomment `orders/*` in toml, redeploy, verify order tagging + conversion stamp. Phase audit → PASS.

## Phase E4 — Submit

Final `shopify app deploy`; complete the Partner-dashboard listing from LISTING-KIT.md; submit. Own the review loop: same-day responses, every reviewer request + fix commit logged in `REVIEW-LOG.md`. Post-approval: verify one real production charge, then the ≥10 cold-install pilot.

## Standing rules

No feature loss ever; merchant-simple language; i18n ×7 for every new string; Nova calls only via the outbox; GDPR/billing paths frozen; never claim external gates (PCD, review, domain) done — Kanwar confirms those; end every session with VERIFIED vs ASSUMED lists and updated checkboxes.
