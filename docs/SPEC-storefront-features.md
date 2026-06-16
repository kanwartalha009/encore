# Encore — Storefront Features & Localization Spec

**Pre‑order properties · Back in stock · Low stock · Localization**
Version 0.1 — Draft · June 2026 · Owner: Kanwar

---

## 1. Summary

Four feature areas, plus the shared foundation they all need. Three of the four are customer‑facing and depend on a **theme app extension** and **Admin API integration** that don't exist yet — so the real first step is the foundation, after which each feature is small.

**In scope**

1. Pre‑order line‑item properties (label + ship date through cart/checkout)
2. Back in stock — notify‑me (replaces "Waitlist")
3. Low stock display (new)
4. Localization (kept deliberately simple)

**Out of scope (separate tracks):** real payment capture, Shopify selling‑plan creation, SMS sending, and full multi‑language admin beyond a shipped set of languages.

**Decisions locked (this round)**

- Pre‑order **wins** over notify‑me when an out‑of‑stock product is in a live pre‑order rule.
- On restock, **notify everyone** waiting (not first‑come).
- Localization stays **simple and not per‑market** (per‑market storefront translation confuses shoppers).

---

## 2. Foundation (build first — blocks most of the rest)

| ID | Item | Why it's needed |
|----|------|-----------------|
| F1 | **Theme app extension** (app embed + app blocks) | The storefront surface for the pre‑order button, line‑item properties, notify‑me button + popup, and low‑stock block. App‑embed‑only, zero theme‑code injection, clean uninstall (PRD wedge 4). |
| F2 | **Admin API layer** (`admin.graphql`) | Fetch the store's locales (`shopLocales`), product tags/collections, live inventory; register translations; create/sync customers. The app makes no Admin API calls today. |
| F3 | **App proxy / App Bridge endpoints** | Receive notify‑me submissions; optionally serve live inventory. |
| F4 | **Restock webhook** | Subscribe `inventory_levels/update` (+ `products/update`) to detect back‑in‑stock and drive low‑stock thresholds. Currently only `app/uninstalled` + `app/scopes_update` are subscribed. |
| F5 | **Email / sync path** | Klaviyo (events/lists) first; Shopify customer sync; own ESP as fallback. Sending is currently stubbed. |
| F6 | **Consent + GDPR / PCD** | Collecting emails for marketing requires marketing‑consent capture, the GDPR compliance webhooks (currently commented out), and Protected Customer Data approval. Must precede real email capture. |

---

## 3. Pre‑order line‑item properties

**Goal:** a pre‑order item carries a visible "Pre‑order" label and ship date through cart → checkout → order.

- **Visible** properties (no leading underscore — Shopify shows these): `Pre-order: Yes` (or the badge label), `Ships: <date or fallback>`.
- **Hidden** properties (leading underscore — Shopify hides these): `_preorder_campaign_id` (already read by the orders webhook), `_encore_variant`.
- **Set at add‑to‑cart** by the theme extension (hidden inputs on the ATC form) and/or Cart Transform.
- **Ship‑date value:** from the pre‑order's ship date or the per‑variant availability dates; uses the `{{shipping_date}}` template, falling back to the no‑date message when empty.
- **Reconcile with the "Pre‑order model" setting:** in *selling‑plan* mode the plan carries the pre‑order nature + deferred payment and the property is display‑only; in *legacy* mode the properties carry it.
- **Reliability:** properties are client‑set and tamperable; the orders webhook already falls back to server‑side product matching — keep that.

**Acceptance:** cart, checkout, and the order in admin all show "Pre‑order" + ship date on the line; in‑stock items in the same cart are unaffected.

---

## 4. Back in stock (notify me) — replaces "Waitlist"

Rename **Waitlist → "Back in stock"** across the UI (nav + page). The `WaitlistSubscription` model stays (it already has email/phone/channel/subscribed/notifiedAt/convertedAt).

### Storefront behaviour

