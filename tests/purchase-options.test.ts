/**
 * Product-page Purchase options extension backend — request validation and
 * campaign-scope edits. A wrong scope edit silently drops products from the
 * continue-selling sync (variant-level campaigns are exhaustive), so the
 * product-level ↔ variant-level transitions are pinned here.
 */
import { describe, it, expect } from "vitest";
import {
  addTargetToScope,
  formDefaultsToCampaignFields,
  initialStatus,
  parsePurchaseOptionAction,
  parseTargetParams,
  pickCurrentCampaign,
  productsNeededForScopeEdit,
  removeTargetFromScope,
  ScopeError,
  scopeContains,
  summarizeCampaign,
  triggerFor,
  type Catalog,
  type CampaignScope,
} from "../app/lib/purchase-options-shared";

const P1 = "gid://shopify/Product/1";
const P2 = "gid://shopify/Product/2";
const V11 = "gid://shopify/ProductVariant/11";
const V12 = "gid://shopify/ProductVariant/12";
const V21 = "gid://shopify/ProductVariant/21";
const NOW = new Date("2026-09-28T10:00:00Z");

const catalog: Catalog = new Map([
  ["1", { id: P1, title: "Shoe", variants: [{ id: V11, title: "S" }, { id: V12, title: "M" }] }],
  ["2", { id: P2, title: "Hat", variants: [{ id: V21, title: "One size" }] }],
]);

const cfg = (productId: string, variantId: string) => ({
  productId,
  variantId,
  productTitle: "x",
  variantTitle: "y",
  unitsOffered: 5,
});

describe("parsePurchaseOptionAction", () => {
  it("rejects non-objects and unknown actions", () => {
    expect(parsePurchaseOptionAction(null, NOW)).toEqual({ ok: false, error: "invalid_body" });
    expect(parsePurchaseOptionAction([], NOW)).toEqual({ ok: false, error: "invalid_body" });
    expect(parsePurchaseOptionAction({ action: "drop_table" }, NOW)).toEqual({ ok: false, error: "unknown_action" });
  });

  it("validates GIDs and campaign ids", () => {
    expect(parsePurchaseOptionAction({ action: "attach", campaignId: "c1", target: { productId: "1" } }, NOW)).toEqual({
      ok: false,
      error: "invalid_target",
    });
    expect(
      parsePurchaseOptionAction({ action: "attach", campaignId: "c1; drop", target: { productId: P1 } }, NOW),
    ).toEqual({ ok: false, error: "invalid_campaign" });
    const ok = parsePurchaseOptionAction({ action: "detach", campaignId: "ck1", target: { variantId: V11 } }, NOW);
    expect(ok).toEqual({
      ok: true,
      value: { action: "detach", campaignId: "ck1", target: { productId: null, variantId: V11 } },
    });
  });

  it("validates create fields", () => {
    const base = { action: "create", target: { productId: P1 }, name: "Shoe preorder", when: "now", payment: "PAY_NOW" };
    expect(parsePurchaseOptionAction({ ...base, name: "  " }, NOW)).toEqual({ ok: false, error: "name_required" });
    expect(parsePurchaseOptionAction({ ...base, name: "x".repeat(121) }, NOW)).toEqual({
      ok: false,
      error: "name_too_long",
    });
    expect(parsePurchaseOptionAction({ ...base, when: "later" }, NOW)).toEqual({ ok: false, error: "invalid_when" });
    expect(parsePurchaseOptionAction({ ...base, when: "date" }, NOW)).toEqual({
      ok: false,
      error: "start_date_required",
    });
    expect(parsePurchaseOptionAction({ ...base, when: "date", startDate: "2026-02-30" }, NOW)).toEqual({
      ok: false,
      error: "invalid_date",
    });
    expect(parsePurchaseOptionAction({ ...base, payment: "FREE" }, NOW)).toEqual({ ok: false, error: "invalid_payment" });
    expect(parsePurchaseOptionAction({ ...base, payment: "DEPOSIT", depositPct: 0 }, NOW)).toEqual({
      ok: false,
      error: "deposit_pct_range",
    });
    expect(parsePurchaseOptionAction({ ...base, payment: "DEPOSIT", depositPct: 100 }, NOW)).toEqual({
      ok: false,
      error: "deposit_pct_range",
    });
    expect(parsePurchaseOptionAction({ ...base, shipDate: "2026-01-01" }, NOW)).toEqual({
      ok: false,
      error: "ship_date_past",
    });
    const ok = parsePurchaseOptionAction(
      { ...base, when: "date", startDate: "2026-10-05", payment: "DEPOSIT", depositPct: "25", shipDate: "2026-12-01", locale: "de-DE" },
      NOW,
    );
    expect(ok.ok && ok.value).toMatchObject({
      action: "create",
      name: "Shoe preorder",
      when: "date",
      startDate: "2026-10-05",
      payment: "DEPOSIT",
      depositPct: 25,
      shipDate: "2026-12-01",
      locale: "de-DE",
    });
    // Deposit % is dropped for non-deposit payment; junk locale ignored.
    const pn = parsePurchaseOptionAction({ ...base, depositPct: 50, locale: "<script>" }, NOW);
    expect(pn.ok && pn.value).toMatchObject({ depositPct: null, locale: null, startDate: null, shipDate: null });
  });

  it("update needs at least one change; null ship date clears", () => {
    expect(parsePurchaseOptionAction({ action: "update", campaignId: "c1" }, NOW)).toEqual({
      ok: false,
      error: "nothing_to_update",
    });
    expect(parsePurchaseOptionAction({ action: "update", campaignId: "c1", shipDate: null }, NOW)).toEqual({
      ok: true,
      value: { action: "update", campaignId: "c1", shipDate: null },
    });
    expect(
      parsePurchaseOptionAction({ action: "update", campaignId: "c1", payment: "PAY_LATER" }, NOW),
    ).toEqual({ ok: true, value: { action: "update", campaignId: "c1", payment: "PAY_LATER", depositPct: null } });
  });

  it("pause/resume only need a campaign", () => {
    expect(parsePurchaseOptionAction({ action: "pause", campaignId: "c1" }, NOW)).toEqual({
      ok: true,
      value: { action: "pause", campaignId: "c1" },
    });
    expect(parsePurchaseOptionAction({ action: "resume" }, NOW)).toEqual({ ok: false, error: "invalid_campaign" });
  });
});

