# Encore — run locally, go live, and the Shopify URLs (simple guide)

## 0. The two pieces (and their folders)

Encore is **two separate apps**, two processes, two databases:

| Piece | Folder | Runs on | Database |
|---|---|---|---|
| **Nova platform API** (records installs, billing, commissions) | `Nova Apps Platform/` (root) | `http://localhost:4000` | `nova_apps` |
| **Encore Shopify app** (the actual app merchants use) | `Nova Apps Platform/shopify/encore/` | tunnel via `shopify app dev` | `app_encore` |

They talk over HTTP using shared HMAC secrets (`NOVA_INSTALL_CONFIRM_SECRET`, `NOVA_INGRESS_HMAC_SECRET`).
**Those two secrets must be identical in both `.env` files.**

---

## 1. One-time setup
- Start Postgres: `brew services start postgresql@17`
- Have: Node 22.12+, Shopify CLI (`shopify version`), a Partner account (org `1710157`), an **EU dev store with Shop Pay on**.
- Generate the encryption key once: `openssl rand -hex 32` (use it for `APP_ENCRYPTION_KEY`).

---

## 2. Run the platform API (so installs + webhooks are recorded)
```bash
cd "/Users/talha/Documents/Claude/Projects/Nova Apps Platform"
# Edit root .env: DATABASE_URL, NOVA_INSTALL_CONFIRM_SECRET, NOVA_INGRESS_HMAC_SECRET, DEV_SHOP_DOMAIN=<your dev shop>
createdb nova_apps
pnpm install
pnpm db:migrate                    # type "init" at the prompt — uses the repo's local Prisma 6 + root .env
pnpm db:seed                       # seeds Encore app + nova agency + your dev store + a PENDING install
pnpm --filter @nova/api dev        # → API on http://localhost:4000
```
> Always use `pnpm db:migrate` / `pnpm db:seed` for the platform — NOT `npx prisma ...` from the root.
> The root has no local Prisma, so `npx` downloads Prisma 7 (which rejects `url = env()`); the repo
> scripts run the pinned **Prisma 6** inside `packages/database` and load `DATABASE_URL` via `dotenv`.

---

## 3. Run the Encore app + install on the dev store
```bash
cd "/Users/talha/Documents/Claude/Projects/Nova Apps Platform/shopify/encore"
cp .env.example .env
```
Fill `shopify/encore/.env`:
```
APP_DB_URL__ENCORE="postgresql://talha@localhost:5432/app_encore"
APP_ENCRYPTION_KEY=<the 64-hex-char key from `openssl rand -hex 32`>
SHOPIFY_API_SECRET=<Partner dashboard → Encore → API credentials>
NOVA_API=http://localhost:4000
NOVA_INSTALL_CONFIRM_SECRET=<SAME as platform .env>
NOVA_INGRESS_HMAC_SECRET=<SAME as platform .env>
```
Then:
```bash
createdb app_encore
npm install
npx prisma generate
npx prisma migrate dev --name init
npm run dev            # = shopify app dev
# Press 'p' → opens the preview → click Install on your dev store.
```
**What `shopify app dev` does for you automatically:** opens a Cloudflare tunnel (a temporary HTTPS URL),
points the app's URL + redirect URLs at that tunnel for the dev store, applies `shopify.app.toml`
(scopes, webhooks, app proxy), and installs the app. **You don't set any URL by hand for local dev.**

---

## 4. Test the flow (local)
1. App opens embedded inside the dev store admin.
2. **Products** page → it scans for out-of-stock variants → **Enable preorder**.
3. Open a product (`/app/products/<numericId>`) → set mode / payment / ship date → **Save** (creates the Shopify selling plan).
4. Place a **test order** for that product → confirm the order is tagged `encore-preorder` and has the `encore.ship_date` metafield (Order page → Metafields).
5. **Platform side** (`http://localhost:4000`): the Installation flips to **ACTIVE**, and a `WebhookEvent` row appears when a lifecycle webhook fires.

> Note: the shopper-facing **storefront preorder block is the one screen still being built** — until it ships,
> test preorder via the admin + a draft/test order, not the live storefront button.

---

## 5. The Shopify app URLs (redirect URLs) — what they are
All live in **`shopify.app.toml`**:
- **`application_url`** — where the app is hosted. Local: the Cloudflare tunnel (auto). Prod: your server URL.
- **`[auth] redirect_urls`** — the OAuth callback: `<application_url>/auth/callback`. (Encore uses **token exchange**, so there's no redirect login screen, but this URL must still be valid.)
- **`[app_proxy]`** — `/apps/encore` on the storefront → your app's `/proxy` (the storefront block calls this).

How they get set:
- `shopify app dev` → **auto-updates** these for the **dev** store only (`automatically_update_urls_on_dev = true`).
- `shopify app deploy` → **pushes** them for **all** stores (production). They then show in the Partner Dashboard under the app's **Configuration → URLs**.

---

## 6. Go live on a server
1. **Host the Encore app** (Railway, per the spec): new Railway project → add a Postgres add-on → deploy the
   `shopify/encore` repo (it has a `Dockerfile`; `npm run setup` runs `prisma generate && prisma migrate deploy`).
   Set every `.env` value as a Railway variable. Note the public URL, e.g. `https://encore-xxx.up.railway.app`.
2. **Set production URLs** in `shopify.app.toml`:
   ```toml
   application_url = "https://encore-xxx.up.railway.app"
   [auth]
   redirect_urls = [ "https://encore-xxx.up.railway.app/auth/callback" ]
   [app_proxy]
   url = "https://encore-xxx.up.railway.app/proxy"
   ```
3. **Push config + extensions**:
   ```bash
   cd shopify/encore
   shopify app deploy        # creates a new app version with the prod URLs + scopes + webhooks
   ```
4. **Host the platform API** (Railway) the same way; set its env. Point the Encore app's `NOVA_API` at the
   platform's public URL, and keep the two `NOVA_*` secrets identical on both.
5. **Distribution** — when ready for real merchants, choose **public or custom** in the Partner Dashboard.
   **Irreversible** — defer until after the pilot (spec §15).

---

## 7. Test on the live server
- Install on a store via the app (dev store first, then a pilot store).
- Verify end-to-end: install → Installation **ACTIVE** on the platform → enable preorder → order tagged +
  ship-date metafield → uninstall → billing stops + `WebhookEvent` recorded.

## Gotchas (the usual suspects)
- The two `NOVA_*` secrets **must match** platform ↔ app, or install-confirm/webhooks 401.
- Postgres must be running; Homebrew Postgres uses your macOS user with no password.
- Charge-later only works on a **Shop Pay / Shopify Payments** store; otherwise Encore falls back to deposit/pay-now.
- After any `shopify.app.toml` change, run `shopify app deploy` (or `dev`) to apply it.
