import prisma from "../db.server";

// ---------- CSV import (R1 — "switching from another app") ----------

export type WaitlistCsvRow = {
  email: string;
  productId: string; // numeric id, gid, or handle (resolved by importWaitlist)
  isHandle: boolean;
  variantId: string | null;
  locale: string | null;
};

export type WaitlistCsvParse = {
  rows: WaitlistCsvRow[];
  skipped: number; // malformed / missing email / missing product
  error: string | null; // fatal: no usable header
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Split one CSV line, honoring double quotes ("" = escaped quote). Pure. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/**
 * Parse a waitlist CSV export. Pure (unit-tested). Expected header columns
 * (case-insensitive, any order): `email` (required) plus one of `product_id` /
 * `product_handle` / `handle`; optional `variant_id`, `locale`.
 * Rows beyond 5000 are dropped (counted as skipped).
 */
export function parseWaitlistCsv(text: string): WaitlistCsvParse {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim() !== "");
  if (!lines.length) return { rows: [], skipped: 0, error: "empty_file" };

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const col = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i !== -1) return i;
    }
    return -1;
  };
  const iEmail = col("email", "email_address", "e-mail");
  const iProductId = col("product_id", "productid");
  const iHandle = col("product_handle", "handle");
  const iVariant = col("variant_id", "variantid");
  const iLocale = col("locale", "language");
  if (iEmail === -1) return { rows: [], skipped: 0, error: "missing_email_column" };
  if (iProductId === -1 && iHandle === -1)
    return { rows: [], skipped: 0, error: "missing_product_column" };

  const rows: WaitlistCsvRow[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    if (rows.length >= 5000) {
      skipped += lines.length - i;
      break;
    }
    const cells = splitCsvLine(lines[i]);
    const email = (cells[iEmail] || "").toLowerCase();
    const rawId = iProductId !== -1 ? cells[iProductId] || "" : "";
    const rawHandle = iHandle !== -1 ? (cells[iHandle] || "").toLowerCase() : "";
    if (!EMAIL_RE.test(email) || (!rawId && !rawHandle)) {
      skipped++;
      continue;
    }
    const isHandle = !rawId;
    const productId = isHandle
      ? rawHandle
      : rawId.startsWith("gid://")
        ? rawId.split("/").pop() || rawId
        : rawId;
    if (isHandle && !/^[a-z0-9-]+$/.test(productId)) {
      skipped++;
      continue;
    }
    const variantIdRaw = iVariant !== -1 ? cells[iVariant] || "" : "";
    const variantId = variantIdRaw
      ? variantIdRaw.startsWith("gid://")
        ? variantIdRaw.split("/").pop() || null
        : variantIdRaw
      : null;
    const locale = iLocale !== -1 && cells[iLocale] ? cells[iLocale].toLowerCase().slice(0, 2) : null;

    const key = `${email}::${productId}::${variantId ?? ""}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    rows.push({ email, productId, isHandle, variantId, locale });
  }
  return { rows, skipped, error: null };
}

type BadgeAdmin = {
  graphql: (
    q: string,
    o?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

/**
 * Import parsed rows: resolves handles → product ids + titles via the Admin
 * API, skips rows already subscribed, creates the rest (subscribed EMAIL
 * entries, notifyStatus null — they'll be picked up by the normal restock
 * dispatch). Returns counts for the merchant-facing summary.
 */
export async function importWaitlist(
  shop: string,
  admin: BadgeAdmin | null,
  text: string,
): Promise<{ imported: number; skipped: number; duplicates: number; error: string | null }> {
  const parsed = parseWaitlistCsv(text);
  if (parsed.error) return { imported: 0, skipped: parsed.skipped, duplicates: 0, error: parsed.error };

  // Resolve product identity (id → title, handle → id + title).
  const titles = new Map<string, string>(); // numeric id → title
  const handleToId = new Map<string, string>();
  const uniqueIds = Array.from(
    new Set(parsed.rows.filter((r) => !r.isHandle).map((r) => r.productId)),
  ).slice(0, 250);
  const uniqueHandles = Array.from(
    new Set(parsed.rows.filter((r) => r.isHandle).map((r) => r.productId)),
  ).slice(0, 100);

  if (admin) {
    try {
      for (let i = 0; i < uniqueIds.length; i += 100) {
        const gids = uniqueIds.slice(i, i + 100).map((id) => `gid://shopify/Product/${id}`);
        const res = await admin.graphql(
          `#graphql
          query EncoreImportProducts($ids: [ID!]!) {
            nodes(ids: $ids) { ... on Product { id title } }
          }`,
          { variables: { ids: gids } },
        );
        const body = (await res.json()) as {
          data?: { nodes?: ({ id: string; title: string } | null)[] };
        };
        for (const n of body.data?.nodes ?? []) {
          if (n?.id) titles.set(n.id.split("/").pop() || "", n.title);
        }
      }
      for (let i = 0; i < uniqueHandles.length; i += 20) {
        const chunk = uniqueHandles.slice(i, i + 20);
        const res = await admin.graphql(
          `#graphql
          query EncoreImportHandles($q: String!) {
            products(first: 20, query: $q) { nodes { id handle title } }
          }`,
          { variables: { q: chunk.map((h) => `handle:${h}`).join(" OR ") } },
        );
        const body = (await res.json()) as {
          data?: { products?: { nodes?: { id: string; handle: string; title: string }[] } };
        };
        for (const n of body.data?.products?.nodes ?? []) {
          const num = n.id.split("/").pop() || "";
          handleToId.set(n.handle.toLowerCase(), num);
          titles.set(num, n.title);
        }
      }
    } catch (err) {
      console.error("[encore] waitlist import product resolution failed", err);
    }
  }

  let imported = 0;
  let duplicates = 0;
  let skipped = parsed.skipped;
  for (const row of parsed.rows) {
    const productId = row.isHandle ? handleToId.get(row.productId) : row.productId;
    if (!productId) {
      skipped++; // handle didn't resolve to a product
      continue;
    }
    const existing = await prisma.waitlistSubscription.findFirst({
      where: {
        shop,
        productId,
        variantId: row.variantId, // null must match null (not "any variant")
        email: row.email,
      },
      select: { id: true },
    });
    if (existing) {
      duplicates++;
      continue;
    }
    await prisma.waitlistSubscription.create({
      data: {
        shop,
        productId,
        variantId: row.variantId,
        productTitle: titles.get(productId) ?? null,
        email: row.email,
        channel: "EMAIL",
        locale: row.locale,
        subscribed: true,
      },
    });
    imported++;
  }
  return { imported, skipped, duplicates, error: null };
}