describe("parseTargetParams", () => {
  it("requires a well-formed product or variant GID", () => {
    expect(parseTargetParams(new URLSearchParams("")).ok).toBe(false);
    expect(parseTargetParams(new URLSearchParams("productId=abc")).ok).toBe(false);
    expect(parseTargetParams(new URLSearchParams(`variantId=${V11}&sellingPlanId=nope`)).ok).toBe(false);
    expect(
      parseTargetParams(new URLSearchParams(`variantId=${V11}&sellingPlanId=gid://shopify/SellingPlan/9`)),
    ).toEqual({
      ok: true,
      value: { productId: null, variantId: V11, sellingPlanId: "gid://shopify/SellingPlan/9" },
    });
  });
});

describe("campaign scope edits", () => {
  const productLevel: CampaignScope = { productIds: [P2], variantConfigs: [] };
  const variantLevel: CampaignScope = { productIds: [P2], variantConfigs: [cfg(P2, V21)] };

  it("adds a whole product to a product-level campaign without variant rows", () => {
    expect(addTargetToScope(productLevel, { productId: P1, variantId: null }, catalog)).toEqual({
      productIds: [P2, P1],
      variantConfigs: [],
    });
  });

  it("adding one variant to a product-level campaign expands existing products", () => {
    const next = addTargetToScope(productLevel, { productId: P1, variantId: V12 }, catalog);
    expect(next.productIds).toEqual([P2, P1]);
    expect(next.variantConfigs.map((c) => c.variantId)).toEqual([V21, V12]);
    expect(next.variantConfigs.every((c) => c.unitsOffered === 0)).toBe(true);
  });

  it("adds all of a product's variants to a variant-level campaign, keeping existing limits", () => {
    const next = addTargetToScope(variantLevel, { productId: P1, variantId: null }, catalog);
    expect(next.variantConfigs.map((c) => c.variantId)).toEqual([V21, V11, V12]);
    expect(next.variantConfigs[0].unitsOffered).toBe(5);
  });

  it("is idempotent and matches numeric/GID ids", () => {
    const s: CampaignScope = { productIds: ["1"], variantConfigs: [] };
    expect(addTargetToScope(s, { productId: P1, variantId: null }, catalog).productIds).toEqual(["1"]);
    expect(scopeContains(s, { productId: P1, variantId: V11 })).toBe(true);
  });

  it("throws when the catalog cannot resolve the variant", () => {
    expect(() =>
      addTargetToScope(productLevel, { productId: P1, variantId: "gid://shopify/ProductVariant/999" }, catalog),
    ).toThrow(ScopeError);
    expect(() => addTargetToScope(productLevel, { productId: P1, variantId: V11 }, new Map())).toThrow(ScopeError);
  });

  it("removes a product and reports its variants for release", () => {
    const pl = removeTargetFromScope({ productIds: [P1, P2], variantConfigs: [] }, { productId: P1, variantId: null }, catalog);
    expect(pl.scope).toEqual({ productIds: [P2], variantConfigs: [] });
    expect(pl.removedVariantIds).toEqual([V11, V12]);

    const vl = removeTargetFromScope(
      { productIds: [P1, P2], variantConfigs: [cfg(P1, V11), cfg(P2, V21)] },
      { productId: P1, variantId: null },
      catalog,
    );
    expect(vl.scope).toEqual({ productIds: [P2], variantConfigs: [cfg(P2, V21)] });
    expect(vl.removedVariantIds).toEqual([V11]);
  });

  it("removing one variant from a product-level campaign keeps the others", () => {
    const r = removeTargetFromScope({ productIds: [P1, P2], variantConfigs: [] }, { productId: P1, variantId: V11 }, catalog);
    expect(r.scope.productIds).toEqual([P1, P2]);
    expect(r.scope.variantConfigs.map((c) => c.variantId)).toEqual([V12, V21]);
    expect(r.removedVariantIds).toEqual([V11]);
  });

  it("removing a product's last variant drops the product", () => {
    const r = removeTargetFromScope(
      { productIds: [P1, P2], variantConfigs: [cfg(P1, V11), cfg(P2, V21)] },
      { productId: P2, variantId: V21 },
      catalog,
    );
    expect(r.scope).toEqual({ productIds: [P1], variantConfigs: [cfg(P1, V11)] });
    expect(r.removedVariantIds).toEqual([V21]);
  });

  it("lists the products whose variants are needed", () => {
    expect(productsNeededForScopeEdit(productLevel, { productId: P1, variantId: V11 })).toEqual([P1, P2]);
    expect(productsNeededForScopeEdit(variantLevel, { productId: P1, variantId: V11 })).toEqual([P1]);
  });
});

