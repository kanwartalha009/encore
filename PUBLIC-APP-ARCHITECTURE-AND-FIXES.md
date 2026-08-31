# Encore — Public App Architecture Guide + Post-Deploy Fixes (2026-08-31)

Written after the first successful Railway deploy. Covers: why the login page exists (and when it's a problem), why the storefront integration isn't visible yet, why sessions break, and the exact fixes. Grounded in Shopify's current docs (embedded auth via token exchange; App Store requirement 3.1.3 "seamless sign up based on Shopify credentials").

## 1. How a public embedded app actually works (the architecture)

A Shopify public app has TWO front doors, and only one is for merchants:

1. **Through the Shopify admin (the only real path).** Merchant installs from the App Store → Shopify managed install grants scopes → app opens embedded in an iframe → App Bridge supplies a short-lived **ID token** → the backend (`authenticate.admin(request)` in every route) exchanges it for an access token (**token exchange**). No login screen exists on this path — Shopify's credentials ARE the login. This is what requirement 3.1.3 demands and what reviewers test.
2. **Direct URL visit (robots, curious people, uptime checks).** Someone opens `https://<encore>.up.railway.app/` in a plain browser. There is no Shopify session and no ID token, so the template shows the `auth/login` "Shop domain" page, which just bounces the visitor into the Shopify install/admin flow for the shop they type.

**Verdict on the login page: it is NOT a review blocker.** Every app built from Shopify's own template ships this exact page; Shopify publishes thousands of them. The rule is that merchants must never hit a login prompt *inside the admin flow* — and Encore doesn't: `app/routes/app.tsx:12` authenticates every embedded request via token exchange. What you saw on the "main domain" is door #2 behaving as designed. (We'll still polish it — see F5 — because a branded landing beats a bare form.)

**When it IS a bug:** if the login form ever renders *inside* the Shopify admin iframe. That means token exchange failed — almost always a config mismatch (F1) or an uninitialized session table (F3), not app code.

## 2. Why "storefront integration is not available"

The theme app extension (preorder button, widgets) is **not part of the Railway web deploy**. Extensions ship separately through Shopify's infrastructure and only reach storefronts after BOTH:
1. `shopify app deploy` is run from the repo (publishes an app *version* containing `encore-storefront`, the checkout function, Flow, and customer-account extensions), and
2. the merchant enables the **app embed** in Theme editor → App embeds (plus adds blocks where wanted).

Until step 1 happens, no store — including yours — can see any storefront piece. Additionally the **app proxy** (`/apps/encore/...` config + notify endpoints) must point at the Railway URL in the app configuration, or storefront JS calls will 404.

## 3. Why "session breaks in More settings"

Two distinct causes, one per door:

- **You were testing through door #2 (direct URL).** After the login-page hop you're in a half-authenticated state; deeper navigations (Markets/Translations/Notifications via Settings → More) re-run `authenticate.admin` with no embedded ID token and bounce. **This is expected — the app is embedded-only by design.** Test through the dev store's admin (Apps → Encore), and these routes hold session fine: all four More-settings routes authenticate and export the Shopify `headers` boundary (verified: app.markets.tsx:67, app.translations.tsx:53, app.notifications.tsx:79, app.help.tsx:37).
- **One real gap found in code:** `app/routes/app.campaigns.actions.tsx` is the only `app.*` route missing the `headers` boundary export — thrown auth responses from it lose their iframe headers. Fix in F4.

## 4. Fix checklist (ordered)

**F1 — Make the three URLs agree exactly (config, 10 min).** The same origin must appear in: (a) Railway env `SHOPIFY_APP_URL=https://<encore>.up.railway.app`; (b) Partner/Dev dashboard → App → Configuration → App URL + redirect URLs (`<origin>/auth/callback`, `/auth/shopify/callback`, `/api/auth/callback` per toml); (c) `shopify.app.toml` `application_url` + `[auth] redirect_urls` + `[app_proxy] url` — commit and push. Any mismatch = token exchange fails = login page inside admin.

**F2 — Ship the extensions (makes storefront integration appear).** Locally: `shopify app config link` (select the prod config), then `shopify app deploy`. Expect zero URL warnings (Flow `runtime_url`s and customer-account `APP_URL` must be the Railway origin — currently still localhost in the tomls; fix in the same commit). Then on the dev store: Online Store → Customize → App embeds → toggle **Encore** on → Save. Now the preorder button renders on product pages matched by a LIVE campaign.

**F3 — Verify the database actually initialized on the volume.** In Railway → service → Console: `ls -la /data` (expect `encore.sqlite`) and confirm the deploy logs show the `prisma db push` from `npm run docker-start`/`setup`. An empty/missing DB = no Session table = login loop even in admin. If missing, check `DATABASE_URL=file:/data/encore.sqlite` and that the volume is mounted at `/data`.

**F4 — Code polish (one commit).**
- Add to `app/routes/app.campaigns.actions.tsx`: `export const headers: HeadersFunction = (h) => boundary.headers(h);` (import boundary like the sibling routes).
- Root-route redirect (`app/routes/_index/route.tsx`): when the request has no `?shop=` param, redirect to your marketing/listing URL instead of rendering the bare login card — merchants and reviewers who stumble on the naked domain land somewhere branded. Keep `/auth/login` itself as-is (the CLI and some flows use it).

**F5 — Test the right way (no code).** Dev store admin → Apps → Encore. Walk: onboarding wizard → campaign → Settings → More settings → Markets/Translations/Notifications/Help → Plans. Session must hold across all of it. Then storefront: product page shows preorder button; place a test preorder. If the login page EVER appears inside the admin during this walk, capture the Railway log lines from that minute (look for 302 → /auth/login and any `InvalidJwtError`) and debug F1/F3 — do not ship until this walk is clean.

**F6 — Optional hardening for review week.** `npm run setup` guard in docker-start already handles migrations; add the `@shopify/shopify-api` overrides dedupe (removes the `as any` on PrismaSessionStorage) and pin `@shopify/ui-extensions-react` to an exact published version (fresh `npm install` currently fails on `2025.10.x`).

## 5. What does NOT need building

No custom login/signup system (3.1.3 forbids extra login prompts — Shopify credentials are the auth), no standalone website for core flows (3.1.1 wants workflows inside admin — Encore complies), no OAuth authorization-code flow (that's for standalone apps; embedded uses managed install + token exchange, which the template already does).

Sources: shopify.dev — Implement token exchange; About app authentication; Built for Shopify requirements (3.1.x); Integrating with the Shopify admin.
