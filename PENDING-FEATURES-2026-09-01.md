# Encore — Readiness & pending work (updated 2026-09-04)

**Readiness verdict:** engineering ≈ 90% complete; **publish-readiness ≈ 75%** — the remaining 25% is almost entirely external gates and one data fix, not code.

Verified live on 2026-09-04: deploy `/health` green (db ok, scheduler ticking, outbox 0 pending), universal app embed released AND toggled on (shells auto-mounted next to add-to-cart on Debut), webhooks delivering 200 (`inventory_levels/update`, `products/update`), QA-polish pass live, cap-function typecheck fixed, Echo Bag published for mixed-cart testing.

---

## A. Blocking for App Store submission

| # | Item | Owner | Why it blocks |
|---|---|---|---|
| 1 | **Retarget the "test" campaign to Short Sleeve + Save** (edit page is open in Chrome: remove 3 Aurora rows → Add products → Short Sleeve → Save) | Kanwar (60 s) | Only live campaign targets a fake product → storefront button/badge can't show; nothing E2E-provable until this |
| 2 | **Storefront E2E proof** after #1: button + badge, collection badge, add-to-cart with preorder properties + selling plan, mixed cart (Echo Bag) + notice, checkout reach | Claude (automated, ~20 min) | Reviewer will test exactly this |
| 3 | **Protected Customer Data approval** in Partners → API access (orders + name/email) then uncomment `orders/create`, `orders/paid`, `orders/cancelled` in `shopify.app.toml` + `npm run deploy` | Kanwar requests; Claude uncomments on your word | Until then no order ever reaches the app — preorders can't be recorded on merchant stores |
| 4 | **`RESEND_API_KEY` + verified `EMAIL_FROM`** on Railway | Kanwar | Back-in-stock alerts, ship-date changes, balance reminders all queue silently without it |
| 5 | Push + deploy `storefront.server.ts` (BIS default ON — on your Mac, not yet pushed) | Kanwar (`git push`) | Notify-me otherwise needs a manual settings save on every install |
| 6 | Remove diagnostics (`/client-log` route, ClientErrorReporter probe, dispatch beacons) | Claude | Review hygiene; must not ship to merchants |
| 7 | Listing assets: 1200×1200 icon, 6 screenshots on final UI, demo store + reviewer credentials, support email | Both | Required listing fields (LISTING-KIT.md §Assets) |
| 8 | Distribution choice in Partners (Custom vs Public) + submit; PHASE-R1-AUDIT.md | Kanwar / Claude | The act of publishing |

## B. Decide before or right after submission

| # | Item | Owner |
|---|---|---|
| 9 | Nova platform: bring it up, or approve `NOVA_DISABLED=1` toggle (11 outbox rows are DEAD from Nova being offline; billing/pricing run on hardcoded fallbacks today) | Kanwar decision |
| 10 | Add a DB unique index on `PreOrder(shop, shopifyOrderId, orderRef)` — makes order-capture idempotency bulletproof under concurrent redelivery (needs a migration run against Railway Postgres) | Claude writes, Kanwar runs migrate |
| 11 | Admin in-frame click verification (bulk actions, pickers, tabs) — every page renders and all nav links work; in-frame buttons can only be human-clicked until the platform test-mode token exists | Kanwar spot-check or platform item 16 |

## C. Polish (post-submission fine)

- "Cohort ID" row shows raw database id on the campaign Settings tab (kept for support; rename/hide on your word)
- Campaign-form preview shows a sample product name instead of the selected product's title
- Low-stock preview severity colours are literal hex (mimics storefront; harmless)
- Countdown timer is block-only (not auto-placed by the universal embed)

---

## D. Feature backlog (approved in ENCORE-10X-PLAN, NOT yet built — each still gated by the Feature Rule)

**R2 — Revenue Advisor + AI** (post-first-installs)
1. Revenue Advisor: low-stock scan → "enable preorder" suggestion cards — APPROVED
2. Revenue Advisor: OOS-with-demand → one-click preorder prompt — APPROVED
3. Revenue Advisor: best-seller presale suggestions — APPROVED
4. Incoming-inventory prompt (PO/transfer while OOS → offer preorder) — APPROVED
5. Weekly revenue digest, email + in-app — APPROVED
6. Review ask when the digest shows earned revenue — APPROVED
7. AI Copilot: plain-words prompt → drafted campaign with review card — proposal first
8. AI copywriter: notification templates ×8 locales — proposal first

**R3 — Channels, scale, moat**
9. SMS via the merchant's Klaviyo; evaluate push/WhatsApp
10. Waitlist→preorder auto-convert with priority window — proposal first
11. Per-block storefront JS split (<10KB) + Postgres migration history + Session index
12. Built for Shopify application once metrics qualify
13. Nova agency cross-store preorder dashboard

**Platform items that make the next 49 apps cheap (from the 2026-09-04 anomaly list)**
14. Code-generated app registry + knowledge graph (Encore as first node)
15. Release gate script: toml-vs-routes parity, docs-vs-routes truth check, extension version in `/health`
16. Test-mode session token so Playwright can drive embedded admins in CI (would have made this E2E a 10-minute job)
17. Shared packages: settings-defaults (one source for UI + server), UI kit (statusToTone/relativeTime/tokens), outbox circuit breaker