describe("summaries and selection", () => {
  const row = (over: Partial<Parameters<typeof summarizeCampaign>[0]> = {}) => ({
    id: "c1",
    name: "Drop",
    status: "LIVE",
    paymentMode: "DEPOSIT",
    depositKind: "PERCENT",
    depositAmount: 30,
    shipDate: new Date("2026-12-01T00:00:00Z"),
    productIds: JSON.stringify([P1, P2]),
    ...over,
  });

  it("summarizes a campaign", () => {
    expect(summarizeCampaign(row())).toEqual({
      id: "c1",
      name: "Drop",
      status: "LIVE",
      paymentMode: "DEPOSIT",
      depositKind: "PERCENT",
      depositPct: 30,
      shipDate: "2026-12-01",
      productCount: 2,
    });
    expect(summarizeCampaign(row({ depositKind: "FIXED" })).depositPct).toBeNull();
    expect(summarizeCampaign(row({ paymentMode: "weird", productIds: "nope", shipDate: null }))).toMatchObject({
      paymentMode: "PAY_NOW",
      depositPct: null,
      productCount: 0,
      shipDate: null,
    });
  });

  it("prefers LIVE over PAUSED/DRAFT and ignores ENDED / non-specific campaigns", () => {
    const mk = (id: string, status: string, productMode = "SPECIFIC") => ({
      id,
      status,
      productMode,
      scope: { productIds: [P1], variantConfigs: [] } as CampaignScope,
    });
    const target = { productId: P1, variantId: null };
    expect(pickCurrentCampaign([mk("a", "DRAFT"), mk("b", "LIVE"), mk("c", "PAUSED")], target)?.id).toBe("b");
    expect(pickCurrentCampaign([mk("a", "ENDED"), mk("b", "LIVE", "ALL")], target)).toBeNull();
  });

  it("maps when → trigger and initial status", () => {
    expect(triggerFor("now")).toBe("MANUAL");
    expect(triggerFor("oos")).toBe("STOCK");
    expect(triggerFor("date")).toBe("DATE");
    expect(initialStatus("date", "2026-10-05", NOW)).toBe("SCHEDULED");
    expect(initialStatus("date", "2026-09-01", NOW)).toBe("LIVE");
    expect(initialStatus("oos", null, NOW)).toBe("LIVE");
  });

  it("maps store defaults to DB fields", () => {
    expect(
      formDefaultsToCampaignFields({
        paymentMode: "deposit",
        depositAmount: "15",
        balanceCaptureDays: "7",
        deliveryNote: "Ships soon",
        ctaLabel: "",
        ctaPlacement: "beside",
        cartMode: "warning",
        mixedCartWarning: "Mixed",
        orderTags: ["preorder", ""],
      }),
    ).toEqual({
      paymentMode: "DEPOSIT",
      depositPct: 15,
      balanceCaptureDays: 7,
      deliveryNote: "Ships soon",
      ctaLabel: "Preorder",
      ctaPlacement: "BESIDE",
      cartMode: "WARNING",
      mixedCartWarning: "Mixed",
      orderTags: ["preorder"],
    });
  });
});
