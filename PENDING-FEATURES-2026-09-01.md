# Encore — Pending work & feature backlog (2026-09-01)

Two different lists, kept separate on purpose: **(A) what stands between today and "app 100% / submitted"** (all fixes, no new features), and **(B) approved-but-unbuilt features** (each still gated by the Feature Rule — nothing here gets built without your go).

---

## A. Path to 100% — remaining steps (fixes/ops, not features)

| # | Item | Owner | Status |
|---|---|---|---|
| 1 | **Verify Save/CRUD with a real click.** All evidence says the app is fine and my browser extension simply can't click inside the embedded frame (no overlay exists, App Bridge healthy, zero client errors ever beaconed, previously-working clicks also dead now). Needs ONE human click on "Save changes" on the edit page — or enable Computer Use so I do it with real mouse input. | You (10 sec) or me via Computer Use | ⏳ blocking |
| 2 | Retarget the "test" campaign to a real product (Short Sleeve T-Shirt) so the storefront has something to show. Blocked by #1. | Me | ⏳ |
| 3 | Push today's QA-polish pass (17 files already written to your Mac) → Railway auto-deploys. | You (`git push`) | ⏳ |
| 4 | Theme editor one-time setup: app embed ON + collection-badges toggle + Preorder button / Countdown / Notify-me blocks on the product template (GO-LIVE guide §4). | Me (browser) after #1–3 | ⏳ |
| 5 | Full storefront E2E: preorder button, add-to-cart with properties + selling plan, cart, checkout reach, countdown, badges, notify-me — matched against LISTING-KIT claims. | Me | ⏳ |
| 6 | Remove the diagnostic beacons (`/client-log` route, ClientErrorReporter probe, dispatch tracing) once #1–5 pass. | Me | ⏳ |
| 7 | `RESEND_API_KEY` + verified `EMAIL_FROM` domain on Railway — customer emails are queued, not sent, until this exists. | You | ⏳ |
| 8 | Nova platform decision: outbox events (support tickets, billing sync) queue until Nova is deployed. Options: bring Nova up, or I add a `NOVA_DISABLED=1` toggle (awaiting your yes/no). | You | ⏳ decision |
| 9 | Listing assets: app icon, 6 screenshots on final UI, demo store + reviewer credentials, Lighthouse re-run. | Both | ⏳ |
| 10 | Submission: Partners → Distribution (custom vs public), PHASE-R1-AUDIT.md, submit. | You confirm externals | ⏳ |

### Small polish leftovers (post-submission fine)
- "Cohort ID" row on campaign Settings tab still shows the raw database ID (kept for support; can hide or rename on your word — removing data is change-control).
- Low-stock preview severity colours are literal hex (they mimic the storefront widget; harmless but noted).
- Campaign-form storefront preview uses a sample product name ("Aurora Hoodie") instead of your selected product's real title.
- QA item "checklist state is colour-only": could not reproduce in current code — every status indicator I found pairs colour with text or an icon. Treating as already fixed unless you spot one.

---

## B. Feature backlog (approved in ENCORE-10X-PLAN, not yet built)

**R2 — Revenue Advisor + AI** (post-first-installs; "the reason they talk about us")
1. Revenue Advisor: low-stock scan → "enable preorder" suggestion cards — APPROVED
2. Revenue Advisor: out-of-stock-with-demand → one-click preorder prompt — APPROVED
3. Revenue Advisor: best-seller presale suggestions — APPROVED
4. Incoming-inventory prompt (new PO/transfer while OOS → offer preorder) — APPROVED
5. Weekly revenue digest, email + in-app ("your waitlist holds $X — approve these 2 preorders") — APPROVED
6. Review ask triggered when the digest shows earned revenue — APPROVED
7. AI Copilot: plain-words prompt → drafted campaign with review card — needs proposal first
8. AI copywriter: notification templates ×8 locales — needs proposal first

**R3 — Channels, scale, moat**
9. SMS via the merchant's Klaviyo (no carrier cost); then evaluate push/WhatsApp
10. Waitlist→preorder auto-convert with priority window — feature proposal first
11. Per-block storefront JS split (<10KB per block) + Postgres migration history + Session index
12. Built for Shopify application once metrics qualify
13. Nova agency cross-store preorder dashboard

**Deferred platform work**
14. Nova platform bring-up (billing/pricing live from Nova, support tickets, referrals) — currently the app runs on its hardcoded fallbacks, by design.

---

*Everything in section B is frozen behind the Feature Rule: before any item is built you get the why / how-it-helps / merchant-simpler / robustness bullets and say yes or no.*
