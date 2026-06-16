# Encore — Pre-Build Prerequisites & Setup Checklist

> Companion to `encore-BUILD-PACK.md`. The build pack says **what** to build; this says **whether the ground is ready to build it**.
> Commands and API facts verified against shopify.dev (June 2026). Treat every `[ ]` as a gate.
> Audience: the developer (or Claude Cowork) standing up the Encore Shopify app.

**The rule:** do not write a line of feature code until §1–§3 are checked, §4–§6 are wired, and the four **blocking spikes in §7** pass. Encore is a payments-touching app where reliability beats features (spec §0) — a shaky foundation is how incumbents lost.

---

## 0. Why this checklist exists

Encore's hard parts are not the UI — they're **per-market selling plans**, the **Shop Pay/charge-later dependency**, **no-oversell**, and **discount compatibility**. Three of those are unresolved engineering questions in the spec (§17) and are de-risked in Phase 0, before any screen is built. This document collects the accounts, secrets, tooling, and spikes that must be green first.

---

## 1. Accounts & access  `[ ]`

- [ ] **Shopify Dev Dashboard / Partner org** access to **Nova Apps** (org `#4218705`), with permission to create and manage apps. All Nova apps live under this one org (single review identity, single CI token).
- [ ] **Org owner available once** to run the headless `app init` (or to authorize the CI token) — app creation in the org is the one semi-manual step.
- [ ] **EU development store** configured the way the ICP runs: **multiple Shopify Markets**, at least two currencies (EUR + one more), and 2+ languages. Per-market behaviour cannot be tested on a single-market store.
- [ ] **Shop Pay / Shopify Payments enabled** on that dev store — **required** to test deposit and charge-later selling plans (they will not appear at checkout otherwise).
- [ ] **A second dev store on a non-Shopify-Payments gateway** (Mollie / Viva.com / Klarna-as-gateway) to test the **fallback** path (deposit-only / pay-now).
- [ ] **GitHub** access to create/clone the app repo (`github.com/nova-apps/encore`) under the Nova org.
- [ ] **Host access** (Railway, per platform convention) for the backend and the per-app Postgres database.
- [ ] **Distribution decision deferred.** Public vs Custom is **irreversible** — do **not** choose during setup. It stays an open checklist item until after the pilot/validation gate (spec §15).

---

## 2. Local toolchain  `[ ]`

| Tool | Version | Check / install |
|---|---|---|
| Node.js | ≥ 20 LTS | `node -v` |
| pnpm | 9.x (repo pins `9.15.0`) | `corepack enable && corepack prepare pnpm@9.15.0 --activate` |
| Shopify CLI | latest | `npm i -g @shopify/cli@latest` → `shopify version` |
| Git | any recent | `git --version` |
| Postgres client | 14+ | `psql --version` |
| Browser | latest Chrome/Firefox | CLI requirement for the dev preview |

- [ ] Network allows the **Cloudflare tunnel** the CLI opens during `shopify app dev`.
- [ ] Logged into the CLI against the Nova org: `shopify auth logout` then any app command will prompt login.

---

## 3. Secrets & keys to collect  `[ ]`

