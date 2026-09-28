/**
 * 2026-09-28 readiness fixes: sealed tokens (Klaviyo OAuth state, unsubscribe
 * links), the encrypted pasted Klaviyo key, and shopper-email sender details.
 */
import { describe, it, expect, beforeAll } from "vitest";

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = "test-secret";
  process.env.APP_ENCRYPTION_KEY = "a".repeat(64);
  process.env.SHOPIFY_APP_URL = "https://encore.test";
});

import { seal, unseal } from "../app/lib/seal.server";
import { unsubscribeUrl, readUnsubscribeToken } from "../app/lib/unsubscribe.server";
import { readKlaviyoKey, publicGeneral, mergeKlaviyoKey } from "../app/services/klaviyo-key.server";
import { fromWithName } from "../app/services/email.server";
import { pickReplyTo, unsubscribeFooter, unsubCopy, UNSUB_COPY } from "../app/lib/email-footer";

describe("seal", () => {
  it("round-trips, and rejects tampering, another purpose and expiry", () => {
    const tok = seal("a", { shop: "x.myshopify.com" }, 1000, 0);
    expect(unseal("a", tok, 500)).toMatchObject({ shop: "x.myshopify.com" });
    expect(unseal("b", tok, 500)).toBeNull();
    expect(unseal("a", tok, 2000)).toBeNull();
    const bad = tok.slice(0, -2) + (tok.endsWith("A") ? "BB" : "AA");
    expect(unseal("a", bad, 500)).toBeNull();
    expect(unseal("a", "garbage", 500)).toBeNull();
  });
  it("hides the email in unsubscribe links", () => {
    const url = unsubscribeUrl({ shop: "x.myshopify.com", email: "ann@x.com", locale: "fr", store: "Acme" });
    expect(url.startsWith("https://encore.test/unsubscribe?t=")).toBe(true);
    expect(url).not.toContain("ann");
    const t = new URL(url).searchParams.get("t");
    expect(readUnsubscribeToken(t)).toEqual({ shop: "x.myshopify.com", email: "ann@x.com", locale: "fr", store: "Acme" });
  });
});

describe("pasted Klaviyo key", () => {
  it("is stored encrypted and never sent to the browser", () => {
    const saved = mergeKlaviyoKey({}, { klaviyoKey: "pk_live_123", buttonColor: "#000" });
    expect(saved.klaviyoKey).toBeUndefined();
    expect(String(saved.klaviyoKeyEnc)).toMatch(/^gcm:/);
    expect(readKlaviyoKey(saved)).toBe("pk_live_123");
    const pub = publicGeneral(saved);
    expect(pub).not.toHaveProperty("klaviyoKeyEnc");
    expect(pub.klaviyoKeySet).toBe(true);
  });
  it("keeps the saved key when Settings is saved without a new one, migrates plain keys, and removes on request", () => {
    const enc = mergeKlaviyoKey({}, { klaviyoKey: "pk_1" });
    expect(readKlaviyoKey(mergeKlaviyoKey(enc, { klaviyoKey: "" }))).toBe("pk_1");
    const migrated = mergeKlaviyoKey({ klaviyoKey: "pk_old" }, {});
    expect(migrated.klaviyoKey).toBeUndefined();
    expect(readKlaviyoKey(migrated)).toBe("pk_old");
    expect(readKlaviyoKey(mergeKlaviyoKey(enc, { klaviyoKeyClear: true }))).toBe("");
  });
});

describe("shopper email sender", () => {
  it("shows the store name with the verified address", () => {
    expect(fromWithName("Encore <mail@encore.app>", "Acme \"Shop\"")).toBe('"Acme Shop" <mail@encore.app>');
    expect(fromWithName("mail@encore.app", "")).toBe("mail@encore.app");
  });
  it("replies go to the merchant, never a myshopify placeholder", () => {
    expect(pickReplyTo("help@acme.com", "c@acme.com")).toBe("help@acme.com");
    expect(pickReplyTo("hello@acme.myshopify.com", "c@acme.com")).toBe("c@acme.com");
    expect(pickReplyTo("", null)).toBeUndefined();
  });
  it("has the unsubscribe copy in every email language", () => {
    for (const l of ["en", "es", "fr", "de", "it", "pt", "nl", "pl"]) {
      const c = UNSUB_COPY[l];
      expect(Object.values(c).every((v) => v.length > 0)).toBe(true);
      expect(c.footer).toContain("{store}");
    }
    expect(unsubCopy("pt-BR")).toBe(UNSUB_COPY.pt);
    expect(unsubscribeFooter("xx", "Acme", "https://u")).toContain("asked Acme");
  });
});
