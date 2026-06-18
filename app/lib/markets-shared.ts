/**
 * Client-safe market logic.
 *
 * `marketExperience` is a pure decision function the Per-market route renders, so
 * it must not live in a `*.server` module. Types are pulled with `import type`
 * (erased at build — never drags the server module into the client bundle).
 */
import type { MarketRow, MarketRuleData } from "../models/markets.server";

/**
 * Resulting shopper experience for a market under a rule. Invariant: never
 * "Preorder" where sellable stock exists for that market (the negative test).
 */
export function marketExperience(
  m: MarketRow,
  rule: MarketRuleData,
): "Buy" | "Preorder" | "Off" {
  const inScope = rule.scope === "ALL" || rule.markets.includes(m.id);
  if (!inScope) return "Off"; // preorder not offered here
  const ov = rule.perMarketOverrides[m.id];
  if (ov?.forcePreorder) return "Preorder"; // merchant: no local stock in this market
  const snap = rule.marketSnapshot[m.id];
  if (snap && !snap.fulfillable) return "Preorder"; // no serving location can fulfil
  if (m.stock != null && m.stock <= 0) return "Preorder";
  return "Buy"; // sellable stock exists → never preorder
}
