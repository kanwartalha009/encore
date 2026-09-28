/**
 * One-time SQLite → Postgres copy (scripts/sqlite-import.mjs), 2026-09-28:
 * value conversion, parent-before-child order, and a real node:sqlite file.
 */
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { coerceValue, coerceRow, orderModels, importAll } from "../scripts/sqlite-import.mjs";

type Field = { name: string; kind: string; type: string; isRequired?: boolean; hasDefaultValue?: boolean; relationFromFields?: string[]; dbName?: string | null };
type Model = { name: string; dbName?: string | null; fields: Field[] };

const models: Model[] = [
  { name: "PreOrder", fields: [
    { name: "id", kind: "scalar", type: "String" },
    { name: "campaignId", kind: "scalar", type: "String" },
    { name: "campaign", kind: "object", type: "Campaign", relationFromFields: ["campaignId"] },
    { name: "createdAt", kind: "scalar", type: "DateTime", hasDefaultValue: true },
    { name: "tagged", kind: "scalar", type: "Boolean", hasDefaultValue: true },
    { name: "amount", kind: "scalar", type: "Float" },
  ] },
  { name: "Campaign", fields: [
    { name: "id", kind: "scalar", type: "String" },
    { name: "preorders", kind: "object", type: "PreOrder", relationFromFields: [] },
  ] },
  { name: "Session", fields: [
    { name: "id", kind: "scalar", type: "String" },
    { name: "userId", kind: "scalar", type: "BigInt" },
    { name: "expires", kind: "scalar", type: "DateTime" },
  ] },
];

describe("sqlite-import", () => {
  it("converts SQLite dates (ms, seconds, ISO), booleans and big ints", () => {
    expect(coerceValue("DateTime", 1727500000000).toISOString()).toBe("2024-09-28T05:06:40.000Z");
    expect(coerceValue("DateTime", 1727500000).toISOString()).toBe("2024-09-28T05:06:40.000Z");
    expect(coerceValue("DateTime", "2026-09-28 10:00:00").toISOString()).toBe(new Date("2026-09-28T10:00:00").toISOString());
    expect(coerceValue("Boolean", 0)).toBe(false);
    expect(coerceValue("Boolean", 1)).toBe(true);
    expect(coerceValue("BigInt", 42)).toBe(42n);
  });
  it("drops relation fields and lets defaults apply for nulls", () => {
    const row = coerceRow(models[0], { id: "p1", campaignId: "c1", createdAt: null, tagged: 1, amount: 9.5 });
    expect(row).toEqual({ id: "p1", campaignId: "c1", tagged: true, amount: 9.5 });
  });
  it("inserts parents before children", () => {
    expect(orderModels(models).map((m: Model) => m.name)).toEqual(["Campaign", "PreOrder", "Session"]);
  });
  it("copies a real SQLite file into the target client", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE "Campaign" (id TEXT PRIMARY KEY);
             CREATE TABLE "PreOrder" (id TEXT PRIMARY KEY, campaignId TEXT, createdAt DATETIME, tagged BOOLEAN, amount REAL);
             INSERT INTO "Campaign" VALUES ('c1');
             INSERT INTO "PreOrder" VALUES ('p1','c1',1727500000000,1,12.5),('p2','c1','2026-09-01T00:00:00.000Z',0,3);`);
    const got: Record<string, unknown[]> = {};
    const prisma = new Proxy({}, {
      get: (_t, name: string) => ({
        createMany: async ({ data }: { data: unknown[] }) => {
          (got[name] ??= []).push(...data);
          return { count: data.length };
        },
      }),
    });
    const counts = await importAll({ sqlite: db, prisma, models, log: () => {} });
    expect(counts).toEqual({ Campaign: 1, PreOrder: 2, Session: 0 });
    expect(Object.keys(got)).toEqual(["campaign", "preOrder"]);
    const p = got.preOrder as { createdAt: Date; tagged: boolean }[];
    expect(p[0].createdAt).toBeInstanceOf(Date);
    expect(p[1].tagged).toBe(false);
  });
});
