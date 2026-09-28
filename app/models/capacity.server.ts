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
 * sold-out / back-in-stock. Reversible: cancelled orders (PreOrder rows marked
 * REFUNDED by the orders/cancelled webhook) no longer count, so their units
 * come back on the next config fetch.
 *
 * The per-variant cap is the tighter of Limit quantity and End quantity
 * (lib/cap-shared.ts). The checkout-validation Function enforces the same
 * numbers at checkout (preorder-cap.server.ts).
 */

import prisma from "../db.server";
import { effectiveVariantCap, RELEASED_PAYMENT_STATUSES, type VariantCapConfig } from "../lib/cap-shared";

/** Units that still hold a preorder slot (cancelled / refunded ones don't). */
const HELD = { paymentStatus: { notIn: [...RELEASED_PAYMENT_STATUSES] } };

export type Capacity = {
  capped: boolean; // a limit applies
  remaining: number | null; // null = uncapped
  soldOut: boolean;
};

type VariantConfig = VariantCapConfig;

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
      where: { shop, campaignId: campaign.id, ...HELD },
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
      unitsOffered = effectiveVariantCap(hit);
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
          ...HELD,
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
