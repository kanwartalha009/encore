/** Start/end dates → status transitions (pure part of the scheduler job). */
import { describe, it, expect, vi } from "vitest";

vi.mock("../app/db.server", () => ({ default: {} }));
vi.mock("../app/models/selling-plan.server", () => ({ syncCampaignSellingPlan: vi.fn() }));
vi.mock("../app/services/inventory-policy.server", () => ({ syncContinueSellingSafe: vi.fn() }));

import { dueTransitions } from "../app/services/campaign-schedule.server";

const now = new Date("2026-09-28T12:00:00Z");
const row = (status: string, startDate: string | null, endDate: string | null) => ({
  shop: "s",
  id: status,
  status,
  startDate: startDate ? new Date(startDate) : null,
  endDate: endDate ? new Date(endDate) : null,
});

describe("dueTransitions", () => {
  it("ends live, scheduled and paused campaigns past their end date", () => {
    const t = dueTransitions(
      [row("LIVE", null, "2026-09-27"), row("SCHEDULED", null, "2026-09-27"), row("PAUSED", null, "2026-09-28T11:00:00Z")],
      now,
    );
    expect(t.map((x) => x.to)).toEqual(["ENDED", "ENDED", "ENDED"]);
  });
  it("starts scheduled campaigns whose start date arrived", () => {
    expect(dueTransitions([row("SCHEDULED", "2026-09-28T11:59:00Z", null)], now)).toEqual([
      { shop: "s", id: "SCHEDULED", to: "LIVE" },
    ]);
  });
  it("does not start a campaign whose window already closed — it ends instead", () => {
    expect(dueTransitions([row("SCHEDULED", "2026-09-01", "2026-09-10")], now)[0].to).toBe("ENDED");
  });
  it("leaves future windows, drafts and ended campaigns alone", () => {
    expect(
      dueTransitions(
        [row("SCHEDULED", "2026-10-01", null), row("LIVE", null, "2026-10-01"), row("DRAFT", null, "2026-09-01"), row("ENDED", null, "2026-09-01")],
        now,
      ),
    ).toEqual([]);
  });
});
