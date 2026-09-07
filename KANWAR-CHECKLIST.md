# Kanwar's checklist — Encore to the App Store (2026-09-04)

Only the things that need YOU. Everything else Claude does and reports. Do them in order; each unblocks Claude's next automated step. Total hands-on time ≈ 45 minutes + waiting on Shopify.

## Today (unblocks the E2E proof) — ~5 min

- [ ] **1. Retarget the "test" campaign** — the tab is open in Chrome on the campaign edit page. Scroll to *Select product* → remove the 3 "Aurora Hoodie" rows → **Add products** → *Short Sleeve* (red, black, white) → confirm → **Save changes**. Tell Claude "done".
- [ ] **2. Push the BIS-default fix** (already on your Mac):
  ```bash
  cd ~/Documents/Claude/Projects/"Nova Apps Platform"/shopify/encore
  npm run typecheck && npm test && npm run build
  git add -A && git commit -m "BIS default on; plan + checklist" && git push
  ```
  (No `npm run deploy` needed for this one — no extension files changed.)

## This week (external gates — start now, they take time) — ~20 min hands-on

- [ ] **3. Protected Customer Data access** — Partners dashboard → your app → *API access* → *Protected customer data access* → Request: **Orders** + name/email. Reason text: "Encore records preorder orders (products, quantities, ship dates) and sends the customer preorder confirmations, ship-date changes, back-in-stock and balance-due notifications." Then tell Claude — he uncomments the three `orders/*` webhooks; you run `npm run deploy` and release.
- [ ] **4. Email sending** — resend.com → create API key → add your sending domain → add the DNS records it gives you → wait for "Verified". In Railway → encore → Variables add `RESEND_API_KEY` and `EMAIL_FROM=notify@<your-verified-domain>`. Railway redeploys automatically.
- [ ] **5. Nova decision** — reply with one of: "bring Nova up" (then deploy `confident-miracle` on Railway) or "add NOVA_DISABLED" (Claude adds the toggle; billing/pricing keep using the built-in fallbacks). Until then `/health` shows `dead` growing.
- [ ] **6. Prisma migration** (after Claude ships it): `npx prisma migrate deploy` against Railway (`DATABASE_URL` from Railway variables in your shell for that one command). Makes order capture bulletproof under duplicate webhook deliveries.

## Before submitting — ~20 min

- [ ] **7. Listing assets** — app icon 1200×1200 PNG; support email; confirm the privacy + terms URLs (`/privacy`, `/terms` on the app domain are live). Claude produces the 6 screenshots (1600×900) once the storefront E2E is green and you say which store/theme to shoot on.
- [ ] **8. Reviewer test store** — decide: use `dev-novasolutions` (password `nova`) as the demo store, or a fresh one. Give reviewers a staff login + the storefront password in the listing's test instructions.
- [ ] **9. Distribution** — Partners → app → Distribution: *Public* (App Store, review) or *Custom* (single store, no review). Public is the plan of record.
- [ ] **10. Spot-check in-frame buttons** (Claude can't click inside the embedded app): Dashboard "New preorder", campaign list bulk *Pause/Resume/End*, product picker in the wizard, Plans "Choose plan" (test charge — approve, then cancel), Settings *Save* on each tab. Report anything dead.
- [ ] **11. Submit** — after Claude posts `PHASE-R1-AUDIT.md` with all PASS.

## Standing rules you own

- Any NEW feature (R2/R3/P items) ships only after you say yes to its 4-bullet proposal (Feature Rule).
- Extensions changed → `npm run deploy` + release the version. App only → `git push` suffices.
- Never run `git` through Claude's device shell (it leaves an index.lock); you push, Claude verifies on Railway.
