# Encore — Notifications integration plan (Shopify Flow + Klaviyo)

> **Status: PLAN + RESEARCH only — nothing built yet.** Decide the open questions
> (§8) before implementation. Researched 2026‑06‑15 against current Shopify Flow +
> Klaviyo developer docs (sources at the bottom).

## 1. Goal & principle

Don't add to merchants' bill. Almost every store already runs **Shopify** (native
order/shipping emails) and **Klaviyo** (marketing email/SMS). So Encore stays a
**signal source + templates, not a mailer** — it never sends email itself. It (a)
enriches orders via **Shopify Flow** and (b) feeds **Klaviyo** rich preorder /
back‑in‑stock events + ready‑made flow templates, with copy the merchant can edit
and translate in Encore.

## 2. What we already have (don't rebuild)

- Shopify Flow **triggers**: `Preorder placed`, `Waitlist signup`, `Restock detected` + a `Tag order` **action**.
- Klaviyo: a `Back in Stock` **custom event** (we POST to `/api/events`).
- 8‑language **i18n catalog** (the copy engine) + a `klaviyoKey` in Settings.

## 3. Research findings (the decisive facts)

**Shopify Flow**
- An app can ship **Flow template extensions** — a pre‑built `.flow` workflow a merchant installs in one click. This is how we hand them a working preorder workflow.
- "Add preorder info to the order" needs no exotic code: Flow's **built‑in actions** (add order/customer **tags**, **order metafields**, **order note**) driven by our `Preorder placed` trigger payload. Our `Tag order` action supplements.
- Caveat: for a **listed** app, Flow extensions work on **any paid plan that has Flow installed**; for a **custom** app they're **Plus‑only**. Encore is a listed Nova app → fine, but the merchant must have the (free) Flow app installed.

**Klaviyo — events & metrics**
- POST an event with a metric name → if the metric is new, **Klaviyo auto‑creates it**. So `Encore Preorder Placed`, `Encore Balance Due`, etc. become metrics merchants build flows on, no setup.
- Top‑level event **properties** are segmentable **and** render in templates (`{{ event.ShipDateLabel }}`) — this is how our editable/translatable copy reaches the email.

**Klaviyo — back‑in‑stock (native)**
- Klaviyo has a **native Back‑in‑Stock subscription** API: `POST /api/back-in-stock-subscriptions` (server) / `/client/back-in-stock-subscriptions` (browser). The variant is a composite id `"$shopify:::$default:::<shopify_variant_id>"`.
- If the merchant runs Klaviyo's Shopify integration (catalog synced — most do), we can subscribe shoppers to **Klaviyo's own** BIS engine: built‑in dedupe, auto‑clear after notify, and it drives **Klaviyo's standard Back‑in‑Stock flow**. Cleaner than our custom event — but it requires the catalog + a BIS flow to exist in their Klaviyo.

**Klaviyo — can we set up their flows? (the make‑or‑break)**
- A **Create Flow** API exists but is **beta (`2024-10-15.pre`), explicitly "not for production"**, limited to a few patterns (abandonment / birthday / price‑drop), and **can't update a flow after creation**. → **Not a reliable way to auto‑build a merchant's flows today.**
- The production path is the **Klaviyo partner program**: as a listed integration you get **branded metrics** and can **submit Flow templates for your app**. So "we set up their Klaviyo flows" = **one‑click templates tied to our metrics**, not fragile API creation.

**Klaviyo — auth**
- **Private API key** (pasted) works for the single‑store MVP we have now.
- **OAuth is required** to list in Klaviyo's App Marketplace and to get branded metrics + flow templates (private‑key listing was deprecated mid‑2025). So productizing = build a Klaviyo **OAuth app**.

**Overlap to avoid:** Klaviyo's Shopify integration already syncs orders, customers, and the product **catalog**. We must **not** duplicate that — we only add **preorder‑specific** events/properties and ride their catalog for native BIS.

## 4. Proposed architecture — two tracks

### Track A — Shopify Flow (enrich the preorder order)
`Preorder placed` trigger → a shipped **Flow template** that, with built‑in actions:
- tags the order (`preorder`, `deposit`, market) + the customer,
- writes order **metafields** (`encore.ship_date`, deposit/balance, campaign, market),
- adds an **order note / timeline** line with the preorder summary.

Merchant installs the template in one click; everything downstream (their picking,
their Shopify emails that reference the metafields, their 3PL) now "sees" preorder
context. Ship 2–3 templates (enrich‑order, notify‑team, route‑to‑3PL).

### Track B — Klaviyo (customer comms)
**Events we emit** (auto‑become metrics; each carries localized copy props):

| Metric (event) | Fires when | Key properties |
|---|---|---|
| `Encore Preorder Placed` | preorder order created | product, variant, units, **ship date**, deposit, balance, currency, market, `*_Label` localized copy |
| `Encore Ship Date Updated` | cohort ship date changes | product, old/new ship date, market, localized copy |
| `Encore Balance Due` | charge‑later balance window opens | product, balance, due date, **pay link**, localized copy |
| `Encore Preorder Shipped` | fulfillment created | product, tracking, market |
| `Encore Waitlist Signup` | notify‑me submitted | product, variant, market |
| Back in stock | restock | **prefer native BIS subscription** (below); else `Encore Back in Stock` event |

**Back‑in‑stock:** when the merchant's Klaviyo has the Shopify catalog, **subscribe
via Klaviyo's native BIS** (`$shopify:::$default:::<variantId>`) so it rides their
BIS flow + dedupe. Otherwise fall back to our custom event. (Decision §8.)

