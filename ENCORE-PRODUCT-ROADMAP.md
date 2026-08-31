# Encore Product Roadmap — "Simplest preorder app, run by AI" (2026-08-31)

Companion to `PRODUCT-AUDIT-2026-08-31.md`. Strategy: win on (1) reliability where incumbents earn 1-star reviews, (2) radical simplicity for non-technical owners, (3) an AI layer no competitor has, (4) flat unmetered pricing against everyone's metering. Phases are sequential; each ends with typecheck+build+deploy and a PHASE audit per `encore-dev-discipline`.

## Positioning (from verified competitor research)

- Market leaders: STOQ (3,540 rev), Notify! (3,605), Timesact (1,964), Globo (1,850). Entry is provably fast (REZ: 1,456 reviews in 15 months). **PreOrder Now WOD is delisted — 1,432-review merchant base orphaned; target them explicitly** (migration content + waitlist importer).
- Pricing lane: everyone meters preorders/revenue or takes a % cut. **Encore ships flat unmetered**: Free (evaluate, 1 live campaign) → **$19 Growth (unlimited everything)** → $49 Scale (AI features + priority support). "No per-order fees. No revenue caps. No % cut." is the headline.
- Listing copy claims to make (all true once R0 lands): no-oversell enforced at checkout (validation function — nobody else advertises one), native Shopify payments/selling plans (no draft-order hacks), customers warned before balance charges (their #1 complaint), zero theme residue (app embed), 3-step setup.

## R0 — Truth & reliability (BEFORE submission; ~1 day)

1. **Wire STOCK trigger**: match loop checks variant inventory (feed from the existing `inventory_levels/update` webhook into a cached availability read or `stockThreshold` comparison in `storefront.server.ts`); remove `CampaignForm.tsx:493`'s silent MANUAL downgrade (preserve saved triggerType); make Settings "Inventory rules" controls either functional or removed.
2. **Crons live**: set `ENCORE_CRON_SECRET` on Railway; schedule nova-outbox (2 min), balance-reminders (daily), purge-uninstalled (daily) via cron-job.org; add a dashboard reliability tile warning when outbox has PENDING > 15 min (self-diagnosing, unlike competitors' silent widgets).
3. **Dead-domain sweep**: docs links → in-app `/app/help`; support email → the real one; banner dismiss persisted; `nav.markets`/`nav.notifications` keys; app name leak "Preorder Novafied" → Encore.
4. Currency into CampaignForm (pass `getShopCurrency` down; replace 4 hardcoded "USD"); `plans.tsx` locale.
5. Hide SMS toggle + mixed-cart field OR implement mixed-cart render (~20 lines in encore.src.js — it already receives the config; prefer implement).

## R1 — Category parity (week 1-2 post-submission)

- **Countdown timer** block (campaign end/start countdown on PDP) — STOQ/Timesact/Globo all have one.
- **Collection-page preorder badges** (theme extension block for card grids) — only Globo has this; instant differentiator pair.
- **Waitlist CSV import** + guided migration ("Moving from PreOrder Now/Notify!? Import your waitlist in 2 minutes") — breaks the #9 lock-in complaint, aimed at WOD orphans. Batch under Shopify's 1,000-record constraints server-side.
- Empty states for Insights/low-stock/notifications/translations/benchmark/plans; onboarding inherits Settings defaults + empty-catalog guidance + success toast consuming `?welcome=1`.
- i18n backfill (220 keys) + Polaris locale + store-locale auto-detect (Session.locale exists).
- Vitest smoke suite (payload schema, selling-plan math, cap function input, storefront match loop incl. new STOCK path).

## R2 — The AI layer ("Encore Copilot") — category first, weeks 3-6

No competitor has meaningful AI (Notify!'s is advisory-only). Positioning: **"The preorder app that runs itself."** All server-side LLM calls from the Railway backend; feature-flagged; Scale-plan gating.

1. **Copilot setup (flagship)**: a prompt box on the dashboard — "Preorder my summer drop from June 1, 30% deposit, ship late July, cap 200 units" → structured JSON → existing `createCampaign`. Show a review card (never silent-create). This collapses the entire rule form for non-technical owners and is the demo that sells the app.
2. **Autopilot drafts**: nightly job — when a variant hits 0 with waitlist demand ≥ N, AI drafts a campaign (price/deposit/ship-date suggested from history) → merchant gets a one-click "Approve" card + email. Your managed-service instinct, productized.
3. **AI copywriter**: generate/refine notification templates in the merchant's tone, all 8 locales at once (plugs into the existing per-locale template system).
4. **Weekly digest email**: plain-English — "Your waitlist holds ~$4,300 in recoverable demand on 3 products; Encore suggests preorders on 2. Ship-date risk: 'Vellow Tote' promises July 15 but supplier lead time trends 24 days." Uses benchmark + demand data already collected.
5. **Ship-date risk advisor** (v2): flag campaigns whose promised dates look unrealistic vs restock history — prevents the category's #1 harm (angry customers at balance-charge time).

## R3 — Channels & scale (post-first-100-installs)

SMS via merchant's Klaviyo (no Twilio cost to us) → then push/WhatsApp evaluation (Notify! parity); **waitlist→preorder auto-convert** (unclaimed in the market: restock detected → waitlist automatically offered the preorder with priority window); Postgres migration + real migrations history + Session index; per-block storefront JS split (drops under the 10KB threshold properly); Built for Shopify application once review count + performance metrics qualify.

## Agency/managed angle (Nova synergy — unique, nobody can copy)

Encore installs attribute to agencies via `/install?ref=` already. Later: Nova agency dashboard gets a cross-store preorder overview (campaigns, revenue, alerts per client store) — the "I manage preorders for my clients" product no app-store competitor can structurally offer. Sequence after platform N-phases; needs only Nova-side reads of data Encore already forwards.

## KPIs

Submission approved → first 10 installs (WOD-orphan content + referral links) → review solicitation in-app after first successful campaign (target 4.9+; leaders hold 97-98% five-star) → 100 installs → Built for Shopify → Copilot launch announcement as the category's first AI preorder manager.
