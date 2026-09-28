/**
 * Per-market stock in the storefront config + the checkout-guard metafield sync.
 * Scenario (the merchant's words): "market 1 preorder, market 2 if actual stock
 * available fine, otherwise sold out" — US warehouse serves market 1, EU
 * warehouse serves market 2, the preorder campaign targets market 1 only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const campaignFindMany = vi.fn();
vi.mock("../app/db.server", () => ({
  default: { campaign: { findMany: (...a: unknown[]) => campaignFindMany(...a) } },
}));
vi.mock("../app/models/settings.server", () => ({
  getSettings: vi.fn(async () => ({ general: {}, lowStock: {}, backInStock: {} })),
  getTranslations: vi.fn(async () => ({})),
}));
const capacity = vi.fn(async () => ({ soldOut: false, remaining: null as number | null }));
vi.mock("../app/models/capacity.server", () => ({
  getCampaignCapacity: () => capacity(),
}));
const M1 = "gid://shopify/Market/1";
const M2 = "gid://shopify/Market/2";
const L_US = "gid://shopify/Location/10";
const L_EU = "gid://shopify/Location/20";
let rule: Record<string, unknown> = {};
vi.mock("../app/models/markets.server", () => ({
  getMarketRule: vi.fn(async () => rule),
  fetchLocations: vi.fn(async () => [
    { id: L_US, name: "US", active: true, fulfills: true },
    { id: L_EU, name: "EU", active: true, fulfills: true },
  ]),
  reconcileMarkets: vi.fn(async () => ({ markets: [], locations: [], unreadable: true })),
}));
vi.mock("../app/services/usage.server", () => ({
  isOverPreorderLimit: vi.fn(async () => false),
}));

import { getStorefrontConfig } from "../app/models/storefront.server";
import { clearMarketStockCache, syncMarketBlocks } from "../app/models/market-stock.server";

const P = "gid://shopify/Product/42";
const V_EU_STOCK = "gid://shopify/ProductVariant/1"; // stock only in the EU warehouse
const V_US_STOCK = "gid://shopify/ProductVariant/2"; // stock only in the US warehouse
const V_UNTRACKED = "gid://shopify/ProductVariant/3";

const campaign = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  shop: "s.myshopify.com",
  status: "LIVE",
  productMode: "SPECIFIC",
  productIds: JSON.stringify([P]),
  variantConfigs: "[]",
  markets: JSON.stringify([M1]),
  triggerType: "STOCK",
  startDate: null,
  endDate: null,
  shipDate: null,
  ctaLabel: "Preorder",
  ctaPlacement: null,
  deliveryNote: "",
  maxPerCampaign: null,
  updatedAt: new Date(),
  ...over,
});

const stock: Record<string, Record<string, number>> = {
  [V_EU_STOCK]: { [L_US]: 0, [L_EU]: 5 },
  [V_US_STOCK]: { [L_US]: 3, [L_EU]: 0 },
};

function variantNode(id: string, locs: string[], blocked: string | null = null) {
  const item: Record<string, unknown> = { tracked: id !== V_UNTRACKED };
  locs.forEach((l, i) => {
    const q = stock[id]?.[l];
    item[`l${i}`] = q == null ? null : { quantities: [{ name: "available", quantity: q }] };
  });
  return { id, product: { id: P }, blocked: blocked ? { value: blocked } : null, inventoryItem: item };
}

function makeAdmin(existingBlocked: Record<string, string> = {}) {
  const calls: { query: string; variables?: Record<string, unknown> }[] = [];
  const admin = {
    graphql: vi.fn(async (query: string, opts?: { variables?: Record<string, unknown> }) => {
      calls.push({ query, variables: opts?.variables });
      const vars = opts?.variables ?? {};
      const locs = Object.keys(vars)
        .filter((k) => /^l\d+$/.test(k))
        .sort()
        .map((k) => String(vars[k]));
      if (query.includes("EncoreMarketStock(")) {
        return Response.json({
          data: {
            product: {
              variants: {
                nodes: [V_EU_STOCK, V_US_STOCK, V_UNTRACKED].map((v) => variantNode(v, locs, existingBlocked[v] ?? null)),
              },
            },
          },
        });
      }
      if (query.includes("EncoreMarketStockVariants")) {
        return Response.json({
          data: { nodes: (vars.ids as string[]).map((v) => variantNode(v, locs, existingBlocked[v] ?? null)) },
        });
      }
      return Response.json({ data: { metafieldsSet: { userErrors: [] }, metafieldsDelete: { userErrors: [] } } });
    }),
  };
  return { admin, calls };
}

const multiRule = (over: Record<string, unknown> = {}) => ({
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

beforeEach(() => {
  clearMarketStockCache();
  campaignFindMany.mockReset();
  capacity.mockReset();
  capacity.mockResolvedValue({ soldOut: false, remaining: null });
  rule = multiRule();
});

describe("getStorefrontConfig — per-market stock", () => {
  it("single-market shop: no Admin API calls, old shape plus empty market fields", async () => {
    rule = multiRule({ marketSnapshot: { [M1]: { locations: [L_US], fulfillable: true } } });
    campaignFindMany.mockResolvedValue([campaign({ markets: "[]" })]);
    const { admin, calls } = makeAdmin();
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en", "1", admin);
    expect(calls).toHaveLength(0);
    expect(cfg.marketStock).toBeNull();
    expect(cfg.marketSoldOut).toEqual([]);
    expect(cfg.preorder?.trigger).toBe("stock");
  });

  it("no market id from the storefront: no lookups", async () => {
    campaignFindMany.mockResolvedValue([campaign()]);
    const { admin, calls } = makeAdmin();
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en", "", admin);
    expect(calls).toHaveLength(0);
    expect(cfg.marketStock).toBeNull();
  });

  it("products Encore doesn't manage: no lookups", async () => {
    campaignFindMany.mockResolvedValue([campaign({ productIds: '["gid://shopify/Product/99"]' })]);
    const { admin, calls } = makeAdmin();
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en", "2", admin);
    expect(calls).toHaveLength(0);
    expect(cfg.marketSoldOut).toEqual([]);
  });

  it("market 2 (no preorder there): EU stock buys, US-only stock is sold out", async () => {
    campaignFindMany.mockResolvedValue([campaign()]);
    const { admin, calls } = makeAdmin();
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en", "2", admin);
    expect(cfg.preorder).toBeNull(); // campaign targets market 1 only
    expect(cfg.marketStock).toEqual({
      "1": { stock: 5, inStock: true },
      "2": { stock: 0, inStock: false },
      "3": { stock: null, inStock: true },
    });
    expect(cfg.marketSoldOut).toEqual(["2"]);
    // Only the EU warehouse was read for market 2.
    expect(calls[0].variables).toMatchObject({ l0: L_EU });
    expect(calls[0].variables).not.toHaveProperty("l1");
  });

  it("market 1 (preorder offered): nothing sold out, stock is market 1's", async () => {
    campaignFindMany.mockResolvedValue([campaign()]);
    const { admin } = makeAdmin();
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en", M1, admin);
    expect(cfg.preorder?.campaignId).toBe("c1");
    expect(cfg.marketStock?.["1"]).toEqual({ stock: 0, inStock: false }); // → Preorder
    expect(cfg.marketStock?.["2"]).toEqual({ stock: 3, inStock: true }); // → normal checkout
    expect(cfg.marketSoldOut).toEqual([]);
  });

  it("per-variant campaigns carry marketStock / marketInStock on each variant entry", async () => {
    campaignFindMany.mockResolvedValue([
      campaign({
        variantConfigs: JSON.stringify([
          { productId: P, variantId: V_EU_STOCK, unitsOffered: 5 },
          { productId: P, variantId: V_US_STOCK, unitsOffered: 5 },
        ]),
      }),
    ]);
    capacity.mockResolvedValue({ soldOut: false, remaining: 5 });
    const { admin } = makeAdmin();
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en", "1", admin);
    expect(cfg.preorder?.variants["1"]).toEqual({ soldOut: false, remaining: 5, marketStock: 0, marketInStock: false });
    expect(cfg.preorder?.variants["2"]).toEqual({ soldOut: false, remaining: 5, marketStock: 3, marketInStock: true });
    // Variant 3 isn't on the campaign → not managed → never forced sold out.
    const m2 = await getStorefrontConfig("s.myshopify.com", "42", "", "en", "2", admin);
    expect(m2.marketSoldOut).toEqual(["2"]);
  });

  it("merchant's per-market locations override the snapshot", async () => {
    rule = multiRule({ perMarketOverrides: { [M2]: { locations: [L_US, L_EU] } } });
    campaignFindMany.mockResolvedValue([campaign()]);
    const { admin } = makeAdmin();
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en", "2", admin);
    expect(cfg.marketStock?.["2"]).toEqual({ stock: 3, inStock: true });
    expect(cfg.marketSoldOut).toEqual([]);
  });

  it("caches stock per shop + product for repeat views", async () => {
    campaignFindMany.mockResolvedValue([campaign()]);
    const { admin, calls } = makeAdmin();
    await getStorefrontConfig("s.myshopify.com", "42", "", "en", "2", admin);
    await getStorefrontConfig("s.myshopify.com", "42", "", "en", "2", admin);
    expect(calls).toHaveLength(1);
  });

  it("Shopify unreadable → no market data, old behaviour", async () => {
    campaignFindMany.mockResolvedValue([campaign()]);
    const admin = { graphql: vi.fn(async () => Response.json({ errors: [{ message: "boom" }] })) };
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en", "2", admin);
    expect(cfg.marketStock).toBeNull();
    expect(cfg.marketSoldOut).toEqual([]);
  });

  it("Force preorder saved under the market GID applies to the numeric storefront id", async () => {
    rule = multiRule({ perMarketOverrides: { [M1]: { forcePreorder: true } } });
    campaignFindMany.mockResolvedValue([campaign()]);
    const { admin } = makeAdmin();
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en", "1", admin);
    expect(cfg.preorder?.forcePreorder).toBe(true);
  });
});

describe("syncMarketBlocks — checkout guard metafield", () => {
  const metafieldWrites = (calls: { query: string; variables?: Record<string, unknown> }[]) =>
    calls.filter((c) => c.query.includes("EncoreMarketBlockedSet")).flatMap((c) => c.variables?.metafields as unknown[]);

  it("single-market shop: nothing to do, no API calls", async () => {
    rule = multiRule({ marketSnapshot: { [M1]: { locations: [L_US], fulfillable: true } } });
    const { admin, calls } = makeAdmin();
    expect(await syncMarketBlocks(admin, "s.myshopify.com")).toEqual({ skipped: "single market" });
    expect(calls).toHaveLength(0);
  });

  it("blocks the US-only variant in market 2 (no preorder there), nothing in market 1", async () => {
    campaignFindMany.mockResolvedValue([campaign()]);
    const { admin, calls } = makeAdmin();
    const r = await syncMarketBlocks(admin, "s.myshopify.com");
    expect(r).toMatchObject({ checked: 3, written: 1, cleared: 0 });
    const writes = metafieldWrites(calls) as { ownerId: string; key: string; type: string; value: string }[];
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ ownerId: V_US_STOCK, key: "market_blocked", type: "json" });
    expect(JSON.parse(writes[0].value).m).toEqual(["2"]);
  });

  it("clears a stale block once the variant is no longer managed", async () => {
    campaignFindMany.mockResolvedValue([]);
    const { admin, calls } = makeAdmin({ [V_US_STOCK]: '{"m":["2"],"until":"2999-01-01"}' });
    const r = await syncMarketBlocks(admin, "s.myshopify.com", { productIds: ["42"] });
    expect(r).toMatchObject({ written: 0, cleared: 1 });
    const del = calls.find((c) => c.query.includes("EncoreMarketBlockedDelete"));
    expect(del?.variables?.metafields).toEqual([{ ownerId: V_US_STOCK, namespace: "encore", key: "market_blocked" }]);
  });

  it("preorder offered in every market → never blocked", async () => {
    campaignFindMany.mockResolvedValue([campaign({ markets: "[]" })]);
    const { admin, calls } = makeAdmin();
    await syncMarketBlocks(admin, "s.myshopify.com");
    expect(metafieldWrites(calls)).toHaveLength(0);
  });

  it("preorder allocation used up → blocked where there's no local stock", async () => {
    campaignFindMany.mockResolvedValue([campaign({ markets: "[]" })]);
    capacity.mockResolvedValue({ soldOut: true, remaining: 0 });
    const { admin, calls } = makeAdmin();
    await syncMarketBlocks(admin, "s.myshopify.com");
    const writes = metafieldWrites(calls) as { ownerId: string; value: string }[];
    const byOwner = Object.fromEntries(writes.map((w) => [w.ownerId, JSON.parse(w.value).m]));
    expect(byOwner).toEqual({ [V_EU_STOCK]: ["1"], [V_US_STOCK]: ["2"] });
  });
});
