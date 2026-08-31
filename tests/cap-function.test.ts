/**
 * Checkout Validation Function (no-oversell guard) — the money path: a broken
 * function either blocks every checkout or caps nothing.
 */
import { describe, it, expect } from "vitest";
// The function runs in the Shopify Functions sandbox; its logic is pure JS.
// eslint-disable-next-line import/no-relative-packages
import { cartValidationsGenerateRun } from "../extensions/encore-preorder-cap/src/cart_validations_generate_run.js";

type Line = {
  quantity: number;
  merchandise: {
    __typename: string;
    remaining?: { value: string | null } | null;
    product?: { title: string };
  } | null;
};

const input = (lines: Line[]) => ({ cart: { lines } }) as never;

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
});
