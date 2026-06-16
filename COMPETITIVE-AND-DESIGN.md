# Encore — features, competitors & design guidelines

> Grounded in `preorder-app-spec.md` + `encore-project-charter.md` and live competitor research (June 2026).
> **Charter rule that governs this doc:** *more features is the failure mode.* We win on the wedge done
> reliably + a setup a non-technical merchant finishes in 2 minutes — NOT on out-featuring incumbents.

## 1. The app, feature by feature

### The wedge — 3 pillars (all required; removing one changes the product)
1. **Per-market preorder** — in-stock in one market, preorder in another. *(No competitor does this.)*
2. **Reliability where incumbents fail** — never oversell, never lose a tag, never break discounts.
3. **ARRS recovery on the waitlist** — captured demand runs through behavioural recovery, not a dumb email.

### P0 — must-have (v1)
| # | Feature | What the merchant sees |
|---|---|---|
| 9.1 | Auto-detect OOS + one-click enable | "We found 12 sold-out products → Enable preorder" |
| 9.2 | Per-market preorder *(flagship)* | All markets / Specific markets toggle |
| 9.3 | Payment options (pay-now / deposit / charge-later + EU BNPL) | Pick one; fallback if no Shop Pay |
| 9.4 | No-oversell guarantee | A unit limit; reverts to sold-out at the cap |
| 9.5 | Reliable tagging + ship-date + customer comms | Every order tagged, ship date sent |
| 9.6 | Discount compatibility | Works inside your existing discounts |
| 9.7 | Back-in-stock waitlist → ARRS | "Notify me" → behavioural recovery |
| 9.8 | Shopper localization | Storefront text in every active language/currency |
| 9.9 | Stable, isolated settings | Changing one setting never changes another |
| 9.10 | Flat, transparent pricing | No surprise per-order fees; stops on uninstall |
| 9.11 | Demand-signal view | Who wants what, by variant/size/market |

### Reliability bar — the "must never" list (a build that breaks any of these does not ship)
Never oversell · never create an untagged order · never break discounts · never alter an unrelated
setting · never silently fail a notification · never break checkout (graceful fallback) · never bill after uninstall.

### P1 (fast-follow, after the validation gate) · P2 (architect-for, don't build)
P1: charge-later auto-collection, drop scheduling, Spanish admin UI, advanced analytics.
P2: MCP transact-on-return, deeper ARRS cohorts, B2B preorder. **Do not build early.**

## 2. The competition (live, June 2026)

| App | Rating | Pricing | Strength | The gap we exploit |
|---|---|---|---|---|
| **STOQ** (benchmark) | ~5.0 · 2.9k | Free · $10 · $29 · $69 | Lean, fast setup, preorder + restock in one | Global inventory only; waitlist = plain alerts |
| **Amai PreOrder** | ~4.4 | tiered | Most features, auto-switch, scheduled campaigns | **Feature bloat → lowest rating** |
| **PreOrder Globo** | 4.9 · 1.8k | Free · $7–20 | Cheap, simple presales | Caps on free, generic, no per-market |
| **Timesact** | 4.9 · 1.9k | Free · ~$1–19 | Operational precision, tag automations | Single-market, no behavioural recovery |

**What they ALL share (table stakes — we match, don't beat):** preorder/notify button, deposits & partial
pay, unit limits, demand analytics, multi-language alerts.

**What NONE of them do (our wedge — where we win):**
- **In-stock here, preorder there** (per-market, reconciled to real inventory).
- **Waitlist → behavioural recovery** (ARRS), not a generic "back in stock" email.
- The lesson from Amai: **adding features lowered the rating.** Our edge is reliability + clarity, not count.

**Listing headline (the switching trigger):** *"Works with your discounts. Never oversells. Flat pricing. Preorder by market."*

## 3. Design guidelines — built for a non-technical merchant

The spec's design gate, made concrete. Apply to **every** screen:

1. **Two-minute setup, sane defaults.** A working preorder button before any required decision. Every
   setting has a default; decisions are *optional refinements*, never setup steps.
2. **Absorb complexity.** Hard logic (markets × inventory, payment mandates) lives in code; the merchant
   sees a **switch**, not Shopify internals. If a screen needs raw Shopify flags, redesign it.
3. **Plain language, outcome-first.** "Shoppers can reserve and pay later" — not "configure
   `remainingBalanceChargeTrigger`." Buttons say what happens ("Enable preorder", not "Submit").
4. **One primary action per screen.** Everything else is secondary. Don't make the merchant hunt.
5. **Show, don't tell.** Live preview of the storefront block; the dashboard shows proof (0 oversells, demand captured).
6. **Reliability is the brand.** Lead the dashboard with the "0 oversells / 0 untagged" guarantee — that's the switching trigger, made visible.
7. **Calm, professional, sparse.** Equal-width cards, real numbers, one trend chart — not a wall of widgets. Polaris look = native + trustworthy.
8. **Empty states teach.** "No preorders yet → scan your catalog" with the next action, not a blank page.

### Visual system
- **Recovery Green** as the accent (brand family), Polaris neutrals for everything else.
- KPI cards: equal width, full row, one number + one label + a small delta.
- One chart max per screen; charts explain a number, never decorate.

## 4. What "better than competitors" means here (alignment check)
Per the charter, "better" is **not** more features. It is: the **wedge** (per-market, reliability, ARRS)
delivered so reliably and so simply that a frustrated STOQ/Globo user switches and stays. Any feature idea
that isn't one of the three pillars goes to the parking lot (spec §19) — escalate before building.
