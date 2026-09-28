/**
 * Checkout Validation Function (no-oversell guard) — the money path: a broken
 * function either blocks every checkout or caps nothing.
 */
import { describe, it, expect } from "vitest";
// The function runs in the Shopify Functions sandbox; its logic is pure JS.
// eslint-disable-next-line import/no-relative-packages
import {
  blockedInMarket,
  cartValidationsGenerateRun,
} from "../extensions/encore-preorder-cap/src/cart_validations_generate_run.js";

type Line = {
  quantity: number;
  preorder?: { value: string } | null;
  sellingPlanAllocation?: { sellingPlan: { id: string } } | null;
  merchandise: {
    __typename: string;
    id?: string;
    remaining?: { value: string | null } | null;
    product?: { title: string };
    marketBlocked?: { value: string | null } | null;
  } | null;
};

// Lines are preorder-marked by default; tests opt out explicitly.
const input = (lines: Line[]) =>
  ({ cart: { lines: lines.map((l) => ("preorder" in l ? l : { ...l, preorder: { value: "true" } })) } }) as never;

describe("cartValidationsGenerateRun", () => {
  it("ignores variants without the remaining metafield", () => {
    const res = cartValidationsGenerateRun(
      input([{ quantity: 5, merchandise: { __typename: "ProductVariant" } }]),
    );
    expect(res.operations).toEqual([]);
  });

  it("ignores non-variant merchandise and null merchandise", () => {
    const res = cartValidationsGenerateRun(
      input([
        { quantity: 2, merchandise: { __typename: "CustomProduct" } },
        { quantity: 2, merchandise: null },
      ]),
    );
    expect(res.operations).toEqual([]);
  });

  it("allows quantity within the cap", () => {
    const res = cartValidationsGenerateRun(
      input([
        {
          quantity: 3,
          merchandise: {
            __typename: "ProductVariant",
            remaining: { value: "3" },
            product: { title: "Aurora Hoodie" },
          },
        },
      ]),
    );
    expect(res.operations).toEqual([]);
  });

  it("blocks quantity above the cap with the product name", () => {
    const res = cartValidationsGenerateRun(
      input([
        {
          quantity: 4,
          merchandise: {
            __typename: "ProductVariant",
            remaining: { value: "3" },
            product: { title: "Aurora Hoodie" },
          },
        },
      ]),
    );
    expect(res.operations).toHaveLength(1);
    const errs = (res.operations[0] as { validationAdd: { errors: { message: string; target: string }[] } })
      .validationAdd.errors;
    expect(errs[0].message).toContain("Only 3 preorder left");
    expect(errs[0].message).toContain("Aurora Hoodie");
    expect(errs[0].target).toBe("$.cart");
  });

  it("reports sold out when remaining is 0", () => {
    const res = cartValidationsGenerateRun(
      input([
        {
          quantity: 1,
          merchandise: {
            __typename: "ProductVariant",
            remaining: { value: "0" },
            product: { title: "Drop Tee" },
          },
        },
      ]),
    );
    const errs = (res.operations[0] as { validationAdd: { errors: { message: string }[] } })
      .validationAdd.errors;
    expect(errs[0].message).toContain("sold out");
  });

  it("tolerates a non-numeric metafield value", () => {
    const res = cartValidationsGenerateRun(
      input([
        {
          quantity: 9,
          merchandise: { __typename: "ProductVariant", remaining: { value: "not-a-number" } },
        },
      ]),
    );
    expect(res.operations).toEqual([]);
  });

  it("sums the same variant across several cart lines", () => {
    const v = {
      __typename: "ProductVariant",
      id: "gid://shopify/ProductVariant/1",
      remaining: { value: "5" },
      product: { title: "Aurora Hoodie" },
    };
    const res = cartValidationsGenerateRun(input([{ quantity: 3, merchandise: v }, { quantity: 3, merchandise: v }]));
    expect(res.operations).toHaveLength(1);
    const ok = cartValidationsGenerateRun(input([{ quantity: 2, merchandise: v }, { quantity: 3, merchandise: v }]));
    expect(ok.operations).toEqual([]);
  });

  it("keeps different variants separate", () => {
    const a = { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/1", remaining: { value: "3" } };
    const b = { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/2", remaining: { value: "3" } };
    const res = cartValidationsGenerateRun(input([{ quantity: 3, merchandise: a }, { quantity: 3, merchandise: b }]));
    expect(res.operations).toEqual([]);
  });

  it("never blocks unmarked (in-stock) lines of a capped variant", () => {
    const v = { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/1", remaining: { value: "0" } };
    const res = cartValidationsGenerateRun(input([{ quantity: 10, merchandise: v, preorder: null }]));
    expect(res.operations).toEqual([]);
  });

  it("caps lines bought with a selling plan even without the property", () => {
    const v = { __typename: "ProductVariant", id: "gid://shopify/ProductVariant/1", remaining: { value: "1" } };
    const res = cartValidationsGenerateRun(
      input([{ quantity: 2, merchandise: v, preorder: null, sellingPlanAllocation: { sellingPlan: { id: "gid://shopify/SellingPlan/9" } } }]),
    );
    expect(res.operations).toHaveLength(1);
  });
});

describe("per-market sold out (encore.market_blocked)", () => {
  const blocked = (value: string) => ({
    __typename: "ProductVariant",
    id: "gid://shopify/ProductVariant/1",
    product: { title: "Aurora Hoodie" },
    marketBlocked: { value },
  });
  // Buyer in market 2 on 2026-09-28 (shop local date).
  const inMarket = (lines: Line[], market = "gid://shopify/Market/2", date = "2026-09-28") =>
    ({
      localization: { market: { id: market } },
      shop: { localTime: { date } },
      cart: { lines },
    }) as never;
  const V = '{"m":["2"],"until":"2026-09-30"}';

  it("blocks every line of the variant in a blocked market — marked or not", () => {
    const res = cartValidationsGenerateRun(
      inMarket([
        { quantity: 1, merchandise: blocked(V), preorder: null },
        { quantity: 1, merchandise: blocked(V), preorder: { value: "true" } },
      ]),
    );
    expect(res.operations).toHaveLength(1);
    const errs = (res.operations[0] as { validationAdd: { errors: { message: string; target: string }[] } })
      .validationAdd.errors;
    expect(errs).toHaveLength(1); // one message per variant
    expect(errs[0].message).toBe("Aurora Hoodie is sold out in your region.");
    expect(errs[0].target).toBe("$.cart");
  });

  it("allows the variant in other markets", () => {
    const res = cartValidationsGenerateRun(
      inMarket([{ quantity: 1, merchandise: blocked(V), preorder: null }], "gid://shopify/Market/1"),
    );
    expect(res.operations).toEqual([]);
  });

  it("ignores an expired block (app failed to clear it)", () => {
    const res = cartValidationsGenerateRun(
      inMarket([{ quantity: 1, merchandise: blocked(V), preorder: null }], "gid://shopify/Market/2", "2026-10-01"),
    );
    expect(res.operations).toEqual([]);
  });

  it("never blocks without a market or with an unreadable value", () => {
    expect(blockedInMarket(V, "", "2026-09-28")).toBe(false);
    expect(blockedInMarket("not json", "2", "2026-09-28")).toBe(false);
    expect(blockedInMarket(null, "2", "2026-09-28")).toBe(false);
    expect(blockedInMarket('["2"]', "2", "2026-09-28")).toBe(true);
    // Older carts / tests without localization still run the cap check only.
    const res = cartValidationsGenerateRun(input([{ quantity: 1, merchandise: blocked(V) }]));
    expect(res.operations).toEqual([]);
  });

  it("keeps capping preorder lines of unblocked variants", () => {
    const v = {
      __typename: "ProductVariant",
      id: "gid://shopify/ProductVariant/5",
      remaining: { value: "1" },
      marketBlocked: { value: '{"m":["3"],"until":"2026-09-30"}' },
    };
    const res = cartValidationsGenerateRun(inMarket([{ quantity: 2, merchandise: v, preorder: { value: "true" } }]));
    expect(res.operations).toHaveLength(1);
  });
});
