/**
 * Back-in-stock contacts (2026-09-28): E.164 handling, CSV injection guard,
 * and the Shopify-customer sync (create with tags; keep the email when the
 * phone is rejected; tag an existing customer).
 */
import { describe, it, expect, vi } from "vitest";

const { settings } = vi.hoisted(() => ({ settings: { backInStock: { syncTarget: "shopify" } as Record<string, unknown> } }));
vi.mock("../app/models/settings.server", () => ({ getSettings: async () => settings }));
vi.mock("../app/services/klaviyo.server", () => ({
  klaviyoHasAuth: async () => false,
  klaviyoUpsertProfile: vi.fn(),
  klaviyoAddToList: vi.fn(),
}));

import { toE164, contactsCsv, csvCell, contactTags } from "../app/lib/contacts-shared";
import { syncContact } from "../app/services/contact-sync.server";

function fakeAdmin(responses: unknown[]) {
  const calls: { q: string; v: Record<string, unknown> }[] = [];
  return {
    calls,
    graphql: async (q: string, o?: { variables?: Record<string, unknown> }) => {
      calls.push({ q, v: o?.variables ?? {} });
      return new Response(JSON.stringify(responses.shift() ?? {}));
    },
  };
}

describe("contacts-shared", () => {
  it("only passes real international numbers as E.164", () => {
    expect(toE164("+1 (415) 555-0123")).toBe("+14155550123");
    expect(toE164("0044 20 7946 0958")).toBe("+442079460958");
    expect(toE164("020 7946 0958")).toBeNull();
    expect(toE164("+12")).toBeNull();
  });
  it("neutralises spreadsheet formulas in exported cells", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell('a"b')).toBe(`"a""b"`);
    expect(contactsCsv([{ signedUp: "2026-09-28", email: "a@b.c", phone: "+1555", product: "Tee", variant: "", status: "waiting", consent: "no", language: "en", market: "" }]).split("\n")).toHaveLength(2);
    expect(contactTags(true)).toContain("encore-back-in-stock-sms");
  });
});

describe("Shopify customer sync", () => {
  const c = { email: "ann@x.com", phone: "+14155550123", productTitle: "Tee", variantTitle: null, locale: "en" };
  it("creates a tagged customer, retrying without a rejected phone", async () => {
    const admin = fakeAdmin([
      { data: { customers: { nodes: [] } } },
      { data: { customerCreate: { customer: null, userErrors: [{ message: "Phone has already been taken" }] } } },
      { data: { customerCreate: { customer: { id: "gid://shopify/Customer/1" }, userErrors: [] } } },
    ]);
    const r = await syncContact("s.myshopify.com", admin, c);
    expect(r).toEqual({ target: "shopify", ok: true });
    expect(admin.calls[1].v.input).toMatchObject({ email: "ann@x.com", phone: "+14155550123", tags: ["encore-back-in-stock", "encore-back-in-stock-sms"] });
    expect(admin.calls[2].v.input).not.toHaveProperty("phone");
  });
  it("tags an existing customer", async () => {
    const admin = fakeAdmin([{ data: { customers: { nodes: [{ id: "gid://shopify/Customer/7" }] } } }, { data: { tagsAdd: { userErrors: [] } } }]);
    expect(await syncContact("s.myshopify.com", admin, c)).toEqual({ target: "shopify", ok: true });
    expect(admin.calls[1].v).toMatchObject({ id: "gid://shopify/Customer/7" });
  });
  it("does nothing for Klaviyo until it's connected", async () => {
    settings.backInStock = { syncTarget: "klaviyo" };
    expect(await syncContact("s.myshopify.com", null, c)).toEqual({ target: "klaviyo", ok: true });
  });
});
