/**
 * Client-safe market logic.
 *
 * `marketExperience` is a pure decision function the Per-market route renders, so
 * it must not live in a `*.server` module. Types are pulled with `import type`
 * (erased at build — never drags the server module into the client bundle).
 *
 * Per-market stock (2026-09-28): for a shopper in market M looking at variant V
 *   1. V has sellable stock at the locations that serve M → normal checkout
 *   2. else a matching Encore preorder is offered in M      → Preorder
 *   3. else                                                  → Sold out
 * `marketOutcome` is that decision; the storefront config, the checkout
 * metafield sync and the admin table all go through it.
 */
import type { MarketRow, MarketRuleData, PerMarketOverride } from "../models/markets.server";

// ---------- ids ----------

/** "gid://shopify/Market/123" | "123" → "123" (the storefront sends numeric ids). */
export function marketNum(id?: string | null): string {
  return id ? String(id).split("/").pop() || "" : "";
}

/** Same market, whatever id form each side uses. */
export function sameMarket(a?: string | null, b?: string | null): boolean {
  const x = marketNum(a);
  return !!x && x === marketNum(b);
}

/**
 * Look a market up in a record keyed by market id. The admin stores GID keys
 * (`gid://shopify/Market/1`), the storefront sends the numeric id (`1`).
 */
export function byMarket<T>(rec: Record<string, T> | null | undefined, marketId: string): T | undefined {
  if (!rec || !marketId) return undefined;
  if (rec[marketId] !== undefined) return rec[marketId];
  const n = marketNum(marketId);
  for (const k of Object.keys(rec)) if (marketNum(k) === n) return rec[k];
  return undefined;
}

/** More than one market on record (the snapshot holds one entry per market). */
export function isMultiMarket(rule: Pick<MarketRuleData, "marketSnapshot">): boolean {
  return Object.keys(rule.marketSnapshot ?? {}).length > 1;
}

/** Store-level scope: is preorder offered to shoppers in this market at all? */
export function marketInScope(rule: Pick<MarketRuleData, "scope" | "markets">, marketId: string): boolean {
  return rule.scope !== "SPECIFIC" || !marketId || rule.markets.some((m) => sameMarket(m, marketId));
}

// ---------- serving locations ----------

/**
 * Locations whose stock counts for a market, most specific first:
 *   1. the merchant's per-market location choice (Per-market rules)
 *   2. the last reconcile snapshot for the market
 *   3. every active location that fulfils online orders
 * (Shopify Markets does not expose which inventory locations fulfil a market
 * in Admin API 2026-07 — `Market.conditions.locationsCondition` is about
 * retail/POS markets — so there is no Shopify-side tier.)
 * Returns null when nothing is known (caller falls back to global stock).
 */
export function resolveServingLocations(
  marketId: string,
  rule: Pick<MarketRuleData, "perMarketOverrides" | "marketSnapshot">,
  fulfilling: string[] | null,
): string[] | null {
  const ov: PerMarketOverride | undefined = byMarket(rule.perMarketOverrides, marketId);
  if (ov?.locations && ov.locations.length) return [...ov.locations];
  const snap = byMarket(rule.marketSnapshot, marketId);
  if (snap && Array.isArray(snap.locations) && snap.locations.length) return [...snap.locations];
  if (fulfilling && fulfilling.length) return [...fulfilling];
  return null;
}

export type VariantMarketStock = {
  /** Sum of "available" at the serving locations; null = not tracked (always sellable). */
  stock: number | null;
  inStock: boolean;
};

/**
 * Sellable stock for one variant at a market's serving locations.
 * `available` maps location id → available quantity (missing = not stocked there).
 */
export function stockAtLocations(
  tracked: boolean,
  available: Record<string, number>,
  serving: string[],
): VariantMarketStock {
  if (!tracked) return { stock: null, inStock: true };
  let sum = 0;
  for (const loc of serving) {
    const q = available[loc];
    if (typeof q === "number" && Number.isFinite(q) && q > 0) sum += q;
  }
  return { stock: sum, inStock: sum > 0 };
}

// ---------- the decision ----------

export type MarketOutcome = "buy" | "preorder" | "soldout";

/**
 * What a shopper in a market gets for one variant.
 *   inStockHere: sellable stock at the market's serving locations (null = unknown
 *                → treated as in stock: Encore never blocks on missing data)
 *   offered:     a live Encore preorder covers the variant in this market
 *   forcePreorder: merchant's "Force preorder" for the market (preorder even
 *                with stock); always: the campaign shows preorder regardless of
 *                stock (presale mode)
 */
export function marketOutcome(
  inStockHere: boolean | null,
  offered: boolean,
  opts: { forcePreorder?: boolean; always?: boolean } = {},
): MarketOutcome {
  if (offered && (opts.forcePreorder || opts.always)) return "preorder";
  if (inStockHere !== false) return "buy";
  return offered ? "preorder" : "soldout";
}

/**
 * Case 3 as a flag: a variant Encore manages, with no stock at this market's
 * locations and no preorder offered here, must not be buyable here.
 */
export function isMarketBlocked(v: { managed: boolean; inStockHere: boolean | null; offered: boolean }): boolean {
  return v.managed && marketOutcome(v.inStockHere, v.offered) === "soldout";
}

/** Admin wording for one stock state (English — the route translates it). */
export function outcomeLabel(inStockHere: boolean, outcome: MarketOutcome): string {
  if (inStockHere) {
    return outcome === "preorder" ? "In stock here → Preorder" : "In stock here → normal checkout";
  }
  if (outcome === "preorder") return "Out of stock here → Preorder";
  if (outcome === "soldout") return "Out of stock here → Sold out";
  return "Out of stock here → normal checkout";
}

/**
 * Both lines of the Per-market table for a market: what a shopper there gets
 * when a preorder item is in stock at the market's locations, and when it isn't.
 */
export function marketStockWording(
  m: Pick<MarketRow, "id">,
  rule: Pick<MarketRuleData, "scope" | "markets" | "perMarketOverrides">,
): { inStock: string; outOfStock: string } {
  const offered = marketInScope(rule, m.id);
  const forcePreorder = !!byMarket(rule.perMarketOverrides, m.id)?.forcePreorder;
  return {
    inStock: outcomeLabel(true, marketOutcome(true, offered, { forcePreorder })),
    outOfStock: outcomeLabel(false, marketOutcome(false, offered, { forcePreorder })),
  };
}

/**
 * Resulting shopper experience for a market under a rule. Invariant: never
 * "Preorder" where sellable stock exists for that market (the negative test),
 * unless the merchant forces preorder there.
 */
export function marketExperience(
  m: MarketRow,
  rule: MarketRuleData,
): "Buy" | "Preorder" | "Off" {
  if (!marketInScope(rule, m.id)) return "Off"; // preorder not offered here
  const ov = byMarket(rule.perMarketOverrides, m.id);
  const snap = byMarket(rule.marketSnapshot, m.id);
  // No serving location can fulfil → nothing is in stock here.
  const inStockHere = snap && !snap.fulfillable ? false : m.stock != null ? m.stock > 0 : null;
  const out = marketOutcome(inStockHere, true, { forcePreorder: !!ov?.forcePreorder });
  return out === "preorder" ? "Preorder" : "Buy";
}
