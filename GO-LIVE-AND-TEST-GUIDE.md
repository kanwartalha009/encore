# Encore — Go-Live & Test Guide (R0 + R1 + test-walk fixes, updated 2026-08-31)

Status right now:

- R0 + R1 code: DONE, committed and **already live on Railway** (verified: new `/apps/encore/config` and `/apps/encore/badges` respond correctly through Shopify's signed app proxy).
- Claude ran the admin walk in Chrome on dev-novasolutions: every app page loads, no broken links, R0 "When shoppers see it" control live, PKR currency correct. Full detail: `TEST-WALK-FINDINGS-2026-08-31.md`.
- 5 bugs found in that walk are FIXED in the repo (onboarding picker fallback, "Preorder Novafied" naming, internal-doc banner copy, fake KPI deltas, fake waitlist stat) — **they reach the live app when you push (step 1)**.
- Crons are built into the app (in-process scheduler; single platform, nothing external to set up).

Your critical path: **step 1 → step 2 → step 3 → screenshots → submit.**

---

## 1) Deploy the fix pass (~10 min)

```bash
cd ~/Documents/Claude/Projects/"Nova Apps Platform"/shopify/encore

rm -f _to_delete_index.lock      # leftover from the cleared git lock, if still there

npm install                      # once — picks up the vitest dev-dependency
npm run typecheck                # expect: clean
npm test                         # expect: 6 files, 33 tests, green
npm run build                    # expect: green

git add -A
git commit -m "Test-walk fixes: onboarding picker fallback, real KPI deltas, truthful waitlist stats, Encore naming, merchant-language outbox banner"
git push                         # Railway auto-deploys

npm run deploy                   # shopify app deploy — releases the NEW extension version
# → the version list must show "Preorder countdown" block + updated app embed. Release it.
```

Notes:

- `npm run deploy` is **not optional**: the countdown block, the collection-badges embed toggle, and the new storefront JS only reach themes through the released extension version. (The walk could not confirm this ran after R1.)
- If typecheck complains about Prisma types: `npx prisma generate`, re-run.
- After Railway redeploys, check service Logs for `[scheduler] started — outbox every 2min, reminders/purge hourly`.

## 2) One-time dev-store prep (~10 min) — why the storefront showed nothing

The walk found the storefront can't display any Encore feature yet because of store setup, not app code:

1. **Theme**: the published theme is Debut (2021) with no app-block support visible. Use the **Horizon draft theme** (or install Dawn) for testing — publish it or use its preview.
2. **Products**: only *Short Sleeve* (sold out) is published to the Online Store; the LIVE "test" campaign targets an unpublished product, so nothing can render. Publish a second, in-stock product (e.g. Echo Bag) to the Online Store sales channel.
3. **Campaigns**: create two —
   - Campaign A on **Short Sleeve** → "When shoppers see it" = *Only when sold out* → LIVE.
   - Campaign B on the **in-stock product** → *Always (presale)* → give it an **end date 2 days out** → LIVE.
4. **Theme blocks** (on the modern theme): product template → add **Preorder button**, **Preorder countdown**, **Back-in-stock button**, **Low-stock meter**. App embeds → enable **Storefront runtime** + turn ON "Show preorder badges on collection pages".

## 3) Test walk (~30 min, in order)

Admin-side items marked ✅ were already verified live by Claude's walk — spot-check, don't re-test.

### 3.1 Fix-pass retest (new — after step 1)

- [ ] Dashboard: deltas show real numbers or "—" (no more +18.4% / +312); Recent activity says "Welcome to **Encore**".
- [ ] Onboarding → Choose products: picker opens. If it still doesn't, a warning banner with "Open the full preorder form" now appears instead of a dead button — use it, and tell Claude so we can debug with the console.
- [ ] Waitlist: third stat card shows "Products with waitlists" (no ~12% guess).

### 3.2 R0 — trigger truth

- ✅ "When shoppers see it" select live in campaign form (Advanced → Button) with correct options/help text.
- [ ] Product A (sold out, *Only when sold out*): storefront shows preorder button; set stock >0 → button disappears.
- [ ] Product B (in stock, *Always*): preorder button shows while in stock.
- [ ] Mixed-cart note: set the message in Settings → with preorder + normal item in cart, note appears under the button.
- [ ] Edit Campaign A → the select round-trips ("Only when sold out" still selected).

### 3.3 R1 — countdown

- [ ] Product B page: "Preorder ends in 1d 23h …" ticking every second.
- [ ] Remove end date → countdown gone.

### 3.4 R1 — collection badges

- ✅ `/apps/encore/badges` endpoint verified working through the app proxy.
- [ ] Catalog page: both campaign products show the **Preorder** pill; non-campaign products don't.
- [ ] Toggle the embed setting off → badges gone.

### 3.5 R1 — waitlist CSV import

- ✅ Import CSV button + empty state live.
- [ ] Import this file (use your real product handle):
  ```csv
  email,product_handle
  test1@example.com,short-sleeve
  test2@example.com,short-sleeve
  ```
- [ ] "2 subscribers imported" → re-import same file → "2 already existed" → file without an email column → clear error.

### 3.6 R1 — onboarding

- [ ] Settings → default button label = "Reserve now" → /app/onboarding step 3 pre-fills "Reserve now".
- [ ] Finish wizard → lands on campaign page with green "Your first preorder is live!" banner; banner gone after dismiss + reload.

### 3.7 R1 — i18n + empty states

- ✅ Settings language section, Insights/waitlist empty states verified live.
- [ ] Switch app language to German → nav, dashboard, campaign form translated (Polaris pagination/date pickers too).

### 3.8 Money path (re-confirm once)

- [ ] Deposit campaign (25%) on product B → checkout shows deposit now / balance later.
- [ ] Cap = 1, try qty 2 → checkout blocked: "Only 1 preorder left".
- [ ] Order appears on dashboard; outbox banner stays away (note: if the Nova platform backend isn't running, the delivery banner may show — that's the delivery target being down, not Encore).

## 4) Screenshots for the listing (×6, 1600×900)

1. Dashboard (after a test order — real numbers, real deltas)
2. Campaign form — "When shoppers see it" + payment section
3. Storefront product page — preorder button + countdown
4. Collection page with preorder badges
5. Waitlist page (import + subscriber groups)
6. Insights page

## 5) Submit

1. Partner Dashboard → Distribution → listing: name "Encore — Preorder & Back in Stock", copy from `LISTING-KIT.md`, icon `listing-assets/encore-icon-1200.png`, screenshots above.
2. Protected customer data form: email + name usage (waitlist + preorder notifications), encryption at rest, GDPR webhooks implemented.
3. Support email set; privacy (`/privacy`) + terms (`/terms`) — ✅ verified live on the Railway domain.
4. Submit. Review typically walks: clean install → onboarding to first preorder → uninstall webhook → GDPR endpoints. All covered above.

## If something fails

- Widget absent everywhere → App proxy: Partner Dashboard → App setup → prefix `apps/encore` → `https://encore-production-7c8f.up.railway.app/proxy`.
- Countdown block missing from theme editor → `npm run deploy` + release (step 1), then reload the editor.
- Countdown not showing on page → campaign has no end date, or product is in stock on a sold-out-only campaign (both by design).
- Badges missing → embed toggle off, or campaign product unpublished/COLLECTION-mode (badges cover ALL + SPECIFIC campaigns only, by design).
- `npm test` red on Mac → `npx prisma generate` first.
- Git "index.lock exists" → `rm .git/index.lock` (stale lock; no git process actually running).
