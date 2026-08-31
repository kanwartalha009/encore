# Dev-store test walk — findings (2026-08-31, run by Claude in your Chrome)

Store: dev-novasolutions · App: Encore (encore-12) · Live theme: **Debut 17.1.0** (old) · Draft: Horizon

## What I verified WORKING on the live deployment

- App loads and every nav page renders: Dashboard, Preorders, Back in stock, Insights, Settings, Plans, plus /app/onboarding and /app/help by URL. No broken links found in the app nav.
- **R0 trigger control is live**: campaign form → Advanced → Button → "When shoppers see it" (Always / Only when sold out) with correct help text.
- **New build is deployed on Railway**: `/apps/encore/config` returns the new JSON (HMAC-validated through the app proxy), and **`/apps/encore/badges` works end-to-end** — returned `{"label":"Preorder","handles":[]}` (empty because the only LIVE campaign doesn't target a published product — see below).
- Welcome banner (R0) correct: "Welcome to Encore", dismissible, Get help works.
- Outbox health banner (R0) works — it correctly flagged 3 pending deliveries.
- Waitlist page: **Import CSV** button present, Export disabled at 0 subscribers, teaching empty state.
- Insights: teaching empty state on tabs (agent-B work live).
- Settings: language section (i18n ×8) + sectioned nav render correctly.
- Currency: PKR (Rs) everywhere I looked — dashboard, campaigns table, product picker.
- Privacy + Terms pages live on the Railway domain.
- Campaign form's product picker (Add products) opens and lists real catalog with variants.

## BUGS found (and already FIXED in this pass — redeploy to pick up)

1. **Onboarding "Choose products" does nothing** (4 attempts; the same picker works on the full campaign form). Root cause not reproducible from outside the iframe; fix shipped: try/catch + visible warning banner + "Open the full preorder form" fallback action, so the wizard can never dead-end. → `app/routes/app.onboarding.tsx`
2. **"Welcome to Preorder Novafied"** (old app name) in the dashboard Recent-activity feed. Fixed → "Welcome to Encore". → `app/routes/app._index.tsx`, `app/lib/i18n.tsx`
3. **Merchant-facing banner referenced an internal doc** ("see DEPLOY-CHECKLIST"). Rewritten in merchant language ("We're retrying automatically — contact support from Get help if it doesn't clear"). → `app/routes/app._index.tsx`
4. **Fake KPI deltas**: dashboard showed hardcoded "+18.4%" and "+312" even with zero sales, and "GMV (this month)" actually summed all-time. Now computes real 30-day vs previous-30-day numbers ("—" when there's no history). → `app/models/dashboard.server.ts`
5. **Fake "High-intent (24h) ~12%" card** on the Waitlist page (invented heuristic). Replaced with a truthful card: products with waitlists + newest signup date. → `app/routes/app.waitlist.tsx`

All five fixes: typecheck baseline-clean, prod build green, 33/33 tests green. Files are on your Mac — commit, push, done.

## Environment gaps (your side — why storefront features can't show yet)

1. **The only LIVE campaign ("test") targets a product that isn't live on the storefront.** The store's catalog has exactly 1 published product (Short Sleeve, sold out, Rs.100) and it has no campaign — so no preorder button/badge can appear anywhere. Fix: create a campaign on **Short Sleeve** (it's sold-out — perfect for the "Only when sold out" test) and publish another in-stock product for the "Always/presale" + countdown test.
2. **No Encore blocks in the live theme.** Debut 17 (2021-era) is the published theme and shows no app-block slots on the product section. Recommend: **publish or preview the Horizon draft theme** (or install Dawn), then add the Encore blocks per guide §3.1. All storefront tests (button, countdown, badges, notify-me) need this.
3. **Extension version**: I couldn't confirm `npm run deploy` ran after R1. If the theme editor's block picker doesn't show "Preorder countdown", run `npm run deploy` + release, then re-open the editor.
4. **Outbox has 3 pending deliveries** (support requests, billing sync). The built-in scheduler retries every 2 min after you redeploy — but if the Nova platform backend isn't running, they'll keep failing and the banner stays. Not an Encore bug; it's the delivery target being down.
5. Store password protection is ON (normal for dev). Use "View store" from admin (that's how I got in).

## Retest list after your redeploy (~15 min)

1. Onboarding → Choose products (should open now; if not, the new warning banner + full-form fallback appears — tell me and I'll dig further with the console).
2. Dashboard: deltas show "—" instead of +18.4%/+312; activity says "Welcome to Encore".
3. Campaign on Short Sleeve ("Only when sold out") → storefront shows preorder button once blocks are added on a modern theme.
4. Campaign with end date → countdown ticks; embed toggle ON → badge on the catalog card.
5. Waitlist Import CSV with the 2-row sample from the guide.