**Flow templates (Klaviyo):** ship branded templates — Preorder confirmation,
Balance‑due reminder, Ship‑date update, Back‑in‑stock — so the merchant gets working
Klaviyo flows without building them. Requires the OAuth/partner listing (Phase B).

**Profiles:** add only preorder‑specific profile properties; let Klaviyo's Shopify
integration own the rest.

## 5. Editable + translatable copy (the "text control")

The email body lives in Klaviyo/Shopify, not in Encore — so Encore controls copy by
**passing it as data**:
- A **Notifications** tab in Encore Settings: per message type (preorder confirm,
  balance due, ship‑date, back‑in‑stock), editable **subject + key lines**, each
  **translatable per locale** via the existing i18n engine.
- Those strings ship as **event properties** localized to the **buyer's market**
  (`ShipDateLabel`, `PreorderMessage`, `BalanceDueLabel`…). The merchant's Klaviyo
  template just references `{{ event.PreorderMessage }}` → the shopper gets
  market‑correct copy even if the merchant built one flow.
- For **Shopify native** emails, the same values are written as **order metafields**
  the notification template can reference (only if the merchant customizes it).

Net: the merchant (and we) edit/translate copy in **one place (Encore)**; it renders
in both Klaviyo and Shopify without touching their templates.

## 6. Connection / auth plan

- **Phase A (now):** keep the **pasted private key** — fastest, already wired. Good enough for the pilot stores.
- **Phase B (productize):** build the **Klaviyo OAuth app**, list it, get **branded metrics** + **submit flow templates** → true one‑click onboarding. Required for the marketplace and for shipping Klaviyo flow templates.

## 7. Phasing (suggested)

| Phase | Scope | Auth |
|---|---|---|
| **N1 — Event foundation** | Expand Klaviyo events (preorder placed, balance due, ship‑date, shipped) + property schema + the Notifications/copy tab (editable, translatable) | private key |
| **N2 — Shopify Flow templates** | Ship the preorder‑enrichment Flow template(s); add any custom action the built‑ins can't cover | — |
| **N3 — Native back‑in‑stock** | Switch BIS to Klaviyo's native subscription where catalog exists; fallback to event; guided "build your BIS flow" help | private key |
| **N4 — OAuth + marketplace** | Klaviyo OAuth app, branded metrics, submit Klaviyo flow templates → one‑click setup | OAuth |

## 8. Open questions (decide before building)

1. **Native Klaviyo BIS vs our custom event** — do the pilot stores run Klaviyo's Shopify integration (so the catalog is synced)? If yes, native BIS is the better default.
2. **Private key now vs OAuth/marketplace** — invest in the Klaviyo OAuth app + listing now (unlocks branded metrics + flow templates), or ship N1–N3 on the pasted key first?
3. **v1 must‑have messages** — which of {preorder confirm, balance‑due reminder, ship‑date update, shipped, back‑in‑stock} are in scope first? (Note: balance‑due reminder also needs the **charge‑later job**, which isn't built yet — see PRE‑LAUNCH‑AUDIT flag.)
4. **SMS?** — Klaviyo supports SMS BIS/marketing but needs **explicit consent**; in scope or email‑only v1?
5. **Shopify Flow scope** — which templates to ship; is the "Flow installed / Plus for custom apps" caveat acceptable for the target merchants?

## 9. Risks

- Shopify Flow path needs the merchant to have **Flow installed** (free, but not universal).
- Native Klaviyo BIS needs the **catalog synced** in their Klaviyo.
- **Beta** Klaviyo Create‑Flow API is not production‑usable → we rely on **templates**, which need the **OAuth/partner** listing.
- **OAuth migration** is real engineering (Phase B).
- Keeping Encore‑edited copy and the Klaviyo/Shopify templates in sync — mitigated by passing copy as **properties/metafields**, not by editing their templates.

## 10. Recommendation

Start with **N1 (events + editable/translatable copy)** and **N2 (Shopify Flow
template)** on the **existing pasted key** — fast value, no new merchant cost, works
for the pilot. Use **Klaviyo native BIS** where the catalog exists. **Don't promise
auto‑building their Klaviyo flows** — deliver **templates**, and schedule the
**OAuth + marketplace** work (N4) for when we productize the Klaviyo listing.

---

### Sources
- Shopify — [About Flow](https://shopify.dev/docs/apps/build/flow), [Create a Flow template](https://shopify.dev/docs/apps/build/flow/templates/create-a-template), [Create a Flow action](https://shopify.dev/docs/apps/build/flow/actions/create)
- Klaviyo — [Events API overview](https://developers.klaviyo.com/en/reference/events_api_overview), [Create Event](https://developers.klaviyo.com/en/reference/create_event), [Custom Metrics API](https://developers.klaviyo.com/en/reference/custom_metrics_api_overview)
- Klaviyo — [Set up back in stock via API](https://developers.klaviyo.com/en/docs/how_to_set_up_custom_back_in_stock), [Create Back In Stock Subscription](https://developers.klaviyo.com/en/reference/create_back_in_stock_subscription)
- Klaviyo — [Flows API overview](https://developers.klaviyo.com/en/reference/flows_api_overview), [Create Flow (beta)](https://developers.klaviyo.com/en/reference/create_flow), [Submit flow templates for your app](https://developers.klaviyo.com/en/docs/submit_flow_templates_for_your_app)
- Klaviyo — [Authenticate API requests](https://developers.klaviyo.com/en/docs/authenticate_), [Create a public OAuth app](https://developers.klaviyo.com/en/docs/create_a_public_oauth_app), [Migrate to OAuth](https://developers.klaviyo.com/en/docs/migrate_to_oauth_from_private_key_authentication)
