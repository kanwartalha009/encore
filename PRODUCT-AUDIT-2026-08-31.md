# Encore Product Audit — 2026-08-31 (post-release)

**Scope:** app completeness end-to-end, competitive position (11 competitor listings + review mining, fetched today), AI opportunity. Fresh code sweep with citations; competitor numbers only from pages read. Companion roadmap: `ENCORE-PRODUCT-ROADMAP.md`.

## 1. Verdict

Encore's architecture beats most of the category: Shopify-native selling plans (deposit/pay-later with native balance capture), a real checkout validation function for no-oversell, Markets-aware rules, Flow + Klaviyo, durable outbox, GDPR done properly. But the sweep found **one P0 functional hole sitting on the reviewer's scripted path**, three silent-failure operational gaps, and a set of polish items that separate a 4.5-star app from a 5.0 Built-for-Shopify one. None require architecture changes.

## 2. P0 — "Preorder when out of stock" is a no-op

`triggerType`/`stockThreshold` are persisted but **never read by any runtime path** — the storefront match loop (`storefront.server.ts:181-216`) gates only on dates, markets and product mode; zero inventory references in `capacity.server.ts` or the proxy. Yet three merchant surfaces promise it: onboarding step 2 ("Switch to preorder only when stock hits 0", `app.onboarding.tsx:142`), Settings → Inventory rules (`app.settings.tsx:449-452`), and CampaignForm, which **silently downgrades STOCK→MANUAL on every edit** (`CampaignForm.tsx:493` hardcodes it). LISTING-KIT's reviewer instructions literally say *choose "Preorder when out of stock."* Merchant impact: button shows on in-stock products; the app's core promise for the restock use case is inert. Four adjacent Settings controls (`availabilityRule`, `autoStopAtZero`, `autoManageContinueSelling`, `reserveMode`) are also write-only.

## 3. Silent-failure operational gaps

| # | Gap | Consequence | Evidence |
|---|---|---|---|
| O1 | **3 crons unscheduled + `ENCORE_CRON_SECRET` unset → 401 forever, no log** | Outbox (1-2 min): Nova billing desyncs AND **every support ticket silently never arrives**; balance-reminders (daily): customers auto-charged with no warning — the #1 complaint against Timesact/STOQ in reviews; purge (daily): GDPR 48h promise broken | cron.*.tsx guards |
| O2 | **Dead domain in-app**: `docs.preordernovafied.app` + `support@preordernovafied.app` — no DNS record | Dead docs/support links on the dashboard = routine App Store rejection | app._index.tsx:431; settings:1060,1064; campaigns empty state |
| O3 | **Welcome banner undismissable** (`onDismiss` no-op, no first-run condition) | Every merchant sees "Welcome" forever; X does nothing | app._index.tsx:421-435 |
| O4 | **SMS collected, never sent** (phone stored, no provider; Settings offers the toggle) and **mixed-cart warning configured, never rendered** (storefront JS ignores `mixedCartMessage`) | Collecting PII you never use; merchants write warnings no shopper sees | proxy.notify.tsx:45; grep sms/mixedCart in extensions → 0 |
| O5 | Prisma is `provider="sqlite"` while DEPLOY-CHECKLIST says Postgres; single template migration, everything else `db push`; Session table unindexed | Volume-backed today (encore-volume), but no rollback history, single-writer ceiling, full-table scans in crons | schema.prisma:11; prisma/migrations |

## 4. Polish debt (reviewer-visible)

i18n coverage **66.5%** — 220 of 659 used keys missing (fall back to English), 2 keys render as raw `nav.markets`/`nav.notifications` literals in Settings; Polaris chrome locked to English; store locale never auto-detected. Currency: CampaignForm hardcodes "USD" in 4 places and never receives shop currency; `plans.tsx:60` hardcodes `en-US` locale; cohort names always English. Empty states missing on 7 of 19 pages including the entire Insights hub (nav item 4 shows zeros with no guidance on a fresh store). Onboarding wizard ignores store defaults (`loader → null`), dead-ends on an empty catalog, and its `?welcome=1` is never consumed. Tests: 0. Old app name "Preorder Novafied" leaks at app._index.tsx:397.

## 5. Competitive position (Aug 2026, verified listings)

Leaders: STOQ 3,540 reviews/5.0, Notify! 3,605/4.9, Timesact 1,964/5.0, Globo 1,850/4.9 — all Built for Shopify. Two 2024-25 newcomers prove fast entry is possible (REZ 1,456 reviews in 15 months; Essent 1,218). **PreOrder Now WOD (1,432 reviews) is delisted — its merchant base is orphaned and searching right now.** Feature-matrix gaps Encore already covers: native selling plans (only Globo/Timesact comparable), hard no-oversell via checkout function (nobody advertises one), Markets, Flow depth. Category features Encore **lacks**: countdown timers (STOQ/Timesact/Globo all have), collection-page badges (Globo), SMS/WhatsApp/push BIS channels (Notify! has 4 channels), waitlist CSV *import*. Unclaimed by anyone: **waitlist→preorder auto-convert**. Pricing: the ladder is $5-10 entry / $19-29 unlimited; merchants' loudest pricing hatred is metering (Wolf's revenue caps, PreProduct's 5%, Notify!'s 3% txn fee) — **flat unmetered is an open lane**. Top merchant complaints across 1-2 star reviews: silent balance auto-charging, widgets randomly disappearing, overselling, theme breakage/residue, hidden fees, slow support, rigid config, migration lock-in (Shopify's 1,000-record import cap). Encore's balance-reminder cron, validation function, app-embed architecture and per-variant rules answer complaints 1-4 and 7 *by design* — they must actually be turned on (O1) and claimed in listing copy.

## 6. AI: the open field

Only Notify! ships any AI (advisory "Restock AI"/"PreOrder AI" recommendations). No competitor has AI setup, AI copy, forecasting, or automation. For Kanwar's positioning — *store owners are too technical-averse to manage preorders* — AI is not decoration, it is the product: the roadmap defines an **AI Copilot** (describe the drop in plain words → campaign created), **Autopilot** (stockout + waitlist demand detected → ready-to-approve campaign drafted), **AI copywriter** (on-brand notifications in 8 languages), and **weekly plain-English digest**. Detail, sequencing and implementation notes: `ENCORE-PRODUCT-ROADMAP.md`.

## 7. Ranked actions

1. **Wire the STOCK trigger** (inventory check in the match loop + stop CampaignForm's silent downgrade) — or strip the three affordances before any reviewer sees them. Blocks honest submission of the scripted test path.
2. **Set `ENCORE_CRON_SECRET` + schedule the 3 crons today** — support tickets and balance warnings are currently a black hole (this would have failed your E2E walk at the ticket step).
3. Replace `preordernovafied.app` links with the Railway domain docs/help route + real support email; fix the banner dismiss; add the 2 missing nav keys.
4. Thread currency into CampaignForm; Insights + remaining empty states; onboarding inheritance + welcome toast.
5. Hide SMS + mixed-cart controls until implemented (or implement — mixed-cart render is ~20 lines in encore.src.js).
6. Then the roadmap: countdown timer + collection badges (parity), waitlist import (lock-in breaker aimed at WOD orphans), auto-convert (unclaimed), AI Copilot (category first).

**Bottom line:** the foundation out-engineers the incumbents; what stands between Encore and "better than any preorder app" is one dead feature path, three unscheduled crons, listing-visible polish — and then the AI layer nobody else has.
