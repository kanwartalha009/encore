# Encore — deploy checklist

Run before every production `shopify app deploy`. Verified items only.

## Production URLs (CRITICAL — do not skip)

The Shopify CLI auto-updates **only** `application_url` and `redirect_urls` in
`shopify.app.toml` (via `automatically_update_urls_on_dev`). It does **NOT**
rewrite extension `runtime_url`s or source-code constants. Set every URL below to
the **production** app domain before `deploy`, or Flow actions and the Customer
Account block will call `localhost` and silently fail.

| # | File | Line / key | Dev value | Set to |
|---|---|---|---|---|
| 1 | `shopify.app.toml` | `application_url` | `https://encore.nova-platform.localhost:3003` | prod URL |
| 2 | `shopify.app.toml` | `redirect_urls[0]` | `…localhost:3003/auth/callback` | prod URL + `/auth/callback` |
| 3 | `extensions/encore-flow-tag-order/shopify.extension.toml` | `runtime_url` | `…localhost:3003/flow/tag-order` | prod URL + `/flow/tag-order` |
| 4 | `extensions/encore-flow-send-email/shopify.extension.toml` | `runtime_url` | `…localhost:3003/flow/send-email` | prod URL + `/flow/send-email` |
| 5 | `extensions/encore-customer-account/src/PreordersBlock.tsx` | `APP_URL` const | `…localhost:3003` | prod URL |

Env vars that already read the URL from `process.env.SHOPIFY_APP_URL` (with a
localhost fallback) — `app/routes/app.plans.tsx`, `app/services/klaviyo-oauth.server.ts`
— are prod-safe **as long as `SHOPIFY_APP_URL` is set** in the deploy environment.

## Secrets / env (never commit)

- `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`
- `DATABASE_URL` (Postgres)
- `NOVA_API`, `NOVA_INSTALL_CONFIRM_SECRET`, `NOVA_INGRESS_HMAC_SECRET` — HMAC secrets must **match the Nova platform deployment**.
- Klaviyo OAuth client id/secret (if Klaviyo notifications used).

## Webhooks / PCD gate

- `orders/*` topics stay **commented** in `shopify.app.toml` until Protected
  Customer Data is approved (Partner Dashboard → API access → PCD). After approval,
  uncomment `orders/create`, `orders/paid`, `orders/cancelled`.

## Placeholder marketing domain

- `docs.preordernovafied.app` / `support@preordernovafied.app` appear in the
  dashboard, campaigns index, and Settings footer. Replace with the real docs URL
  and support inbox once the domain is owned (E0 external item).

## Build gate (Mac)

- `npm run typecheck` (= `react-router typegen && tsc`) → 0 errors.
- `npm run build` (= `react-router build`) → succeeds (catches the `.server` import trap that `tsc` alone misses).
- `shopify app deploy` → extensions upload without URL warnings.
