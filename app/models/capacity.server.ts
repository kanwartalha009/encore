/**
 * Preorder capacity — the no-oversell guard.
 *
 * Computes how many preorder units remain for a campaign (and, when a variant
 * is given, for that variant) by summing recorded PreOrder units against the
 * configured caps:
 *   - campaign-level: Campaign.maxPerCampaign
 *   - variant-level:  unitsOffered in Campaign.variantConfigs
 *
 * The storefront config uses this to stop offering preorder (and to stop
 * injecting the selling plan) once a cap is hit — the offer reverts to
 * sold-out / back-in-stock. Reversible: if capacity frees up (e.g. a refund),
 * the offer reappears on the next config fetch.
 *
 * Residual race: two shoppers can both see the last unit between fetch and
 * add — a hard guarantee needs a checkout/cart validation Function (follow-up).
 * This offer-level cap handles the normal case and never *advertises* past the
 * limit.
 */

import prisma from "../db.server";

export type Capacity = {
  capped: boolean; // a limit applies
  remaining: number | null; // null = uncapped
  soldOut: boolean;
};

type VariantConfig = { variantId?: string; unitsOffered?: number | null };

// PreOrder.variantId is added via `prisma db push`; the generated client may not
// know it yet, so reach aggregate through a narrow cast.
const preOrder = (
  prisma as unknown as {
    preOrder: {
      aggregate(a: {
        where: Record<string, unknown>;
        _sum: { units: true };
      }): Promise<{ _sum: { units: number | null } }>;
    };
  }
).preOrder;

const numId = (g?: string | null): string =>
  g ? String(g).split("/").pop() || "" : "";

export async function getCampaignCapacity(
  shop: string,
  campaign: { id: string; maxPerCampaign: number | null; variantConfigs: string },
  variantId?: string | null,
): Promise<Capacity> {
  let remaining: number | null = null;

  // ---- campaign-level cap ----
  if (campaign.maxPerCampaign != null) {
    const agg = await preOrder.aggregate({
      where: { shop, campaignId: campaign.id },
      _sum: { units: true },
    });
    remaining = Math.max(0, campaign.maxPerCampaign - (agg._sum.units ?? 0));
  }

  // ---- variant-level cap (unitsOffered) ----
  if (variantId) {
    const vid = numId(variantId);
    let unitsOffered: number | null = null;
    try {
      const cfgs = JSON.parse(campaign.variantConfigs) as VariantConfig[];
      const hit = cfgs.find((c) => vid !== "" && numId(c.variantId) === vid);
      if (hit && typeof hit.unitsOffered === "number") unitsOffered = hit.unitsOffered;
    } catch {
      /* ignore malformed variantConfigs */
    }

    if (unitsOffered != null && unitsOffered > 0) {
      const agg = await preOrder.aggregate({
        where: {
          shop,
          campaignId: campaign.id,
          // PreOrder.variantId is stored as the GID; match common forms.
          variantId: { in: [variantId, `gid://shopify/ProductVariant/${vid}`, vid] },
        },
        _sum: { units: true },
      });
      const vRemaining = Math.max(0, unitsOffered - (agg._sum.units ?? 0));
      remaining = remaining == null ? vRemaining : Math.min(remaining, vRemaining);
    }
  }

  const soldOut = remaining != null && remaining <= 0;
  return { capped: remaining != null, remaining, soldOut };
}