export type WaitlistGroup = {
  productId: string;
  productTitle: string;
  variantTitle: string | null;
  subscribers: number;
  email: number;
  sms: number;
  both: number;
  newestSignupAt: string | null;
  convertedCount: number;
  notified: number;
  failed: number;
};

export async function listWaitlistGroups(
  shop: string,
): Promise<WaitlistGroup[]> {
  const subs = await prisma.waitlistSubscription.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });

  const map = new Map<string, WaitlistGroup>();
  for (const s of subs) {
    const key = `${s.productId}::${s.variantId ?? ""}`;
    let g = map.get(key);
    if (!g) {
      g = {
        productId: s.productId,
        productTitle: s.productTitle ?? s.productId,
        variantTitle: s.variantTitle ?? null,
        subscribers: 0,
        email: 0,
        sms: 0,
        both: 0,
        newestSignupAt: null,
        convertedCount: 0,
        notified: 0,
        failed: 0,
      };
      map.set(key, g);
    }
    g.subscribers += s.subscribed ? 1 : 0;
    if (s.channel === "EMAIL") g.email += 1;
    else if (s.channel === "SMS") g.sms += 1;
    else if (s.channel === "BOTH") g.both += 1;
    if (!g.newestSignupAt || s.createdAt > new Date(g.newestSignupAt)) {
      g.newestSignupAt = s.createdAt.toISOString();
    }
    if (s.convertedAt) g.convertedCount += 1;
    const ns = (s as unknown as { notifyStatus?: string | null }).notifyStatus;
    if (ns === "SENT") g.notified += 1;
    else if (ns === "FAILED") g.failed += 1;
  }

  return Array.from(map.values()).sort(
    (a, b) => b.subscribers - a.subscribers,
  );
}
