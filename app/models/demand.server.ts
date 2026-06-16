/**
 * Demand signal — read-only demand by product / variant / size / market.
 *
 * Derived from preorder intent (PreOrder units) + waitlist (WaitlistSubscription)
 * — a signal to size reorders, never a forecast. `rollupDemand` rebuilds the
 * DemandSignal table (the nightly `demand-rollup` job calls the same function)
 * and returns the fresh rows for the screen, so the view always reconciles with
 * current intent + waitlist.
 *
 * Note: market granularity is "ALL" until we capture the buyer's market on
 * intake (PreOrder/WaitlistSubscription) — an additive follow-up.
 */

import prisma from "../db.server";

export type DemandRow = {
  productId: string;
  variantId: string | null;
  productTitle: string;
  variantTitle: string | null;
  size: string | null;
  market: string;
  preorderUnits: number;
  waitlistCount: number;
  total: number;
};

const numId = (g?: string | null): string =>
  g ? String(g).split("/").pop() || "" : "";

function deriveSize(variantTitle: string | null): string | null {
  if (!variantTitle) return null;
  const parts = variantTitle.split("/").map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : variantTitle;
}

// New-field / new-model access via casts (PreOrder.variantId, DemandSignal).
const preOrder = (
  prisma as unknown as {
    preOrder: {
      findMany(a: {
        where: { shop: string };
        select: { variantId: true; units: true; market: true };
      }): Promise<{ variantId: string | null; units: number; market: string | null }[]>;
    };
  }
).preOrder;

const demandSignal = (
  prisma as unknown as {
    demandSignal: {
      deleteMany(a: { where: { shop: string } }): Promise<unknown>;
      createMany(a: { data: Record<string, unknown>[] }): Promise<unknown>;
    };
  }
).demandSignal;

export async function rollupDemand(shop: string): Promise<DemandRow[]> {
  // 1. Catalog (productId/title/variantTitle) from campaigns' variantConfigs.
  const campaigns = await prisma.campaign.findMany({
    where: { shop },
    select: { variantConfigs: true },
  });
  const catalog = new Map<
    string,
    { productId: string; productTitle: string; variantTitle: string | null }
  >();
  for (const c of campaigns) {
    try {
      const cfgs = JSON.parse(c.variantConfigs) as {
        productId?: string;
        variantId?: string;
        productTitle?: string;
        variantTitle?: string;
      }[];
      for (const v of cfgs) {
        if (v.variantId) {
          catalog.set(numId(v.variantId), {
            productId: v.productId ?? "",
            productTitle: v.productTitle ?? "",
            variantTitle: v.variantTitle ?? null,
          });
        }
      }
    } catch {
      /* ignore */
    }
  }

  // 2. Preorder units by variant.
  const preRows = await preOrder.findMany({
    where: { shop },
    select: { variantId: true, units: true, market: true },
  });

  // 3. Waitlist by product/variant + market (market is a new column → cast).
  const wlModel = (
    prisma as unknown as {
      waitlistSubscription: {
        findMany(a: {
          where: Record<string, unknown>;
          select: Record<string, boolean>;
        }): Promise<
          {
            productId: string;
            variantId: string | null;
            productTitle: string | null;
            variantTitle: string | null;
            market: string | null;
          }[]
        >;
      };
    }
  ).waitlistSubscription;
  const wl = await wlModel.findMany({
    where: { shop, subscribed: true },
    select: { productId: true, variantId: true, productTitle: true, variantTitle: true, market: true },
  });

  const rows = new Map<string, DemandRow>();
  const ensure = (
    key: string,
    base: Omit<DemandRow, "preorderUnits" | "waitlistCount" | "total">,
  ): DemandRow => {
    let r = rows.get(key);
    if (!r) {
      r = { ...base, preorderUnits: 0, waitlistCount: 0, total: 0 };
      rows.set(key, r);
    }
    return r;
  };

  for (const r of preRows) {
    const vnum = numId(r.variantId);
    if (!vnum) continue;
    const market = r.market || "ALL";
    const cat = catalog.get(vnum);
    ensure("v:" + vnum + "|" + market, {
      productId: cat?.productId ?? "",
      variantId: "gid://shopify/ProductVariant/" + vnum,
      productTitle: cat?.productTitle || `Variant ${vnum}`,
      variantTitle: cat?.variantTitle ?? null,
      size: deriveSize(cat?.variantTitle ?? null),
      market,
    }).preorderUnits += r.units;
  }

  for (const w of wl) {
    const vnum = numId(w.variantId);
    const market = w.market || "ALL";
    const key = (vnum ? "v:" + vnum : "p:" + numId(w.productId)) + "|" + market;
    ensure(key, {
      productId: w.productId,
      variantId: w.variantId ?? null,
      productTitle: w.productTitle ?? w.productId,
      variantTitle: w.variantTitle ?? null,
      size: deriveSize(w.variantTitle ?? null),
      market,
    }).waitlistCount += 1;
  }

  const out = Array.from(rows.values())
    .map((r) => ({ ...r, total: r.preorderUnits + r.waitlistCount }))
    .sort((a, b) => b.total - a.total);

  // 4. Persist DemandSignal (rebuild) — best-effort; the screen uses `out`.
  try {
    await demandSignal.deleteMany({ where: { shop } });
    if (out.length) {
      await demandSignal.createMany({
        data: out.map((r) => ({
          shop,
          productId: r.productId,
          variantId: r.variantId,
          productTitle: r.productTitle,
          variantTitle: r.variantTitle,
          size: r.size,
          market: r.market,
          preorderUnits: r.preorderUnits,
          waitlistCount: r.waitlistCount,
          total: r.total,
        })),
      });
    }
  } catch {
    /* DemandSignal table not migrated yet / createMany unsupported — live rows still returned */
  }

  return out;
}
