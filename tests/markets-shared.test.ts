/**
 * Per-market stock — the pure decision every surface shares (storefront config,
 * checkout guard, Per-market admin table).
 *   1. stock at the market's own locations → normal checkout
 *   2. else preorder offered in the market → Preorder
 *   3. else                                → Sold out
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../app/db.server", () => ({ default: {} }));

import {
  byMarket,
  isMarketBlocked,
  isMultiMarket,
  marketExperience,
  marketInScope,
  marketOutcome,
  marketStockWording,
  resolveServingLocations,
  sameMarket,
  stockAtLocations,
} from "../app/lib/markets-shared";
import type { MarketRow, MarketRuleData } from "../app/models/markets.server";
import {
  blockedNeedsWrite,
  buildStockQuery,
  parseBlockedValue,
  parseVariantNode,
  specificCovers,
  campaignAllowsMarket,
  variantPageSize,
  MAX_LOCATIONS,
} from "../app/models/market-stock.server";

const M1 = "gid://shopify/Market/1";
const M2 = "gid://shopify/Market/2";
const L_US = "gid://shopify/Location/10";
const L_EU = "gid://shopify/Location/20";

const rule = (over: Partial<MarketRuleData> = {}): MarketRuleData => ({
  scope: "ALL",
  markets: [],
  perMarketOverrides: {},
  marketSnapshot: {
    [M1]: { locations: [L_US], fulfillable: true },
    [M2]: { locations: [L_EU], fulfillable: true },
  },
  lastReconciledAt: null,
  ...over,
});
const market = (id: string, stock: number | null = null): MarketRow => ({
  id,
  name: id,
  handle: id,
  enabled: true,
  primary: id === M1,
  stock,
});

describe("marketOutcome", () => {
  it("in stock here → normal checkout, even when preorder is offered", () => {
    expect(marketOutcome(true, true)).toBe("buy");
    expect(marketOutcome(true, false)).toBe("buy");
  });
  it("out of stock here → Preorder when offered, else Sold out", () => {
    expect(marketOutcome(false, true)).toBe("preorder");
    expect(marketOutcome(false, false)).toBe("soldout");
  });
  it("unknown stock never blocks (falls back to Shopify)", () => {
    expect(marketOutcome(null, false)).toBe("buy");
  });
  it("force preorder / presale only apply where preorder is offered", () => {
    expect(marketOutcome(true, true, { forcePreorder: true })).toBe("preorder");
    expect(marketOutcome(true, true, { always: true })).toBe("preorder");
    expect(marketOutcome(true, false, { forcePreorder: true })).toBe("buy");
    expect(marketOutcome(false, false, { forcePreorder: true })).toBe("soldout");
  });
  it("isMarketBlocked only for managed variants in case 3", () => {
    expect(isMarketBlocked({ managed: true, inStockHere: false, offered: false })).toBe(true);
    expect(isMarketBlocked({ managed: false, inStockHere: false, offered: false })).toBe(false);
    expect(isMarketBlocked({ managed: true, inStockHere: false, offered: true })).toBe(false);
    expect(isMarketBlocked({ managed: true, inStockHere: true, offered: false })).toBe(false);
    expect(isMarketBlocked({ managed: true, inStockHere: null, offered: false })).toBe(false);
  });
});

describe("market ids", () => {
  it("matches GID and numeric forms", () => {
    expect(sameMarket(M1, "1")).toBe(true);
    expect(sameMarket("1", "2")).toBe(false);
    expect(sameMarket("", "")).toBe(false);
    expect(byMarket({ [M1]: "a" }, "1")).toBe("a");
    expect(byMarket({ "2": "b" }, M2)).toBe("b");
    expect(byMarket({ [M1]: "a" }, "3")).toBeUndefined();
  });
  it("scope: SPECIFIC limits preorder to the chosen markets", () => {
    expect(marketInScope(rule(), "2")).toBe(true);
    expect(marketInScope(rule({ scope: "SPECIFIC", markets: [M1] }), "1")).toBe(true);
    expect(marketInScope(rule({ scope: "SPECIFIC", markets: [M1] }), "2")).toBe(false);
  });
  it("multi-market = more than one market in the snapshot", () => {
    expect(isMultiMarket(rule())).toBe(true);
    expect(isMultiMarket(rule({ marketSnapshot: { [M1]: { locations: [], fulfillable: false } } }))).toBe(false);
    expect(isMultiMarket({ marketSnapshot: undefined as never })).toBe(false);
  });
});

describe("resolveServingLocations", () => {
  it("merchant's per-market locations win", () => {
    const r = rule({ perMarketOverrides: { [M2]: { locations: [L_US, L_EU] } } });
    expect(resolveServingLocations("2", r, [L_US])).toEqual([L_US, L_EU]);
  });
  it("then the reconcile snapshot", () => {
    expect(resolveServingLocations("2", rule(), [L_US])).toEqual([L_EU]);
  });
  it("then every online-fulfilling location", () => {
    expect(resolveServingLocations("3", rule(), [L_US, L_EU])).toEqual([L_US, L_EU]);
  });
  it("null when nothing is known", () => {
    expect(resolveServingLocations("3", rule(), null)).toBeNull();
    expect(resolveServingLocations("3", rule(), [])).toBeNull();
  });
  it("an empty override or snapshot falls through", () => {
    const r = rule({
      perMarketOverrides: { [M2]: { locations: [] } },
      marketSnapshot: { [M2]: { locations: [], fulfillable: false } },
    });
    expect(resolveServingLocations("2", r, [L_US])).toEqual([L_US]);
  });
});

describe("stockAtLocations", () => {
  it("sums available at the serving locations only", () => {
    expect(stockAtLocations(true, { [L_US]: 5, [L_EU]: 0 }, [L_EU])).toEqual({ stock: 0, inStock: false });
    expect(stockAtLocations(true, { [L_US]: 5, [L_EU]: 2 }, [L_US, L_EU])).toEqual({ stock: 7, inStock: true });
  });
  it("ignores negative (oversold) quantities", () => {
    expect(stockAtLocations(true, { [L_US]: -3, [L_EU]: 1 }, [L_US, L_EU])).toEqual({ stock: 1, inStock: true });
  });
  it("untracked variants are always sellable", () => {
    expect(stockAtLocations(false, {}, [L_EU])).toEqual({ stock: null, inStock: true });
  });
});

describe("marketExperience (admin badge) keeps its contract", () => {
  it("Off outside scope, Preorder when forced / unfulfillable / no stock, else Buy", () => {
    const r = rule({ scope: "SPECIFIC", markets: [M1] });
    expect(marketExperience(market(M2), r)).toBe("Off");
    expect(marketExperience(market(M1), r)).toBe("Buy");
    expect(marketExperience(market(M1, 0), r)).toBe("Preorder");
    expect(marketExperience(market(M1, 4), r)).toBe("Buy");
    expect(
      marketExperience(market(M1), { ...r, perMarketOverrides: { [M1]: { forcePreorder: true } } }),
    ).toBe("Preorder");
    expect(
      marketExperience(market(M1), { ...r, marketSnapshot: { [M1]: { locations: [], fulfillable: false } } }),
    ).toBe("Preorder");
  });
});

describe("marketStockWording", () => {
  it("preorder market: out of stock here → Preorder", () => {
    expect(marketStockWording(market(M1), rule())).toEqual({
      inStock: "In stock here → normal checkout",
      outOfStock: "Out of stock here → Preorder",
    });
  });
  it("market without preorder: out of stock here → Sold out", () => {
    expect(marketStockWording(market(M2), rule({ scope: "SPECIFIC", markets: [M1] }))).toEqual({
      inStock: "In stock here → normal checkout",
      outOfStock: "Out of stock here → Sold out",
    });
  });
  it("forced market: preorder even in stock", () => {
    const w = marketStockWording(market(M1), rule({ perMarketOverrides: { [M1]: { forcePreorder: true } } }));
    expect(w.inStock).toBe("In stock here → Preorder");
  });
});

describe("inventory query", () => {
  it("reads one aliased level per serving location, within the cost budget", () => {
    const q = buildStockQuery("product", 2);
    expect(q).toContain("$l0: ID!, $l1: ID!");
    expect(q).toContain('l1: inventoryLevel(locationId: $l1) { quantities(names: ["available"]) { name quantity } }');
    expect(q).toContain('metafield(namespace: "encore", key: "market_blocked")');
    expect(q).not.toContain("$l2");
    expect(buildStockQuery("variants", 1)).toContain("nodes(ids: $ids)");
    for (let k = 1; k <= MAX_LOCATIONS; k++) {
      const n = variantPageSize(k);
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n * (3 + 2 * k)).toBeLessThanOrEqual(1000);
    }
  });
  it("parses levels (missing level = 0) and the stored block", () => {
    const v = parseVariantNode(
      {
        id: "gid://shopify/ProductVariant/7",
        product: { id: "gid://shopify/Product/42" },
        blocked: { value: '{"m":["2"],"until":"2026-10-01"}' },
        inventoryItem: {
          tracked: true,
          l0: { quantities: [{ name: "available", quantity: 4 }] },
          l1: null,
        },
      },
      [L_US, L_EU],
    );
    expect(v).toEqual({
      id: "7",
      productId: "42",
      tracked: true,
      available: { [L_US]: 4, [L_EU]: 0 },
      blocked: { m: ["2"], until: "2026-10-01" },
    });
  });
});

describe("encore.market_blocked value", () => {
  const now = new Date("2026-09-28T12:00:00Z");
  it("parses the object form and the bare array", () => {
    expect(parseBlockedValue('{"m":["gid://shopify/Market/2"],"until":"2026-09-30"}')).toEqual({
      m: ["2"],
      until: "2026-09-30",
    });
    expect(parseBlockedValue('["3"]')).toEqual({ m: ["3"], until: "" });
    expect(parseBlockedValue("nope")).toBeNull();
    expect(parseBlockedValue(null)).toBeNull();
  });
  it("writes only on change or near expiry; deletes when nothing is blocked", () => {
    expect(blockedNeedsWrite(null, [], now)).toBe(false);
    expect(blockedNeedsWrite({ m: ["2"], until: "2026-09-30" }, [], now)).toBe(true);
    expect(blockedNeedsWrite(null, ["2"], now)).toBe(true);
    expect(blockedNeedsWrite({ m: ["2"], until: "2026-09-30" }, ["2"], now)).toBe(false);
    expect(blockedNeedsWrite({ m: ["2"], until: "2026-09-29" }, ["2"], now)).toBe(true);
    expect(blockedNeedsWrite({ m: ["2"], until: "2026-09-30" }, ["2", "3"], now)).toBe(true);
  });
});

describe("campaign coverage", () => {
  const c = (over: Record<string, unknown> = {}) =>
    ({
      id: "c",
      status: "LIVE",
      productMode: "SPECIFIC",
      productIds: '["gid://shopify/Product/42"]',
      variantConfigs: "[]",
      maxPerCampaign: null,
      startDate: null,
      endDate: null,
      markets: "[]",
      ...over,
    }) as never;
  it("covers the whole product without variant rows, else only its rows", () => {
    expect(specificCovers(c(), "42", "7")).toBe("product");
    expect(specificCovers(c(), "43", "7")).toBeNull();
    const rows = c({
      variantConfigs: JSON.stringify([{ productId: "gid://shopify/Product/42", variantId: "gid://shopify/ProductVariant/8" }]),
    });
    expect(specificCovers(rows, "42", "7")).toBeNull();
    expect(specificCovers(rows, "42", "8")).toMatchObject({ variantId: "gid://shopify/ProductVariant/8" });
  });
  it("campaign market targeting ([] = every market)", () => {
    expect(campaignAllowsMarket({ markets: "[]" }, "2")).toBe(true);
    expect(campaignAllowsMarket({ markets: JSON.stringify([M1]) }, "2")).toBe(false);
    expect(campaignAllowsMarket({ markets: JSON.stringify([M1]) }, "1")).toBe(true);
  });
});
