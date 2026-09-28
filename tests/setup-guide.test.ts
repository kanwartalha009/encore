/** Dashboard setup guide (2026-09-28): steps are done from real store state. */
import { describe, it, expect } from "vitest";
import { setupSteps } from "../app/lib/setup-guide";

describe("setupSteps", () => {
  it("starts with nothing done on a fresh install", () => {
    const s = setupSteps({ embed: { checked: true, enabled: false }, preorders: 0, provider: "off", backInStockSaved: false, orders: 0 });
    expect(s.map((x) => x.done)).toEqual([false, false, false, false, false]);
  });
  it("marks each step done from store state; an unreadable theme is never done", () => {
    const s = setupSteps({ embed: { checked: false }, preorders: 2, provider: "shopify_flow", backInStockSaved: true, orders: 1 });
    expect(s.find((x) => x.id === "embed")?.done).toBe(false);
    expect(s.filter((x) => x.done).map((x) => x.id)).toEqual(["preorder", "emails", "backinstock", "test"]);
  });
});
