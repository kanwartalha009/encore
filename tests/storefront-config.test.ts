/**
 * Storefront match loop — the single source of truth for what shoppers see.
 * Covers the R0 trigger paths (STOCK vs always), campaign windows, SPECIFIC
 * product matching and the R1 countdown dates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const campaignFindMany = vi.fn();
vi.mock("../app/db.server", () => ({
  default: { campaign: { findMany: (...a: unknown[]) => campaignFindMany(...a) } },
}));
const translations = vi.fn<() => Promise<Record<string, Record<string, string>>>>(async () => ({}));
vi.mock("../app/models/settings.server", () => ({
  getSettings: vi.fn(async () => ({ general: {}, lowStock: {}, backInStock: {} })),
  getTranslations: () => translations(),
}));
const capacity = vi.fn<(shop: string, c: unknown, vid?: string | null) => Promise<{ soldOut: boolean; remaining: number | null }>>(
  async () => ({ soldOut: false, remaining: null }),
);
vi.mock("../app/models/capacity.server", () => ({
  getCampaignCapacity: (shop: string, c: unknown, vid?: string | null) => capacity(shop, c, vid),
}));
vi.mock("../app/models/markets.server", () => ({
  getMarketRule: vi.fn(async () => ({ scope: "ALL", markets: [], perMarketOverrides: {} })),
}));
vi.mock("../app/services/usage.server", () => ({
  isOverPreorderLimit: vi.fn(async () => false),
}));

import { getStorefrontConfig } from "../app/models/storefront.server";

const DAY = 24 * 60 * 60 * 1000;

const campaign = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  shop: "test.myshopify.com",
  status: "LIVE",
  productMode: "ALL",
  productIds: "[]",
  markets: "[]",
  triggerType: "MANUAL",
  startDate: null,
  endDate: null,
  shipDate: null,
  ctaLabel: "Preorder",
  ctaPlacement: null,
  deliveryNote: "",
  updatedAt: new Date(),
  ...over,
});

beforeEach(() => {
  campaignFindMany.mockReset();
  capacity.mockReset();
  capacity.mockResolvedValue({ soldOut: false, remaining: null });
});

describe("getStorefrontConfig", () => {
  it("serves trigger 'stock' for STOCK campaigns and 'always' otherwise", async () => {
    campaignFindMany.mockResolvedValue([campaign({ triggerType: "STOCK" })]);
    const stock = await getStorefrontConfig("s.myshopify.com", "1", "", "en");
    expect(stock.preorder?.trigger).toBe("stock");

    campaignFindMany.mockResolvedValue([campaign({ triggerType: "MANUAL" })]);
    const manual = await getStorefrontConfig("s.myshopify.com", "1", "", "en");
    expect(manual.preorder?.trigger).toBe("always");
  });

  it("skips campaigns outside their date window", async () => {
    campaignFindMany.mockResolvedValue([
      campaign({ id: "future", startDate: new Date(Date.now() + DAY) }),
      campaign({ id: "past", endDate: new Date(Date.now() - DAY) }),
    ]);
    const cfg = await getStorefrontConfig("s.myshopify.com", "1", "", "en");
    expect(cfg.preorder).toBeNull();
  });

  it("matches SPECIFIC campaigns only for their products", async () => {
    campaignFindMany.mockResolvedValue([
      campaign({ productMode: "SPECIFIC", productIds: '["gid://shopify/Product/42"]' }),
    ]);
    const hit = await getStorefrontConfig("s.myshopify.com", "42", "", "en");
    expect(hit.preorder?.campaignId).toBe("c1");
    const miss = await getStorefrontConfig("s.myshopify.com", "43", "", "en");
    expect(miss.preorder).toBeNull();
  });

  it("scopes the offer to the campaign's variant rows and carries per-variant caps", async () => {
    campaignFindMany.mockResolvedValue([
      campaign({
        productMode: "SPECIFIC",
        productIds: '["gid://shopify/Product/42"]',
        variantConfigs: JSON.stringify([
          { productId: "gid://shopify/Product/42", variantId: "gid://shopify/ProductVariant/1", unitsOffered: 5 },
          { productId: "gid://shopify/Product/42", variantId: "gid://shopify/ProductVariant/2", unitsOffered: 5 },
        ]),
      }),
    ]);
    capacity.mockImplementation(async (_s: string, _c: unknown, vid?: string | null) =>
      vid === "gid://shopify/ProductVariant/2" ? { soldOut: true, remaining: 0 } : { soldOut: false, remaining: 3 },
    );
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en");
    expect(cfg.preorder?.variantScoped).toBe(true);
    expect(cfg.preorder?.variants).toEqual({ "1": { soldOut: false, remaining: 3 }, "2": { soldOut: true, remaining: 0 } });
    expect(cfg.preorder?.active).toBe(true); // variant 1 still offerable
  });

  it("reports the product sold out once every configured variant is at cap", async () => {
    campaignFindMany.mockResolvedValue([
      campaign({
        productMode: "SPECIFIC",
        productIds: '["gid://shopify/Product/42"]',
        variantConfigs: JSON.stringify([{ productId: "gid://shopify/Product/42", variantId: "gid://shopify/ProductVariant/1", unitsOffered: 1 }]),
      }),
    ]);
    capacity.mockImplementation(async (_s: string, _c: unknown, vid?: string | null) =>
      vid ? { soldOut: true, remaining: 0 } : { soldOut: false, remaining: null },
    );
    const cfg = await getStorefrontConfig("s.myshopify.com", "42", "", "en");
    expect(cfg.preorder?.soldOut).toBe(true);
    expect(cfg.preorder?.active).toBe(false);
  });

  it("serves the campaign window as ISO strings for the countdown block", async () => {
    const end = new Date(Date.now() + 3 * DAY);
    const start = new Date(Date.now() - DAY);
    campaignFindMany.mockResolvedValue([campaign({ startDate: start, endDate: end })]);
    const cfg = await getStorefrontConfig("s.myshopify.com", "1", "", "en");
    expect(cfg.preorder?.endDate).toBe(end.toISOString());
    expect(cfg.preorder?.startDate).toBe(start.toISOString());
  });

  it("serves null dates for open-ended campaigns", async () => {
    campaignFindMany.mockResolvedValue([campaign()]);
    const cfg = await getStorefrontConfig("s.myshopify.com", "1", "", "en");
    expect(cfg.preorder?.endDate).toBeNull();
    expect(cfg.preorder?.startDate).toBeNull();
  });

  it("translates every storefront string, region first then base language", async () => {
    campaignFindMany.mockResolvedValue([]);
    translations.mockResolvedValue({
      pt: { sold_out: "Esgotado", notify_submit: "Avisar-me" },
      "pt-BR": { sold_out: "Esgotado (BR)" },
    });
    const br = await getStorefrontConfig("s.myshopify.com", "1", "", "pt-br");
    expect(br.strings.sold_out).toBe("Esgotado (BR)");
    expect(br.strings.notify_submit).toBe("Avisar-me");
    expect(br.strings.network_error).toBe("Network error — please try again.");
    expect(br.translated).toContain("sold_out");
    const pt = await getStorefrontConfig("s.myshopify.com", "1", "", "pt");
    expect(pt.strings.sold_out).toBe("Esgotado");
    translations.mockResolvedValue({});
  });

  it("leaves variants outside their availability window off preorder", async () => {
    campaignFindMany.mockResolvedValue([
      campaign({
        productMode: "SPECIFIC",
        productIds: JSON.stringify(["gid://shopify/Product/1"]),
        variantConfigs: JSON.stringify([
          { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/11", unitsOffered: 5, availability: "now" },
          { productId: "gid://shopify/Product/1", variantId: "gid://shopify/ProductVariant/12", unitsOffered: 5, availability: "not_available" },
        ]),
      }),
    ]);
    const cfg = await getStorefrontConfig("s.myshopify.com", "1", "", "en");
    expect(Object.keys(cfg.preorder!.variants)).toEqual(["11"]);
    expect(cfg.preorder!.active).toBe(true);
  });
});
