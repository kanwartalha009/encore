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
vi.mock("../app/models/settings.server", () => ({
  getSettings: vi.fn(async () => ({ general: {}, lowStock: {}, backInStock: {} })),
  getTranslations: vi.fn(async () => ({})),
}));
vi.mock("../app/models/capacity.server", () => ({
  getCampaignCapacity: vi.fn(async () => ({ soldOut: false, remaining: null })),
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

beforeEach(() => campaignFindMany.mockReset());

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
});