- When a variant is **out of stock**, *not excluded*, and *not in a live pre‑order rule* (pre‑order wins), replace/append the ATC with **"Notify me when back in stock."**
- Click → **popup**: email (and optional phone), product info (image, title, variant), consent line, submit. Position, fields, and design are configurable.
- Submit → app‑proxy endpoint → create/**dedupe** a `WaitlistSubscription`.

### Precedence (decided)

Out‑of‑stock product **in a live pre‑order rule → Pre‑order button.** Otherwise, if back‑in‑stock is enabled and the product isn't excluded → **Notify me.**

### Exclusions

Store owner excludes products by **tag(s)** or **collection(s)** (e.g. "archived"). Eligibility resolved in the theme (Liquid exposes product tags/collections) and/or via Admin API. Shared "exclusion engine" reused by low‑stock.

### Restock → notify (decided: everyone)

- `inventory_levels/update` → when a subscribed variant goes 0 → >0, notify **all** active subscribers for that variant, then set `notifiedAt`.
- *Note:* "everyone" can oversell when restock is small — accepted for now; a cap is a later option.
- **Sending:**
  - **Klaviyo (primary):** push the profile + a "Back in Stock" event / list subscription with the variant as a property; the merchant's Klaviyo flow sends the email.
  - **Shopify:** create/tag the customer and add to a segment. Caveat: **Shopify Email has no native back‑in‑stock trigger**, so either *we* send on restock (own ESP) or the merchant sends manually — be explicit in the UI.
- Track `convertedAt` when a notified shopper purchases (recovery attribution; the Back‑in‑stock screen already shows recovery rate).

### Design settings (admin)

Button text, popup text/fields, product‑info toggles, **position** (replace ATC / below ATC / inline), preset designs + custom CSS + **live preview** (same pattern as the pre‑order Design section).

### Consent, dedupe, double opt‑in — explained

- **Dedupe:** keep **one** subscription per `(email + variant)`. If a shopper clicks "notify me" three times, you store it once and send one email — never three. Always on.
- **Double opt‑in (optional toggle):** after they enter their email, send a "confirm your email" message and only activate the subscription once they click confirm.
  - *Pros:* proves the email is real, records explicit consent, protects deliverability and GDPR.
  - *Cons:* extra step, so fewer people complete it.
  - **Recommendation:** default to **single opt‑in** (low friction; a notify‑me is near‑transactional) with **dedupe always on**, and offer **double opt‑in as a toggle** for strict markets (EU).

---

## 5. Low stock display (new)

**Goal:** when a variant's available inventory is at/below a threshold, show a configurable "low stock" block with the live available count.

- **Trigger:** show only when `0 < available ≤ threshold` (default **10**, configurable). Hidden above the threshold and when out of stock (that's notify‑me / pre‑order).
- **Live inventory:** read at page load from Liquid (`variant.inventory_quantity` when inventory is tracked) — accurate per render. Truly live in‑session updates are an optional app‑proxy / Storefront‑API poll (enhancement; default = on‑load value).
- **Exclusions:** reuse the tag/collection exclusion engine.

### Preset designs (pick one, then tweak CSS) — research‑backed

1. **Text only** — "Only {n} left" / "Low stock — {n} left".
2. **Progress bar + text** — bar (available vs threshold) with "Only {n} left". *(Most popular pattern.)*
3. **Segmented/stepped bar** — discrete segments draining as stock drops.
4. **Urgency pill/badge** — "Selling fast" or a "{n} left" pill.
5. **Color‑threshold** — the bar/text shifts green → amber → red as stock falls.
6. **Animated/pulse bar** — option for emphasis.

Each preset exposes: editable text with variables (`{n}` / `{available}` / `{threshold}`), colours, a **custom CSS** box, and a **live preview** (same component as our Design section). Default placement: PDP near price/ATC; optional collection cards.

### Settings (admin)

Enable toggle · threshold · preset choice · text templates · colours · position · custom CSS · exclusions (tags/collections).

---

## 6. Localization (simple — not per‑market)

Keep it simple. **No per‑market translation** — shoppers in one market seeing market‑specific copy is confusing. Two independent layers:

- **Admin app language:** auto‑follow the **logged‑in staff user's** Shopify admin locale; ship a fixed set (EN + a few priority languages) with **English fallback**. (Needs i18n wiring — string extraction → catalogs → load matching Polaris locale; larger track, can phase.)
- **Storefront strings** (pre‑order button/badge, cart labels, notify‑me popup, low‑stock text): the merchant enters translations for the store's **published locales** (fetched via `shopLocales`), and we **register them through Shopify's Translation API** (`translationsRegister`) so they switch with the buyer's language and coexist with Translate & Adapt / langify. (DB‑only storage would not plug into Shopify's storefront language switch.)
- **Emails:** per‑language templates — phase 2.

One simple "Translations" screen: our storefront strings × the store's locales. No market coupling.

---

## 7. Data model changes (Prisma)

- **`BackInStockSettings`** (per shop): `enabled`, button/popup text + fields, `position`, `preset`, `css`, `exclusions {tags[], collections[]}`, `syncTarget` (none | shopify | klaviyo), `doubleOptIn`.
- **`WaitlistSubscription`** (extend): add `consent`, `source`, `locale`; add a unique constraint `(shop, variantId, email)` for dedupe. (`notifiedAt`, `convertedAt` already exist.)
- **`LowStockSettings`** (per shop): `enabled`, `threshold`, `preset`, text templates, colours, `position`, `css`, `exclusions`.
- **Localization:** prefer Shopify Translation API registration + a small cache table; optional `Translation (shop, key, locale, value)` for editing.
- **Pre‑order properties:** no new model (derived from campaign + variant).
- **Shared exclusion engine:** one `{tags[], collections[]}` shape used by back‑in‑stock and low‑stock.

---

## 8. Admin UI changes

- Rename **Waitlist → Back in stock**; add its design/popup/position/exclusions/sync settings + live preview.
- New **Low stock** settings (preset gallery + preview + CSS + threshold + exclusions).
- New **Translations** screen (locales × storefront strings).
- Settings: pre‑order property toggles; admin‑language note.

---

## 9. Open decisions / risks

- "Everyone notified" can oversell on a small restock — accepted; revisit a cap.
- Live low‑stock = on‑load by default; in‑session polling is an enhancement.
- Admin i18n: which languages ship first (and the ongoing translation cost).
- Shopify‑vs‑Klaviyo restock sending — Klaviyo is the clean path; Shopify Email can't auto‑trigger.
- PCD approval timeline gates real email capture.

---

## 10. Recommended build order

1. **Theme app extension** scaffold (app embed + app blocks) + app‑proxy endpoints. *(Unblocks everything below.)*
2. **Pre‑order button + line‑item properties** (reuses the existing orders webhook).
3. **Back in stock** — button/popup + capture + restock webhook + Klaviyo sync.
4. **Low stock** block — presets + live inventory.
5. **Localization** — storefront strings via the Translation API; admin i18n as a later track.
6. **Consent / GDPR / PCD** hardening.

---

*Sources for low‑stock patterns: Shopify App Store urgency/low‑stock apps (Hey!Scarcity, Stock Sheep, Urgency King, Scarcity++), Shopify Urgency & Scarcity guides (2026).*
