/**
 * Recovered-demand benchmark (Phase 5 pilot/validation gate, §3.5).
 *
 * The pilot's job is to beat the incumbent on recovered demand. This measures
 * Encore's recovered demand natively — no ARRS dependency:
 *   - waitlist → purchase conversion (the "ARRS lift", measured from our own
 *     convertedAt stamps), vs a configurable incumbent baseline.
 *   - pre-order units + GMV captured (demand that would otherwise be lost).
 *   - the zero-incident proof (oversell / untagged), reused from the §8 audit.
 */
import prisma from "../db.server";
import { getReliability } from "./reliability.server";
import { getSettings } from "../models/settings.server";
import type { ShopifyOrderPayload } from "./orders.server";

export type BenchmarkReport = {
  waitlist: { sent: number; converted: number; conversionRate: number | null };
  preorder: { units: number; gmv: number; orders: number };
  reliability: { oversellIncidents: number; untaggedOrders: number };
  incumbent: { name: string; conversionRate: number | null };
  liftPoints: number | null; // (Encore − incumbent) conversion, in percentage points
};

const numId = (g?: string | null): string =>
  g ? String(g).split("/").pop() || "" : "";

const wl = (
  prisma as unknown as {
    waitlistSubscription: {
      count(a: { where: Record<string, unknown> }): Promise<number>;
      findMany(a: {
        where: Record<string, unknown>;
        select: Record<string, unknown>;
      }): Promise<{ id: string; productId: string }[]>;
      update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
  }
).waitlistSubscription;

const po = (
  prisma as unknown as {
    preOrder: {
      aggregate(a: {
        where: Record<string, unknown>;
        _sum: { units: true; amount: true };
        _count: true;
      }): Promise<{ _sum: { units: number | null; amount: number | null }; _count: number }>;
    };
  }
).preOrder;

/** Accept a fraction (0..1) or a percent (0..100); normalize to a fraction. */
function toFraction(n: unknown): number | null {
  const x = typeof n === "number" ? n : typeof n === "string" ? parseFloat(n) : NaN;
  if (!isFinite(x) || x < 0) return null;
  return x > 1 ? x / 100 : x;
}

export async function getBenchmark(shop: string): Promise<BenchmarkReport> {
  const [sent, converted, agg, reliability, settings] = await Promise.all([
    wl.count({ where: { shop, notifyStatus: "SENT" } }),
    wl.count({ where: { shop, convertedAt: { not: null } } }),
    po.aggregate({
      where: { shop },
      _sum: { units: true, amount: true },
      _count: true,
    }),
    getReliability(shop),
    getSettings(shop),
  ]);

  const conversionRate = sent > 0 ? converted / sent : null;
  const b = settings.benchmark as {
    incumbentName?: unknown;
    incumbentConversionRate?: unknown;
  };
  const incumbentRate = toFraction(b.incumbentConversionRate);
  const liftPoints =
    conversionRate != null && incumbentRate != null
      ? Math.round((conversionRate - incumbentRate) * 1000) / 10
      : null;

  return {
    waitlist: { sent, converted, conversionRate },
    preorder: {
      units: agg._sum.units ?? 0,
      gmv: agg._sum.amount ?? 0,
      orders: agg._count ?? 0,
    },
    reliability: {
      oversellIncidents: reliability.oversellIncidents,
      untaggedOrders: reliability.untaggedOrders,
    },
    incumbent: {
      name: typeof b.incumbentName === "string" ? b.incumbentName : "",
      conversionRate: incumbentRate,
    },
    liftPoints,
  };
}

/**
 * Stamp convertedAt on any waitlisted shopper who just purchased a product they
 * were notified about — recovered demand. Called best-effort from orders/create
 * (dormant until Protected Customer Data enables orders/*, like order tagging).
 * Only counts SENT (actually-notified) subscribers, so the conversion rate is a
 * true recovery rate.
 */
export async function markWaitlistConverted(
  shop: string,
  order: ShopifyOrderPayload,
): Promise<number> {
  const email = String(
    order.email ?? order.contact_email ?? order.customer?.email ?? "",
  )
    .trim()
    .toLowerCase();
  if (!email) return 0;

  const productNums = new Set(
    (order.line_items ?? [])
      .map((li) => (li.product_id ? String(li.product_id) : ""))
      .filter(Boolean),
  );
  if (productNums.size === 0) return 0;

  const subs = await wl.findMany({
    where: { shop, email, notifyStatus: "SENT", convertedAt: null },
    select: { id: true, productId: true },
  });
  const hits = subs.filter((s) => productNums.has(numId(s.productId)));
  for (const h of hits) {
    await wl.update({
      where: { id: h.id },
      data: { convertedAt: new Date(), subscribed: false },
    });
  }
  return hits.length;
}
