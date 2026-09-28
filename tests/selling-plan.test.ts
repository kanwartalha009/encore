/**
 * Selling-plan input builder — this is what makes deposit / pay-later billing
 * real at checkout. A wrong policy silently charges customers incorrectly.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../app/db.server", () => ({ default: {} }));
vi.mock("../app/models/preorder-cap.server", () => ({ syncVariantCaps: vi.fn() }));

import { buildPlan } from "../app/models/selling-plan.server";

type RawCampaign = Parameters<typeof buildPlan>[0];

const base: RawCampaign = {
  id: "c1",
  shop: "test.myshopify.com",
  name: "Drop 1",
  status: "LIVE",
  productMode: "SPECIFIC",
  productIds: '["1"]',
  paymentMode: "PAY_NOW",
  depositKind: "PERCENT",
  depositAmount: 20,
  balanceCaptureDays: 7,
  discountEnabled: false,
  discountKind: "PERCENT",
  discountAmount: 0,
  variantConfigs: "[]",
  shipDate: null,
};

const billing = (plan: Record<string, unknown>) =>
  (plan.billingPolicy as { fixed: Record<string, unknown> }).fixed;

describe("buildPlan", () => {
  it("PAY_NOW charges 100% with no remaining balance", () => {
    const { plan, mode } = buildPlan({ ...base }, {});
    expect(mode).toBe("PAY_NOW");
    const b = billing(plan);
    expect(b.checkoutCharge).toEqual({ type: "PERCENTAGE", value: { percentage: 100 } });
    expect(b.remainingBalanceChargeTrigger).toBe("NO_REMAINING_BALANCE");
  });

  it("DEPOSIT percent with ship date charges the deposit and collects balance before shipping", () => {
    const ship = new Date("2026-10-20T00:00:00.000Z");
    const { plan, mode } = buildPlan(
      { ...base, paymentMode: "DEPOSIT", depositAmount: 25, balanceCaptureDays: 7, shipDate: ship },
      {},
    );
    expect(mode).toBe("DEFERRED");
    const b = billing(plan);
    expect(b.checkoutCharge).toEqual({ type: "PERCENTAGE", value: { percentage: 25 } });
    expect(b.remainingBalanceChargeTrigger).toBe("EXACT_TIME");
    // 7 days before ship date
    expect(b.remainingBalanceChargeExactTime).toBe("2026-10-13T00:00:00.000Z");
  });

  it("DEPOSIT fixed uses a PRICE checkout charge", () => {
    const { plan } = buildPlan(
      { ...base, paymentMode: "DEPOSIT", depositKind: "FIXED", depositAmount: 15 },
      {},
    );
    const b = billing(plan);
    expect(b.checkoutCharge).toEqual({ type: "PRICE", value: { fixedValue: 15 } });
    // No ship date → relative trigger
    expect(b.remainingBalanceChargeTrigger).toBe("TIME_AFTER_CHECKOUT");
    expect(b.remainingBalanceChargeTimeAfterCheckout).toBe("P7D");
  });

  it("PAY_LATER charges 0% now and the balance at the ship date", () => {
    const ship = new Date("2026-11-01T00:00:00.000Z");
    const { plan, mode } = buildPlan({ ...base, paymentMode: "PAY_LATER", shipDate: ship }, {});
    expect(mode).toBe("DEFERRED");
    const b = billing(plan);
    expect(b.checkoutCharge).toEqual({ type: "PERCENTAGE", value: { percentage: 0 } });
    expect(b.remainingBalanceChargeTrigger).toBe("EXACT_TIME");
    expect(b.remainingBalanceChargeExactTime).toBe(ship.toISOString());
  });

  it("forcePayNow downgrades a deferred campaign to PAY_NOW (gateway fallback)", () => {
    const { plan, mode } = buildPlan(
      { ...base, paymentMode: "DEPOSIT", depositAmount: 25 },
      { forcePayNow: true },
    );
    expect(mode).toBe("PAY_NOW");
    const b = billing(plan);
    expect(b.checkoutCharge).toEqual({ type: "PERCENTAGE", value: { percentage: 100 } });
  });

  const delivery = (plan: Record<string, unknown>) =>
    (plan.deliveryPolicy as { fixed: Record<string, unknown> }).fixed;

  it("future ship date → EXACT_TIME delivery so the order hold shows the real date", () => {
    const ship = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    ship.setUTCHours(0, 0, 0, 0);
    const { plan } = buildPlan({ ...base, shipDate: ship }, {});
    // Sent at 12:00 UTC so the calendar day matches in every store timezone.
    expect(delivery(plan)).toEqual({
      fulfillmentTrigger: "EXACT_TIME",
      fulfillmentExactTime: ship.toISOString().replace("T00:00:00", "T12:00:00"),
    });
  });

  it("no ship date or a past one → UNKNOWN delivery (Shopify rejects past exact times)", () => {
    expect(delivery(buildPlan({ ...base }, {}).plan)).toEqual({ fulfillmentTrigger: "UNKNOWN" });
    const past = new Date(Date.now() - 24 * 3600 * 1000);
    expect(delivery(buildPlan({ ...base, shipDate: past }, {}).plan)).toEqual({ fulfillmentTrigger: "UNKNOWN" });
  });

  it("applies a fixed-amount discount (previously skipped)", () => {
    const { plan } = buildPlan({ ...base, discountEnabled: true, discountKind: "FIXED", discountAmount: 5 } as RawCampaign, {});
    expect(plan.pricingPolicies).toEqual([
      { fixed: { adjustmentType: "FIXED_AMOUNT", adjustmentValue: { fixedValue: "5" } } },
    ]);
  });

  it("applies a percentage discount", () => {
    const { plan } = buildPlan({ ...base, discountEnabled: true, discountKind: "PERCENT", discountAmount: 10 } as RawCampaign, {});
    expect(plan.pricingPolicies).toEqual([
      { fixed: { adjustmentType: "PERCENTAGE", adjustmentValue: { percentage: 10 } } },
    ]);
  });

  it("clears the discount on update when it was switched off", () => {
    const { plan } = buildPlan({ ...base, discountEnabled: false } as RawCampaign, { planId: "gid://shopify/SellingPlan/1" });
    expect(plan.pricingPolicies).toEqual([]);
    const created = buildPlan({ ...base, discountEnabled: false } as RawCampaign, {});
    expect(created.plan.pricingPolicies).toBeUndefined();
  });

  it("never schedules the balance in the past (was a silent pay-in-full fallback)", () => {
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // ship in 2 days, 7-day capture
    const { plan } = buildPlan(
      { ...base, paymentMode: "DEPOSIT", depositKind: "PERCENT", depositAmount: 20, balanceCaptureDays: 7, shipDate: soon } as RawCampaign,
      {},
    );
    const billing = (plan.billingPolicy as { fixed: Record<string, unknown> }).fixed;
    expect(billing.remainingBalanceChargeTrigger).toBe("TIME_AFTER_CHECKOUT");
    expect(billing.remainingBalanceChargeTimeAfterCheckout).toBe("P1D");
    expect(billing.remainingBalanceChargeExactTime).toBeUndefined();
  });
});
