/**
 * Reliability audit (§8 "must never" bar → real numbers, not estimates).
 *
 * Powers the Dashboard reliability bar. Every figure is computed from stored
 * data, so a clean store reads 0 oversell / 0 untagged and a healthy delivery
 * rate — the switching trigger vs incumbents that oversell and drop tags.
 *
 *   - oversellIncidents — campaigns/variants whose committed pre-order units
 *     exceed the configured cap (campaign `maxPerCampaign` or per-variant
 *     `unitsOffered`). Enforced upstream, so this should be 0; a non-zero value
 *     is a real breach, surfaced rather than hidden.
 *   - untaggedOrders — pre-order rows tied to a real order (`shopifyOrderId`)
 *     that we have not confirmed tagged (`tagged=false`). orders/create retries
 *     until the tag is verified, so steady state is 0.
 *   - waitlist delivery — SENT / (SENT+FAILED) over dispatched back-in-stock
 *     notifications (never silently dropped — every one ends SENT or FAILED).
 */
import prisma from "../db.server";

export type ReliabilityReport = {
  oversellIncidents: number;
  untaggedOrders: number;
  waitlistSent: number;
  waitlistFailed: number;
  waitlistDeliveryRate: number | null; // 0..1; null when nothing has been dispatched
  clean: boolean; // oversell == 0 && untagged == 0
};

type CampaignCap = { id: string; maxPerCampaign: number | null; variantConfigs: string };
type VariantConfig = { variantId?: string; unitsOffered?: number | null };

const numId = (g?: string | null): string =>
  g ? String(g).split("/").pop() || "" : "";

// PreOrder.tagged + WaitlistSubscription.notifyStatus land via `prisma db push`;
// reach the new fields through narrow casts so this typechecks before the client
// regenerates on the Mac.
const preOrderCast = prisma as unknown as {
  preOrder: {
    count(a: { where: Record<string, unknown> }): Promise<number>;
    groupBy(a: {
      by: ["campaignId"];
      where: Record<string, unknown>;
      _sum: { units: true };
    }): Promise<{ campaignId: string; _sum: { units: number | null } }[]>;
    findMany(a: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<{ campaignId: string; variantId: string | null; units: number }[]>;
  };
};
const wlCast = prisma as unknown as {
  waitlistSubscription: {
    count(a: { where: Record<string, unknown> }): Promise<number>;
  };
};

export async function getReliability(shop: string): Promise<ReliabilityReport> {
  const [campaigns, perCampaign, lines, sent, failed, untaggedOrders] =
    await Promise.all([
      prisma.campaign.findMany({
        where: { shop },
        select: { id: true, maxPerCampaign: true, variantConfigs: true },
      }) as unknown as Promise<CampaignCap[]>,
      preOrderCast.preOrder.groupBy({
        by: ["campaignId"],
        where: { shop },
        _sum: { units: true },
      }),
      preOrderCast.preOrder.findMany({
        where: { shop },
        select: { campaignId: true, variantId: true, units: true },
      }),
      wlCast.waitlistSubscription.count({ where: { shop, notifyStatus: "SENT" } }),
      wlCast.waitlistSubscription.count({ where: { shop, notifyStatus: "FAILED" } }),
      preOrderCast.preOrder.count({
        where: { shop, shopifyOrderId: { not: null }, tagged: false },
      }),
    ]);

  let oversellIncidents = 0;

  // ---- campaign-level overcommit ----
  const committedByCampaign = new Map<string, number>();
  for (const g of perCampaign) {
    committedByCampaign.set(g.campaignId, g._sum.units ?? 0);
  }
  for (const c of campaigns) {
    if (
      c.maxPerCampaign != null &&
      (committedByCampaign.get(c.id) ?? 0) > c.maxPerCampaign
    ) {
      oversellIncidents += 1;
    }
  }

  // ---- variant-level overcommit (unitsOffered) ----
  const committedByVariant = new Map<string, number>(); // `${campaignId}|${variantNumericId}`
  for (const l of lines) {
    const v = numId(l.variantId);
    if (!v) continue;
    const k = `${l.campaignId}|${v}`;
    committedByVariant.set(k, (committedByVariant.get(k) ?? 0) + l.units);
  }
  for (const c of campaigns) {
    let cfgs: VariantConfig[] = [];
    try {
      cfgs = JSON.parse(c.variantConfigs) as VariantConfig[];
    } catch {
      /* ignore malformed variantConfigs */
    }
    for (const cfg of cfgs) {
      if (typeof cfg.unitsOffered === "number" && cfg.unitsOffered > 0) {
        const committed = committedByVariant.get(`${c.id}|${numId(cfg.variantId)}`) ?? 0;
        if (committed > cfg.unitsOffered) oversellIncidents += 1;
      }
    }
  }

  const dispatched = sent + failed;
  return {
    oversellIncidents,
    untaggedOrders,
    waitlistSent: sent,
    waitlistFailed: failed,
    waitlistDeliveryRate: dispatched > 0 ? sent / dispatched : null,
    clean: oversellIncidents === 0 && untaggedOrders === 0,
  };
}
