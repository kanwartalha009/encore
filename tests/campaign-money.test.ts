import { describe, it, expect, vi } from "vitest";

vi.mock("../app/db.server", () => ({ default: {} }));
import { campaignMoney } from "../app/models/campaign.server";

describe("campaignMoney — collected follows payment status, not order value", () => {
  it("pay-now COD orders (BALANCE_PENDING) count as awaiting, not collected", () => {
    const m = campaignMoney([
      { amount: 100, depositAmount: 100, paymentStatus: "BALANCE_PENDING" },
      { amount: 100, depositAmount: 100, paymentStatus: "BALANCE_PENDING" },
    ]);
    expect(m).toEqual({ depositCollectedCents: 0, balancePendingCents: 20000, awaitingPaymentCount: 2 });
  });

  it("paid pay-now order is fully collected", () => {
    const m = campaignMoney([{ amount: 100, depositAmount: 100, paymentStatus: "BALANCE_PAID" }]);
    expect(m).toEqual({ depositCollectedCents: 10000, balancePendingCents: 0, awaitingPaymentCount: 0 });
  });

  it("deposit order: deposit collected, remainder pending; refunded ignored", () => {
    const m = campaignMoney([
      { amount: 200, depositAmount: 50, paymentStatus: "DEPOSIT_PAID" },
      { amount: 200, depositAmount: 50, paymentStatus: "REFUNDED" },
    ]);
    expect(m).toEqual({ depositCollectedCents: 5000, balancePendingCents: 15000, awaitingPaymentCount: 0 });
  });
});
