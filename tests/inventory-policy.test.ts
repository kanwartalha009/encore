/**
 * Continue-selling sync — the no-oversell contract on the Shopify side.
 *   LIVE + capacity left  → CONTINUE (sell past zero)
 *   LIVE + cap exhausted  → DENY   (theme shows Sold out, adds rejected)
 *   not LIVE              → DENY
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const campaignFindFirst = vi.fn();
vi.mock("../app/db.server", () => ({
  default: { campaign: { findFirst: (...a: unknown[]) => campaignFindFirst(...a), findMany: vi.fn() } },
}));
vi.mock("../app/models/settings.server", () => ({
  getSettings: vi.fn(async () => ({ general: {}, lowStock: {}, backInStock: {} })),
}));
const capacity = vi.fn();
vi.mock("../app/models/capacity.server", () => ({
  getCampaignCapacity: (...a: unknown[]) => capacity(...a),
}));

import { syncContinueSelling } from "../app/services/inventory-policy.server";

const V1 = "gid://shopify/ProductVariant/1";
const V2 = "gid://shopify/ProductVariant/2";
const P = "gid://shopify/Product/10";

function adminWith(current: Record<string, string>) {
  const calls: unknown[] = [];
  const admin = {
    graphql: vi.fn(async (q: string, opts?: { variables?: Record<string, unknown> }) => {
      if (q.includes("EncoreVariantsForPolicy")) {
        return {
          json: async () => ({
            data: {
              nodes: [
                {
                  id: P,
                  variants: { nodes: Object.entries(current).map(([id, inventoryPolicy]) => ({ id, inventoryPolicy })) },
                },
              ],
            },
          }),
        };
      }
      calls.push(opts?.variables);
      return { json: async () => ({ data: { productVariantsBulkUpdate: { userErrors: [] } } }) };
    }),
  };
  return { admin, calls };
}

beforeEach(() => {
  campaignFindFirst.mockReset();
  capacity.mockReset();
});

describe("syncContinueSelling", () => {
  it("flips every variant of a LIVE campaign to CONTINUE while capacity remains", async () => {
    campaignFindFirst.mockResolvedValue({
      id: "c1", status: "LIVE", productMode: "SPECIFIC", productIds: JSON.stringify([P]), variantConfigs: "[]", maxPerCampaign: null,
    });
    capacity.mockResolvedValue({ capped: false, remaining: null, soldOut: false });
    const { admin, calls } = adminWith({ [V1]: "DENY", [V2]: "DENY" });
    const r = await syncContinueSelling(admin as never, "s.myshopify.com", "c1");
    expect(r).toMatchObject({ status: "synced", policy: "CONTINUE", variants: 2, cappedVariants: 0 });
    expect(calls[0]).toMatchObject({ variants: [{ id: V1, inventoryPolicy: "CONTINUE" }, { id: V2, inventoryPolicy: "CONTINUE" }] });
  });

  it("sends a variant back to DENY once its preorder cap is exhausted", async () => {
    campaignFindFirst.mockResolvedValue({
      id: "c1", status: "LIVE", productMode: "SPECIFIC", productIds: JSON.stringify([P]),
      variantConfigs: JSON.stringify([{ variantId: V1, unitsOffered: 5 }, { variantId: V2, unitsOffered: 5 }]), maxPerCampaign: null,
    });
    capacity.mockImplementation(async (_s: string, _c: unknown, vid: string) =>
      vid === V1 ? { capped: true, remaining: 0, soldOut: true } : { capped: true, remaining: 3, soldOut: false },
    );
    const { admin, calls } = adminWith({ [V1]: "CONTINUE", [V2]: "CONTINUE" });
    const r = await syncContinueSelling(admin as never, "s.myshopify.com", "c1");
    expect(r).toMatchObject({ status: "synced", policy: "MIXED", variants: 1, cappedVariants: 1 });
    expect(calls[0]).toMatchObject({ variants: [{ id: V1, inventoryPolicy: "DENY" }] });
  });

  it("restores DENY for paused / ended campaigns without consulting capacity", async () => {
    campaignFindFirst.mockResolvedValue({
      id: "c1", status: "PAUSED", productMode: "SPECIFIC", productIds: JSON.stringify([P]), variantConfigs: "[]", maxPerCampaign: null,
    });
    const { admin, calls } = adminWith({ [V1]: "CONTINUE", [V2]: "DENY" });
    const r = await syncContinueSelling(admin as never, "s.myshopify.com", "c1");
    expect(r).toMatchObject({ status: "synced", policy: "DENY", variants: 1 });
    expect(calls[0]).toMatchObject({ variants: [{ id: V1, inventoryPolicy: "DENY" }] });
    expect(capacity).not.toHaveBeenCalled();
  });

  it("is a no-op when the merchant turned auto-manage off", async () => {
    const { getSettings } = await import("../app/models/settings.server");
    (getSettings as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      general: { autoManageContinueSelling: false }, lowStock: {}, backInStock: {},
    });
    const r = await syncContinueSelling({ graphql: vi.fn() } as never, "s.myshopify.com", "c1");
    expect(r).toEqual({ status: "skipped", reason: "autoManageContinueSelling off" });
  });
});
