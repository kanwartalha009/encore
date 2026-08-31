# Encore — Go-Live & Test Guide (R0 + R1, 2026-08-31)

Everything below is ready in the repo — implemented, typechecked, prod-built and unit-tested (33 tests green) in a Docker-faithful environment. Your part is: deploy once, walk the checklist once, take screenshots, submit.

**What shipped in this pass**

- R0 (truth & reliability): STOCK trigger works end-to-end both directions, "When shoppers see it" control on the campaign form, mixed-cart message rendered, welcome banner fixed + dismissible, outbox health warning on dashboard, real currency everywhere, SMS toggle hidden, inert settings removed.
- R1 (parity + polish): countdown timer block, collection-page preorder badges, waitlist CSV import, onboarding inherits your defaults + welcome banner, teaching empty states on 7 pages, full i18n (0 missing keys ×8 locales, Polaris + store-locale autodetect), locale-aware cohort names, vitest suite (`npm test`).

---

## 1) Deploy (~10 min)

```bash
cd ~/Documents/Claude/Projects/"Nova Apps Platform"/shopify/encore

# If an old lock is still there from July:
rm -f ../../.git/index.lock

npm install                 # picks up the new vitest dev-dependency
npm run typecheck           # expect: clean (prisma generate runs via typegen deps)
npm test                    # expect: 6 files, 33 tests, all green
npm run build               # expect: green

git add -A
git commit -m "R0+R1: trigger truth, countdown, collection badges, CSV import, i18n, empty states, tests"
git push                    # Railway auto-deploys the web app

npm run deploy              # shopify app deploy — new extension version (countdown block, embed setting, new JS)
# → release the version when the CLI asks (or in Partner Dashboard)
```

Notes:

- `shopify app deploy` will show the new **Preorder countdown** block and the updated app embed. Everything else about the extension config is unchanged from the version that already released cleanly.
- If typecheck complains about missing Prisma types, run `npx prisma generate` once and re-run.

## 2) Ops — crons are now BUILT IN (nothing to schedule)

The app now runs its own scheduler inside the Railway service (single platform, no external dependency): outbox retries every 2 minutes, balance reminders + GDPR purge hourly (both idempotent — stamped in the DB, so they never fire twice). It starts ~30s after each deploy boots.

- `ENCORE_CRON_SECRET` stays useful: the `/cron/*` endpoints still work as token-guarded **manual triggers** (e.g. `curl -X POST -H "Authorization: Bearer <secret>" .../cron/nova-outbox`) and as a health check (`GET` = dry run).
- Verify after deploy: Railway → service → Logs → look for `[scheduler] started — outbox every 2min, reminders/purge hourly`.
- Escape hatch: set `ENCORE_DISABLE_INTERNAL_CRON=1` to turn the internal timers off (only if you ever move to an external scheduler).

## 3) Dev-store test walk (~40 min, in order)

Prep: dev store, app installed, theme editor open. You need 3 test products: **A** in stock (qty 5), **B** out of stock (qty 0), **C** in stock (qty 3).

### 3.1 Theme setup

- [ ] Product template: add **Preorder button**, **Preorder countdown**, **Back-in-stock button**, **Low-stock meter** blocks.
- [ ] App embeds: enable **Storefront runtime**, and turn ON "Show preorder badges on collection pages".

### 3.2 R0 — trigger truth (the big fix)

- [ ] Campaign 1 on product A: "When shoppers see it" = **Only when sold out** → LIVE. Product A page: **no preorder button** (it's in stock). Set A's inventory to 0 → button appears, add to cart works, cart line shows Preorder + ship date properties.
- [ ] Campaign 2 on product C: "When shoppers see it" = **Always** → LIVE. Product C page: preorder button shows **while in stock** (presale mode).
- [ ] Settings → set a mixed-cart message → with a preorder + a normal item in cart, the note shows under the button.
- [ ] Edit Campaign 1 and confirm the "When shoppers see it" select round-trips (still "Only when sold out").

### 3.3 R1 — countdown

- [ ] Give Campaign 2 an **end date** 2 days out → product C page shows "Preorder ends in 1d 23h …" ticking every second.
- [ ] Remove the end date → countdown disappears (block renders nothing).

### 3.4 R1 — collection badges

- [ ] Open a collection containing products A (OOS, stock-triggered) and C (always-on) → both cards show the **Preorder** pill. A product with no campaign shows nothing.
- [ ] Turn the embed setting off → badges gone.

### 3.5 R1 — waitlist CSV import

- [ ] Waitlist page → **Import CSV** with:
  ```csv
  email,product_handle
  test1@example.com,<product-b-handle>
  test2@example.com,<product-b-handle>
  ```
- [ ] Banner: "2 subscribers imported". Re-import the same file → "2 already existed".
- [ ] Bad file (no email column) → clear error explaining the expected columns.

### 3.6 R1 — onboarding

- [ ] Settings → set default button label to something custom (e.g. "Reserve now").
- [ ] Open `/app/onboarding` → step 3's button text is pre-filled with "Reserve now".
- [ ] Finish the wizard → lands on the campaign page with the green "Your first preorder is live!" banner; dismiss survives reload (URL param cleared).

### 3.7 R1 — i18n + empty states

- [ ] Switch store primary language to German (or use the in-app language picker) → admin UI (nav, dashboard, campaign form) is translated; Polaris internals (pagination, date pickers) too.
- [ ] Fresh-install view: Insights / Low-stock / Notifications / Translations / Benchmark / Plans each show a teaching empty state, not a blank table.

### 3.8 Money path (already released, re-confirm once)

- [ ] Deposit campaign (e.g. 25%) on product C → checkout shows deposit now / balance later; cap: set campaign cap to 1, try qty 2 → checkout blocked with "Only 1 preorder left".
- [ ] Dashboard shows the order; no outbox warning banner appears (crons healthy).

## 4) Screenshots for the listing (×6, 1600×900)

1. Dashboard with revenue cards + campaign list
2. Campaign form — the "When shoppers see it" + payment section
3. Storefront product page — preorder button + countdown + badge
4. Collection page with preorder badges
5. Waitlist page (import + subscriber groups)
6. Insights page

## 5) Submit

1. Partner Dashboard → app → Distribution → App Store listing: name "Encore — Preorder & Back in Stock", fill listing (copy in `LISTING-KIT.md`), icon `listing-assets/encore-icon-1200.png`, screenshots above.
2. Protected customer data form: select email + name usage (waitlist + preorder notifications), mark encryption at rest, GDPR webhooks are implemented.
3. Support email + privacy (`/privacy`) and terms (`/terms`) URLs are live on the Railway domain.
4. Submit for review. Review typically checks: clean install, onboarding to first preorder, uninstall webhook, GDPR endpoints — all covered by the walk above.

## If something fails

- Widget not appearing at all → app proxy: Partner Dashboard → App setup → App proxy = `apps/encore` → `https://encore-production-7c8f.up.railway.app/proxy`.
- Badges 401 → same proxy config; badges use `/apps/encore/badges`.
- Countdown missing → campaign has no end date, or product is in stock on a sold-out-only campaign (both are by design).
- `npm test` red on your Mac → run `npx prisma generate` first, then re-run; if still red, send me the output.
