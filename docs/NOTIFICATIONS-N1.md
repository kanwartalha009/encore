# Notifications N1 — provider choice + Shopify Flow / Klaviyo paths

Built 2026‑06‑15. Implements the plan in `NOTIFICATIONS-INTEGRATION-PLAN.md`.
Contract entry `CC-2026-06-15-04`. tsc clean (1 baseline). Additive only — **no new
scopes**.

## The model

Merchant picks a **provider** in **Settings → Notifications** (`/app/notifications`):

- **Klaviyo** — Encore posts events (`Back in Stock`, `Encore Preorder Placed`) with the editable copy as properties (`EmailSubject` / `EmailBody`); the merchant's Klaviyo flow sends the email.
- **Shopify Flow** — Encore fires a per‑customer trigger; the merchant's workflow emails the customer via the **"Encore — Send email"** action, which Encore sends (Shopify's built‑in Flow email is staff‑only, so Encore does the sending).
- **Off** — no automated customer email.

The **copy is edited + translated once in Encore** (per message type, per language)
and feeds both paths — so the customer gets market‑correct copy without anyone
touching Klaviyo/Shopify templates.

## What shipped

| Piece | File |
|---|---|
| Email templates (4 types, defaults, resolve+render, provider) | `app/services/notifications.server.ts` |
| Transactional transport (env‑pluggable, FAILED‑if‑unconfigured) | `app/services/email.server.ts` |
| Klaviyo event helper | `app/services/klaviyo.server.ts` |
| "Send email" Flow action endpoint | `app/routes/flow.send-email.tsx` |
| "Send email" action extension | `extensions/encore-flow-send-email/` |
| Per‑customer triggers | `extensions/encore-flow-{back-in-stock-ready,ship-date-updated,balance-due}/` |
| Provider routing (back‑in‑stock) + Klaviyo copy props | `app/services/waitlist-notify.server.ts` |
| Klaviyo "Preorder Placed" event | `app/routes/webhooks.orders.create.tsx` |
| Notifications settings screen + nav | `app/routes/app.notifications.tsx`, `app/routes/app.tsx` |
| `AppSettings.notifications` section | `prisma/schema.prisma`, `app/models/settings.server.ts` |

## Message coverage

| Message | Shopify‑Flow path | Klaviyo path | Status |
|---|---|---|---|
| **Back in stock** | per‑customer trigger `back-in-stock-ready` → Send email | `Back in Stock` event + copy | ✅ **live** (non‑PCD; fires on `products/update` restock) |
| **Preorder confirmation** | existing `Preorder placed` trigger → Send email | `Encore Preorder Placed` event + copy | ✅ wired · **dormant until PCD** enables `orders/*` |
| **Ship‑date update** | per‑customer `ship-date-updated` trigger → Send email | `Encore Ship Date Updated` event + copy | ✅ **wired** (N1b) — fires on a campaign ship‑date change (`app.campaigns.$id.edit`) per affected customer |
| **Balance due** | per‑customer `balance-due` trigger → Send email | `Encore Balance Due` event + copy | ✅ **wired** (N1b) — `POST /cron/balance-reminders` (token‑guarded) reminds once per pre‑order in the balance window. The charge itself stays Shopify‑native (selling plan). |

## Mac / deploy steps

1. `npx prisma db push` — adds `AppSettings.notifications`, `WaitlistSubscription.locale`, `PreOrder.balanceRemindedAt`.
2. `shopify app deploy` — registers the new action + 3 triggers (5 Flow extensions total now). Also schedule `POST /cron/balance-reminders` (daily, `ENCORE_CRON_SECRET`) alongside the purge cron.
3. Set the **transport env** if any pilot store uses the Shopify‑Flow provider:
   `ENCORE_EMAIL_API_KEY`, `ENCORE_EMAIL_FROM` (+ optional `ENCORE_EMAIL_API_URL`).
   The default targets a Resend‑style API — swap the URL/body in `email.server.ts`
   for SendGrid/Postmark/SES. **Unconfigured → emails are marked FAILED with a
   reason, never silently dropped.**
4. **Flow templates** (`.flow`) are authored in the Flow editor and exported, then
   added as a Flow **template extension** (can't be hand‑written here). Build one
   per use case: *Restock → email shopper*, *Preorder placed → email customer*,
   *Ship‑date updated → email customer*. Each: our trigger → **Encore — Send email**
   (set `message_type`, map `recipient` + variables).

## N1b (2026‑06‑15) — ship‑date, balance‑due, locale

- **Ship‑date update** — `notify-events.server.ts` `notifyShipDateChanged`; the campaign edit action snapshots the ship date and notifies each affected pre‑order customer on change (Flow trigger or Klaviyo event, by provider).
- **Balance‑due** — `remindBalancesDue` + `POST /cron/balance-reminders` (token‑guarded, daily): reminds each pre‑order in the balance window once (idempotent via `PreOrder.balanceRemindedAt`). The actual charge stays Shopify‑native (selling‑plan billing policy); this only sends the heads‑up.
- **Buyer locale** — captured at signup (`WaitlistSubscription.locale`, from `data‑locale` via `proxy.notify`); back‑in‑stock copy now resolves in the shopper's language for both providers.

## N3 + N4 (2026‑06‑15) — native BIS, Klaviyo OAuth, order locale

- **Klaviyo native back‑in‑stock** — Settings → Notifications has a back‑in‑stock **mode** (Encore events | Klaviyo native). Native subscribes the shopper to Klaviyo's own BIS at signup (`subscribeBackInStock`, composite `$shopify:::$default:::<variantId>`); the restock dispatch then defers to Klaviyo's flow.
- **Klaviyo OAuth** — "Connect Klaviyo" → `/klaviyo/connect` (PKCE, signed cookie) → `/klaviyo/callback`; token encrypted at rest (`KlaviyoConnection`, `app/lib/crypto.server.ts`) + auto‑refresh. All Klaviyo calls prefer the OAuth bearer over the pasted key. Needs `ENCORE_KLAVIYO_CLIENT_ID/SECRET` + the Klaviyo app registration.
- **Order locale** — `PreOrder.locale` captured from `order.customer_locale`; preorder / ship‑date / balance emails now resolve in the buyer's language.

## Remaining (external / Klaviyo-side)

- Register the **Klaviyo OAuth app** (developers.klaviyo.com) + redirect `{APP_URL}/klaviyo/callback`; then submit for the **App Marketplace** + **branded metrics** + **flow templates** (Klaviyo review).
- Export the `.flow` **template files** in the Flow editor (`extensions/encore-flow-templates/README.md`).
