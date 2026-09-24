import { describe, it, expect, vi } from "vitest";

vi.mock("../app/db.server", () => ({ default: {} }));

import { groupOrders, deriveActivity, numericOrderId } from "../app/models/orders-view.server";

const d = (s: string) => new Date(s);
const line = (o: Partial<Parameters<typeof groupOrders>[0][number]>) => ({
  id: "l1",
  campaignId: "c1",
  customerEmail: "a@b.co",
  customerName: "Ada",
  shopifyOrderId: "gid://shopify/Order/8403309232290",
  orderRef: "#1019",
  units: 1,
  amount: 100,
  paymentStatus: "BALANCE_PENDING",
  paidAt: null,
  failedAt: null,
  refundedAt: null,
  balanceRemindedAt: null,
  createdAt: d("2026-09-24T10:00:00Z"),
  campaign: { name: "Short Sleeve preorder" },
  cohort: { shipDate: d("2026-09-30T00:00:00Z") },
  ...o,
});

describe("groupOrders", () => {
  it("folds two lines of one Shopify order into one row (units + amount summed, worst status wins)", () => {
    const rows = groupOrders([
      line({ id: "l1", units: 2, amount: 200, paymentStatus: "BALANCE_PAID" }),
      line({ id: "l2", units: 1, amount: 100, paymentStatus: "BALANCE_PENDING" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orderRef: "#1019",
      shopifyOrderNumericId: "8403309232290",
      units: 3,
      amount: 300,
      lines: 2,
      paymentStatus: "BALANCE_PENDING",
      campaignName: "Short Sleeve preorder",
    });
  });

  it("keeps seed rows without a Shopify id separate and sorts newest first", () => {
    const rows = groupOrders([
      line({ id: "old", shopifyOrderId: null, orderRef: null, createdAt: d("2026-09-01T00:00:00Z") }),
      line({ id: "new", shopifyOrderId: null, orderRef: null, createdAt: d("2026-09-20T00:00:00Z") }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
    expect(rows[0].orderRef).toBe("—");
    expect(rows[0].shopifyOrderNumericId).toBeNull();
  });

  it("numericOrderId extracts the trailing id", () => {
    expect(numericOrderId("gid://shopify/Order/42")).toBe("42");
    expect(numericOrderId(null)).toBeNull();
  });
});

describe("deriveActivity", () => {
  it("emits one event per proven timestamp, newest first", () => {
    const ev = deriveActivity(
      [
        line({
          id: "l1",
          paymentStatus: "BALANCE_PAID",
          paidAt: d("2026-09-25T09:00:00Z"),
          balanceRemindedAt: d("2026-09-24T12:00:00Z"),
        }),
      ],
      { createdAt: d("2026-09-07T00:00:00Z"), startDate: d("2026-09-08T00:00:00Z"), status: "LIVE", name: "Short Sleeve preorder" },
    );
    expect(ev.map((e) => e.kind)).toEqual(["paid", "reminder", "order", "campaign", "campaign"]);
    expect(ev[2].detail).toBe("#1019 · Ada · 1 unit");
  });

  it("ignores a future start date", () => {
    const ev = deriveActivity([], { createdAt: d("2026-09-07T00:00:00Z"), startDate: d("2099-01-01T00:00:00Z"), status: "SCHEDULED", name: "x" });
    expect(ev.map((e) => e.text)).toEqual(["Preorder created"]);
  });
});
