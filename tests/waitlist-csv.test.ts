/**
 * Waitlist CSV import parser — merchants switching from another app trust this
 * with their whole subscriber list; a silent mis-parse loses real customers.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../app/db.server", () => ({ default: {} }));

import { parseWaitlistCsv, splitCsvLine } from "../app/models/waitlist.server";

describe("splitCsvLine", () => {
  it("splits plain and quoted cells, honoring escaped quotes", () => {
    expect(splitCsvLine('a,b,c')).toEqual(["a", "b", "c"]);
    expect(splitCsvLine('"a,b",c')).toEqual(["a,b", "c"]);
    expect(splitCsvLine('"say ""hi""",x')).toEqual(['say "hi"', "x"]);
    expect(splitCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });
});

describe("parseWaitlistCsv", () => {
  it("parses id-based rows with optional variant and locale", () => {
    const r = parseWaitlistCsv(
      "email,product_id,variant_id,locale\nAda@Example.com,123,456,de-DE\nbob@x.co,gid://shopify/Product/789,,\n",
    );
    expect(r.error).toBeNull();
    expect(r.skipped).toBe(0);
    expect(r.rows).toEqual([
      { email: "ada@example.com", productId: "123", isHandle: false, variantId: "456", locale: "de" },
      { email: "bob@x.co", productId: "789", isHandle: false, variantId: null, locale: null },
    ]);
  });

  it("accepts handle-based rows and case-insensitive headers in any order", () => {
    const r = parseWaitlistCsv("Product_Handle,EMAIL\naurora-hoodie,a@b.co\n");
    expect(r.error).toBeNull();
    expect(r.rows).toEqual([
      { email: "a@b.co", productId: "aurora-hoodie", isHandle: true, variantId: null, locale: null },
    ]);
  });

  it("skips malformed rows (bad email, missing product, bad handle) but keeps the rest", () => {
    const r = parseWaitlistCsv(
      "email,product_handle\nnot-an-email,tee\na@b.co,\nb@c.co,Bad Handle!\nok@x.co,tee\n",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].email).toBe("ok@x.co");
    expect(r.skipped).toBe(3);
  });

  it("dedupes identical rows within the file", () => {
    const r = parseWaitlistCsv("email,product_id\na@b.co,1\na@b.co,1\na@b.co,2\n");
    expect(r.rows).toHaveLength(2);
    expect(r.skipped).toBe(1);
  });

  it("fails clearly on missing required columns", () => {
    expect(parseWaitlistCsv("name,product_id\nA,1\n").error).toBe("missing_email_column");
    expect(parseWaitlistCsv("email\na@b.co\n").error).toBe("missing_product_column");
    expect(parseWaitlistCsv("").error).toBe("empty_file");
  });

  it("caps at 5000 rows and counts the overflow as skipped", () => {
    const lines = ["email,product_id"];
    for (let i = 0; i < 5010; i++) lines.push(`u${i}@x.co,1`);
    const r = parseWaitlistCsv(lines.join("\n"));
    expect(r.rows).toHaveLength(5000);
    expect(r.skipped).toBe(10);
  });

  it("strips a UTF-8 BOM and handles CRLF", () => {
    const r = parseWaitlistCsv("\uFEFFemail,product_id\r\na@b.co,9\r\n");
    expect(r.error).toBeNull();
    expect(r.rows).toEqual([
      { email: "a@b.co", productId: "9", isHandle: false, variantId: null, locale: null },
    ]);
  });
});

// campaign.server.ts only needs the db mock above (top-level await is fine in vitest ESM).
const { autoCohortName } = await import("../app/models/campaign.server");

describe("cohort naming (locale-aware)", () => {
  const ship = new Date("2026-10-15T00:00:00.000Z");

  it("uses English by default", () => {
    expect(autoCohortName(ship, "Drop 1")).toBe("October 2026 — Drop 1");
  });

  it("follows the merchant's locale", () => {
    expect(autoCohortName(ship, "Drop 1", "de")).toBe("Oktober 2026 — Drop 1");
    expect(autoCohortName(ship, "Drop 1", "fr")).toBe("octobre 2026 — Drop 1");
  });

  it("falls back to English on an invalid locale", () => {
    expect(autoCohortName(ship, "Drop 1", "zz-INVALID-!!")).toBe("October 2026 — Drop 1");
  });
});
