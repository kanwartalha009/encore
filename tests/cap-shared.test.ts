/** Preorder cap maths shared by storefront, capacity, Function metafields. */
import { describe, it, expect } from "vitest";
import { combineVariantCaps, effectiveVariantCap } from "../app/lib/cap-shared";

describe("effectiveVariantCap", () => {
  it("uses Limit quantity alone", () => {
    expect(effectiveVariantCap({ unitsOffered: 100 })).toBe(100);
  });
  it("enforces End quantity (previously ignored)", () => {
    expect(effectiveVariantCap({ unitsOffered: 100, endQty: 40 })).toBe(40);
    expect(effectiveVariantCap({ endQty: 25 })).toBe(25);
  });
  it("takes the tighter of the two", () => {
    expect(effectiveVariantCap({ unitsOffered: 10, endQty: 40 })).toBe(10);
  });
  it("treats empty, zero, negative and junk as uncapped", () => {
    expect(effectiveVariantCap({ unitsOffered: 0, endQty: null })).toBeNull();
    expect(effectiveVariantCap({ unitsOffered: -5 })).toBeNull();
    expect(effectiveVariantCap({ unitsOffered: "abc" })).toBeNull();
    expect(effectiveVariantCap(null)).toBeNull();
  });
  it("accepts numeric strings", () => {
    expect(effectiveVariantCap({ unitsOffered: "12" })).toBe(12);
  });
});

describe("combineVariantCaps", () => {
  it("returns null when nothing caps the variant (metafields get removed)", () => {
    expect(combineVariantCaps([])).toBeNull();
  });
  it("tightest remaining wins across campaigns", () => {
    expect(
      combineVariantCaps([
        { cap: 100, sold: 10 },
        { cap: 20, sold: 18 },
      ]),
    ).toEqual({ cap: 20, remaining: 2 });
  });
  it("never goes below zero", () => {
    expect(combineVariantCaps([{ cap: 5, sold: 9 }])).toEqual({ cap: 5, remaining: 0 });
  });
});

import { variantWindowOpen, variantWindowBoundaries } from "../app/lib/cap-shared";

describe("variantWindowOpen", () => {
  const at = (iso: string) => new Date(iso);
  it("now / missing config is always open", () => {
    expect(variantWindowOpen({ availability: "now" }, at("2026-09-28T00:00:00Z"))).toBe(true);
    expect(variantWindowOpen(null)).toBe(true);
  });
  it("not_available is always closed", () => {
    expect(variantWindowOpen({ availability: "not_available" })).toBe(false);
  });
  it("from_start opens at 00:00 UTC of the start date", () => {
    const vc = { availability: "from_start", availStart: "2026-10-01" };
    expect(variantWindowOpen(vc, at("2026-09-30T23:59:59Z"))).toBe(false);
    expect(variantWindowOpen(vc, at("2026-10-01T00:00:00Z"))).toBe(true);
  });
  it("now_until_end closes after the end date (inclusive)", () => {
    const vc = { availability: "now_until_end", availEnd: "2026-10-31" };
    expect(variantWindowOpen(vc, at("2026-10-31T23:00:00Z"))).toBe(true);
    expect(variantWindowOpen(vc, at("2026-11-01T00:00:00Z"))).toBe(false);
  });
  it("between needs both bounds", () => {
    const vc = { availability: "between", availStart: "2026-10-01", availEnd: "2026-10-31" };
    expect(variantWindowOpen(vc, at("2026-09-15T00:00:00Z"))).toBe(false);
    expect(variantWindowOpen(vc, at("2026-10-15T00:00:00Z"))).toBe(true);
    expect(variantWindowOpen(vc, at("2026-11-02T00:00:00Z"))).toBe(false);
  });
  it("reports window boundaries", () => {
    expect(variantWindowBoundaries({ availability: "between", availStart: "2026-10-01", availEnd: "2026-10-01" })).toEqual([
      Date.parse("2026-10-01T00:00:00Z"),
      Date.parse("2026-10-02T00:00:00Z"),
    ]);
    expect(variantWindowBoundaries({ availability: "now" })).toEqual([]);
  });
});
