/**
 * Flow payload key translation — Shopify Flow only accepts alphabetic+space
 * field keys, and a mismatch between these keys and the trigger tomls broke
 * `shopify app deploy` twice. Lock the mapping down.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../app/shopify.server", () => ({ unauthenticated: {} }));

import { toFlowKeys } from "../app/services/flow.server";

describe("toFlowKeys", () => {
  it("renames snake_case keys to the Flow field names", () => {
    expect(
      toFlowKeys({
        product_url: "https://x/products/a",
        due_date: "2026-09-01",
        pay_link: "https://pay",
        order_name: "#1001",
        order_id: "gid://shopify/Order/1",
        variant_id: "42",
        ship_date: "2026-10-01",
        waitlist_count: 7,
        old_ship_date: "2026-09-01",
        new_ship_date: "2026-10-01",
        customer_name: "Ada",
      }),
    ).toEqual({
      "Product URL": "https://x/products/a",
      "Due date": "2026-09-01",
      "Payment link": "https://pay",
      "Order name": "#1001",
      "Order ID": "gid://shopify/Order/1",
      "Variant ID": "42",
      "Ship date": "2026-10-01",
      "Waitlist count": 7,
      "Old ship date": "2026-09-01",
      "New ship date": "2026-10-01",
      "Customer name": "Ada",
    });
  });

  it("passes unknown keys through unchanged", () => {
    expect(toFlowKeys({ email: "a@b.co", product: "Tee" })).toEqual({
      email: "a@b.co",
      product: "Tee",
    });
  });

  it("never emits a renamed key containing non-alphabetic characters", () => {
    const out = toFlowKeys({
      product_url: "u",
      due_date: "d",
      pay_link: "p",
      order_name: "o",
      order_id: "i",
      variant_id: "v",
      ship_date: "s",
      waitlist_count: 1,
      old_ship_date: "o",
      new_ship_date: "n",
      customer_name: "c",
    });
    for (const key of Object.keys(out)) {
      expect(key).toMatch(/^[A-Za-z ]+$/);
    }
  });
});
