/* eslint-env node */
/* global BigInt */
/**
 * One-time copy of Encore's old SQLite database into Postgres (2026-09-28).
 *
 * Encore moved from SQLite on a Railway volume to Railway Postgres (the same
 * Prisma schema, provider switched). On the first boot after the switch, set
 *   SQLITE_IMPORT_URL=file:/data/<old file>.sqlite   (the old DATABASE_URL)
 * and `npm run setup` runs this after `prisma db push`:
 *   - reads every table from the SQLite file (read-only, Node's built-in
 *     node:sqlite — no extra dependency),
 *   - converts values to the Prisma field types (SQLite keeps dates as epoch
 *     numbers or ISO text and booleans as 0/1),
 *   - inserts parents before children (Campaign → Cohort → PreOrder …) with
 *     createMany({ skipDuplicates: true }),
 *   - records the import in the SqliteImport marker table (a Prisma model, so
 *     `prisma db push` keeps it) so it never runs twice — a later
 *     boot with the variable still set can't bring back rows that were deleted
 *     since (e.g. by a GDPR request).
 * Without SQLITE_IMPORT_URL it does nothing. Remove the variable after the
 * first successful boot.
 */
import { fileURLToPath } from "node:url";

const DATE_MS_THRESHOLD = 1e11; // below this a number is epoch SECONDS

/** Convert one SQLite value to what Prisma expects for a field type. */
export function coerceValue(type, v) {
  if (v === null || v === undefined) return null;
  switch (type) {
    case "DateTime": {
      if (v instanceof Date) return v;
      const n = typeof v === "number" || typeof v === "bigint" ? Number(v) : /^\d+(\.\d+)?$/.test(String(v)) ? Number(v) : NaN;
      if (!Number.isNaN(n)) return new Date(n < DATE_MS_THRESHOLD ? n * 1000 : n);
      const t = Date.parse(String(v).replace(" ", "T"));
      return Number.isNaN(t) ? null : new Date(t);
    }
    case "Boolean":
      return v === true || v === 1 || v === 1n || v === "1" || v === "true";
    case "Int":
      return Number(v);
    case "Float":
    case "Decimal":
      return Number(v);
    case "BigInt":
      return BigInt(v);
    case "String":
      return String(v);
    default:
      return v;
  }
}

/** A SQLite row → Prisma createMany data for this model (scalar fields only). */
export function coerceRow(model, row) {
  const out = {};
  for (const f of model.fields) {
    if (f.kind !== "scalar" && f.kind !== "enum") continue;
    const col = f.dbName ?? f.name;
    if (!(col in row)) continue;
    const val = coerceValue(f.type, row[col]);
    if (val === null && f.hasDefaultValue) continue; // let the schema default apply
    out[f.name] = val;
  }
  return out;
}

/** Models ordered so every relation's parent is inserted before its children. */
export function orderModels(models) {
  const byName = new Map(models.map((m) => [m.name, m]));
  const deps = new Map(
    models.map((m) => [
      m.name,
      m.fields
        .filter((f) => f.kind === "object" && (f.relationFromFields ?? []).length > 0)
        .map((f) => f.type)
        .filter((t) => t !== m.name && byName.has(t)),
    ]),
  );
  const done = new Set();
  const out = [];
  const visit = (name, stack = new Set()) => {
    if (done.has(name) || stack.has(name)) return;
    stack.add(name);
    for (const d of deps.get(name) ?? []) visit(d, stack);
    done.add(name);
    out.push(byName.get(name));
  };
  for (const m of models) visit(m.name);
  return out;
}

const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Copy every model's rows. `sqlite` = a node:sqlite DatabaseSync (or anything
 * with prepare(sql).all()); `prisma` = the Postgres PrismaClient.
 */
export async function importAll({ sqlite, prisma, models, chunk = 500, log = console.log }) {
  const counts = {};
  const tables = new Set(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
  );
  for (const model of orderModels(models)) {
    const table = model.dbName ?? model.name;
    if (!tables.has(table)) {
      counts[model.name] = 0;
      continue;
    }
    const rows = sqlite.prepare(`SELECT * FROM "${table.replace(/"/g, '""')}"`).all();
    const data = rows.map((r) => coerceRow(model, r));
    let inserted = 0;
    for (let i = 0; i < data.length; i += chunk) {
      const r = await prisma[lowerFirst(model.name)].createMany({
        data: data.slice(i, i + chunk),
        skipDuplicates: true,
      });
      inserted += r.count;
    }
    counts[model.name] = inserted;
    log(`[sqlite-import] ${model.name}: ${inserted}/${rows.length} row(s) copied`);
  }
  return counts;
}


async function main() {
  const url = process.env.SQLITE_IMPORT_URL ?? "";
  if (!url) return;
  const path = url.replace(/^file:/, "");
  const { DatabaseSync } = await import("node:sqlite");
  const { PrismaClient, Prisma } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    // Marker = the SqliteImport model (created by `prisma db push`).
    const done = await prisma.sqliteImport.findUnique({ where: { id: 1 } });
    if (done) {
      console.log(`[sqlite-import] already imported at ${done.doneAt.toISOString()} — skipping. Remove SQLITE_IMPORT_URL.`);
      return;
    }
    const sqlite = new DatabaseSync(path, { readOnly: true });
    const models = Prisma.dmmf.datamodel.models.filter((m) => m.name !== "SqliteImport");
    const counts = await importAll({ sqlite, prisma, models });
    sqlite.close();
    await prisma.sqliteImport.upsert({
      where: { id: 1 },
      create: { id: 1, counts: JSON.stringify(counts) },
      update: {},
    });
    console.log(`[sqlite-import] done: ${JSON.stringify(counts)}`);
  } catch (e) {
    // Never block the app from starting; the import can be retried on the next boot.
    console.error("[sqlite-import] FAILED — the app starts anyway; fix and redeploy to retry", e);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