Fill these in **before** coding. Mark each **secret** as write-only (never commit; store in the host's secret manager). The "platform already has" column shows what the Nova registry recorded when the app was created.

### Group A — Shopify app credentials (per app)

| Env var | What it is | Where to get it | Secret? | Platform already has |
|---|---|---|---|---|
| `SHOPIFY_API_KEY` | App **client_id** (public) | Dev Dashboard → Encore → API credentials (captured by `app init`) | no | `a9f2…4e7b` (masked) |
| `SHOPIFY_API_SECRET` | App **client secret** | Dev Dashboard → Encore → API credentials | **yes** | stored encrypted |
| `SHOPIFY_APP_URL` | Public app URL | tunnel URL in dev; Railway URL in prod | no | `encore.nova-platform…` |
| `SCOPES` | OAuth access scopes | from the build pack (see below) | no | yes (9 scopes) |
| Webhook HMAC secret | Verifies `X-Shopify-Hmac-Sha256` | **equals `SHOPIFY_API_SECRET`** | **yes** | — |

**Scopes (exactly, from the build pack):**
`read_products, write_products, read_inventory, read_locations, read_orders, write_orders, read_markets, read_customers, read_themes`
Least-privilege is a review and trust signal (spec §12) — do not add more "just in case."

### Group B — Shopify org / CI

| Env var | What it is | Where to get it | Secret? |
|---|---|---|---|
| `SHOPIFY_ORG_ID` | Nova Apps org id (`4218705`) | Dev Dashboard | no |
| `SHOPIFY_CLI_PARTNERS_TOKEN` | Headless CI auth for `app deploy` | Org owner generates a CLI token | **yes** |

### Group C — Nova platform wiring

| Env var | What it is | Secret? |
|---|---|---|
| `APP_DB_URL__ENCORE` | Per-app Postgres connection string (isolated DB) | **yes** |
| `APP_ENCRYPTION_KEY` | Encrypts offline access tokens at rest (`accessTokenEnc`) | **yes** |
| `NOVA_API` | Platform API base URL (ingress + install-confirm) | no |
| `NOVA_INGRESS_HMAC_SECRET` | Signs billing/lifecycle events forwarded to ingress | **yes** |
| `NOVA_INSTALL_CONFIRM_SECRET` | Signs the post-OAuth install-confirm callback (`POST {NOVA_API}/v1/internal/installations/confirm`) | **yes** |

### Group D — ARRS & EU integrations

| Env var | What it is | Secret? |
|---|---|---|
| `ARRS_API_BASE` + `ARRS_API_KEY` | Emit waitlist / preorder-intent / abandonment events to the ARRS recovery engine | **yes** |
| EU BNPL (Scalapay / Klarna / seQura) | **No app key** — these are checkout payment methods on the store. Only **verify availability** on the dev store. | n/a |
| Sendcloud / Correos / GLS | v1 only **writes** a ship-date metafield they consume — **no keys needed in the app**. | n/a |

---

## 4. Step-by-step: scaffold the app

> The platform engine automates most of this in CI (`shopify app init … --organization-id`, then `app deploy`). The manual flow below is what that automation runs, and what you run locally to develop.

**1. Create the app from the React Router template**
```bash
# Interactive: pick "Build a React Router app" when prompted
shopify app init
# …or pin the template explicitly:
shopify app init --template https://github.com/Shopify/shopify-app-template-react-router
# Headless / CI (engine path) — name + org, capture the returned client_id:
shopify app init --name "Encore" --organization-id $SHOPIFY_ORG_ID
cd encore
```
The CLI scaffolds the app, installs `@shopify/shopify-app-react-router`, and registers an app record in the Dev Dashboard.

**2. Populate `.env`** (see Appendix) — `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, plus the Nova/ARRS values.

**3. Configure `shopify.app.toml`** (scopes, webhooks, app proxy, app URL) — see §5.

**4. Start the dev loop**
```bash
shopify app dev          # opens a Cloudflare tunnel, links a dev store, applies toml to that store
# press 'p' to open the preview and install on the dev store
```
Config changes in `shopify.app.toml` apply automatically to the **dev** store during `app dev`; for **all** stores you must `app deploy`.

**5. Generate the extensions in the module manifest** (`backend, storefront-widget, flow, customer-account`)
```bash
shopify app generate extension   # then choose each target from the interactive list:
#  • Theme app extension   → preorder button/badge + waitlist form (storefront-widget)
#  • Flow trigger          → "Preorder placed" / "Waitlist signup" / "Restock detected"
#  • Flow action           → "Tag order" / "Emit ARRS event"
#  • Customer account UI    → "My preorders" / "My waitlist"
```
Theme integration is **only** ever a theme app extension — never a `<script>` tag or theme-code edit (App Store rule, spec §8.2).

**6. Implement the per-app database** (schema already drafted at `apps/app-admin/db/encore/schema.prisma`) and run the first migration against the isolated Postgres:
```bash
pnpm --filter app-admin exec prisma migrate dev --name init --schema db/encore/schema.prisma
```
The React Router template ships SQLite for session storage; Encore uses **per-app Postgres** — point Prisma at `APP_DB_URL__ENCORE`. Never touch the platform DB or another app's DB.

**7. Deploy** (CI does this headlessly with the CLI token + `client_id`):
```bash
shopify app deploy       # builds + syncs config and extensions, creates a new app version
```

---

## 5. `shopify.app.toml` for Encore (annotated)

```toml
client_id       = "<SHOPIFY_API_KEY>"
name            = "Encore"
handle          = "encore"
application_url  = "https://encore.nova-platform.example"
embedded        = true

[access_scopes]
# Selling plans (write_products), per-market inventory/location reconciliation,
# order tagging + ship-date metafields (write_orders), Markets context, theme embed.
scopes = "read_products,write_products,read_inventory,read_locations,read_orders,write_orders,read_markets,read_customers,read_themes"

[auth]
redirect_urls = [ "https://encore.nova-platform.example/auth/callback" ]

[webhooks]
api_version = "2026-04"   # use the latest stable; charge-later ON_FULFILLMENT needs >= 2026-01

# Mandatory compliance topics (required for App Store apps)
[[webhooks.subscriptions]]
compliance_topics = [ "customers/data_request", "customers/redact", "shop/redact" ]
uri = "/webhooks/compliance"

# Lifecycle → also forwarded to the Nova platform ingress (billing source of truth)
[[webhooks.subscriptions]]
topics = [ "app/uninstalled" ]
uri = "/webhooks/app/uninstalled"
[[webhooks.subscriptions]]
topics = [ "app_subscriptions/update" ]
uri = "/webhooks/app/subscriptions/update"

# Business topics that drive Encore's reliability guarantees
[[webhooks.subscriptions]]
topics = [ "orders/create" ]            # tag preorder lines + write ship-date metafield + demand signal
uri = "/webhooks/orders/create"
[[webhooks.subscriptions]]
topics = [ "orders/paid" ]              # create/confirm the charge-later ChargeSchedule
uri = "/webhooks/orders/paid"
[[webhooks.subscriptions]]
topics = [ "inventory_levels/update" ] # restock → fire ARRS recovery; reconcile per-market eligibility
uri = "/webhooks/inventory/update"
[[webhooks.subscriptions]]
topics = [ "products/update" ]          # re-scan OOS; keep configs + selling plans in sync
uri = "/webhooks/products/update"

# Storefront endpoints behind the app proxy: /apps/encore/preorder and /apps/encore/waitlist
[app_proxy]
url    = "https://encore.nova-platform.example/proxy"
subpath = "encore"
prefix  = "apps"

[build]
include_config_on_deploy = true
```

> Every compliance webhook handler must return **200** on success and **401** on an invalid HMAC, and finish redactions within 30 days. All handlers must be **idempotent and retry-safe** (spec §13) — overselling and missed charges are unacceptable.

---

## 5A. Auth flow — how the credentials are actually used

`client_id` + secret are the app's credentials, but **how** they authenticate depends on where the app runs:

- **Embedded admin (Encore) → token exchange.** App Bridge mints a short-lived (~60s) **session token** signed with your app secret. The backend verifies it and **exchanges it for an access token** (online/offline) to call the Admin GraphQL API. There is no redirect-based OAuth on this path.
- **Standalone (non-embedded) apps → authorization-code grant.** The classic redirect flow that uses `[auth] redirect_urls`. Encore is embedded, so those URLs exist for the template's callback, but the working path is token exchange.
- **The app secret does triple duty:** signs/verifies session tokens, backs the token exchange, and verifies **webhook HMAC** (`X-Shopify-Hmac-Sha256`).
- **Managed install:** once you deploy scopes in `shopify.app.toml`, Shopify handles installation and scope grants — you don't hand-roll the OAuth screen.

> Rule of thumb: App Bridge auth = **session tokens**, not the redirect URL. Never use cookies for embedded auth — third-party cookie blocking breaks it. Validate the session token on every request (it expires in ~60s); fetch a fresh one from App Bridge each time.

## 5B. Billing model — how plans are charged

Two systems exist; pick one per app:

- **Shopify App Pricing (managed pricing)** — the default for new public apps. You define plans in the Dev Dashboard; Shopify renders the plan picker and handles approval. Supports recurring, usage, and combined, plus free trials and **public/private plans + welcome links**.
- **Billing API (manual)** — you build the plan UI and call `appSubscriptionCreate` / `appUsageRecord` yourself. More control; needed for outlier pricing.

Pricing models (either system): **recurring** (free / monthly / yearly), **usage-based** (fixed / graduated / volume — requires a spending **cap** and is **monthly-only**), and **combined** (base fee + usage).

**Encore** is deliberately **flat, feature-tiered recurring** — Free / Growth / Scale. Usage is rejected on purpose: opaque per-preorder usage fees are a competitor weakness the wedge exploits (spec §9.10 / §14). (Usage can't go on an annual plan anyway.)

**Nova mapping:** `AppPlan` rows are the recurring tiers; the charge ledger ingests whatever Shopify reports (`SUBSCRIPTION` / `USAGE` / `ONE_TIME` / `REFUND`); commissions derive from the **actual** charge amount.

## 5C. Per-store comp & discount plans

The app can sit on a paid plan publicly yet bill a **specific store** free or discounted — to comp a Nova retainer client or run a launch-partner deal. Two mechanisms, by billing system:

- **Billing API (manual):** your backend prices per shop — create the subscription for that store at `$0` or a reduced amount (or a longer trial). The comp is just a branch in your `appSubscriptionCreate` logic.
- **Shopify App Pricing (managed):** use **private plans + welcome links** (and/or discount codes). Create a private/discounted plan and share its welcome link with the specific store so it lands there instead of the public plan.

**Nova platform support:** an `Installation` carries an optional **plan override** — `FREE`, a `PERCENT` discount, or a `FIXED` price — set by the operator/agency and honored by the app when it creates the subscription. The override is per-store and **does not** change the immutable referral `agencyId`. Downstream:

- A **fully comped (free)** store produces **no Shopify charge** → no ledger entry → no commission. Expected.
- A **discounted** store produces a **smaller** charge; the ledger records the real (discounted) amount and commissions derive from it.

So in the build, Encore reads the platform comp at subscription-creation time and prices accordingly — a comped store is never hit with a surprise full charge.

---

## 6. Wire the Nova platform layer (don't skip)

The platform's billing, commissions, and install pipeline depend on these signed channels:

- [ ] **Webhook forwarding** — `app/uninstalled`, `app_subscriptions/update`, and the three GDPR topics are handled app-locally **and** forwarded to `{NOVA_API}/v1/webhooks/shopify/encore`, HMAC-signed with `NOVA_INGRESS_HMAC_SECRET`. This is how charges/commissions get their data.
- [ ] **Install-confirm callback** — after OAuth, `POST {NOVA_API}/v1/internal/installations/confirm` (signed) so the install + agency referral attribution is recorded.
- [ ] **Billing plans** — sync the Nova `AppPlan` rows (Free / Growth $19 / Scale $49) to the Billing API; the platform ledger ingests `app_subscriptions/update`. (Pricing numbers are placeholders pending the pilot — spec §14/§17.)
- [ ] **DB isolation** — the app reads/writes **only** `APP_DB_URL__ENCORE`. One database, one migration history, per app.

---

## 7. Phase-0 validation spikes — **BLOCKING**  `[ ]`

These resolve the spec's open questions (§17) and the verified API constraints. **Phase 1 does not start until these pass** (or are explicitly de-scoped with sign-off).

- [ ] **Per-market selling plans (flagship, hardest).** Selling plans attach to **products/variants, not markets**, and stock is **location-based**. Spike: detect the buyer's market (Markets context / shipping destination) and conditionally render the preorder block + apply the selling plan, **reconciled against real location inventory**. *Acceptance:* a market with sellable stock shows **Buy**; a market without shows **Preorder**; the app **never** shows preorder where sellable stock exists for that market. *(Blocks 9.2 / Phase 2.)*
- [ ] **Payment-method dependency + fallback.** Deferred / charge-later selling plans require **Shop Pay / Shopify Payments** (Shopify vaults the card and charges the balance later without contacting the customer). Confirm, then build the **graceful fallback** (deposit-only / pay-now) for Mollie / Viva / Klarna-gateway stores. *Acceptance:* never a broken checkout. *(Blocks 9.3 / Phase 1.)*
- [ ] **EU BNPL as deposit.** Confirm Scalapay / Klarna / seQura can serve as the deposit/partial mechanism inside the selling-plan flow, or whether deposits must route through Shopify Payments. *(Blocks 9.3.)*
- [ ] **Charge-later trigger + uninstall behaviour.** Use `sellingPlanGroupCreate` with `category: PRE_ORDER`, `billingPolicy.fixed.checkoutCharge` (deposit) and `remainingBalanceChargeTrigger: ON_FULFILLMENT` (GA since **API 2026-01**) or `EXACT_TIME`. **Critical operational note:** Shopify **deletes `SellingPlanGroup`/`SellingPlan` records 48h after the app is uninstalled** — the `purge-uninstalled` job and any restore expectations must account for this. *Acceptance:* a deposit charges at checkout, the balance collects on fulfilment, and an order carries exactly one due date.
- [ ] **Discount compatibility** (top switching trigger). Verify preorder items apply **automatic discounts, discount codes, and Buy-X-Get-Y** correctly. *Acceptance:* preorder items are never silently excluded from a store's discounts.
- [ ] **No-oversell** proof against the configured limit, including the race when the limit is hit.

---

## 8. Definition of Ready (the gate to start building)

- [ ] §1–§3 collected; `.env` populated; `shopify app dev` installs cleanly on the **EU** dev store.
- [ ] Compliance webhooks return **200** on valid and **401** on invalid HMAC.
- [ ] Per-app Postgres reachable; first migration applied; only `APP_DB_URL__ENCORE` is touched.
- [ ] Lifecycle + GDPR webhooks confirmed forwarding to the Nova ingress.
- [ ] **All §7 spikes pass** (or are de-scoped with written sign-off).
- [ ] Build pack reviewed; every screen's acceptance criteria understood.

**Then:** open Claude Cowork on `github.com/nova-apps/encore`, attach `encore-BUILD-PACK.md`, and build screen by screen — a screen is done only when its acceptance boxes check (build order in build pack §5).

---

## Appendix — `.env` template

```dotenv
# ── Shopify app (per app) ───────────────────────────────
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=                 # secret · also the webhook HMAC key
SHOPIFY_APP_URL=https://encore.nova-platform.example
SCOPES=read_products,write_products,read_inventory,read_locations,read_orders,write_orders,read_markets,read_customers,read_themes

# ── Shopify org / CI ────────────────────────────────────
SHOPIFY_ORG_ID=4218705
SHOPIFY_CLI_PARTNERS_TOKEN=         # secret · CI only

# ── Nova platform wiring ────────────────────────────────
APP_DB_URL__ENCORE=                 # secret · isolated Postgres
APP_ENCRYPTION_KEY=                 # secret · encrypts offline tokens
NOVA_API=https://api.nova-apps.example
NOVA_INGRESS_HMAC_SECRET=           # secret
NOVA_INSTALL_CONFIRM_SECRET=        # secret

# ── ARRS recovery engine ────────────────────────────────
ARRS_API_BASE=
ARRS_API_KEY=                       # secret
```

---

### Senior-dev guidelines (keep these in view)

1. **Absorb complexity, never expose it.** Per-market logic, payment mandates, theme compatibility — hidden behind an All/Specific toggle and sane defaults. If a setting makes the merchant UI more complex, stop.
2. **Reliability beats features.** Idempotent webhooks, retry-safe charge jobs, verified-after-write tagging, confirmed waitlist delivery. The "must never" list (spec §13) is the bar.
3. **Least-privilege scopes.** Ship the nine; justify any addition against an Admin GraphQL call.
4. **Externalize every storefront string** from day one (i18n-ready); admin English-first but no hard-coded UI text.
5. **Never choose distribution early.** It's irreversible.
6. **Refuse scope.** Non-Goals (§6) and Out-of-Scope (§19) are binding; new ideas go to the parking lot, not into v1.
