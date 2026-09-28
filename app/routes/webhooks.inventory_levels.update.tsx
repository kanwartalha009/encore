import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getMarketRule, touchReconciled } from "../models/markets.server";
import { invalidateShopStock, syncMarketBlocksSafe } from "../models/market-stock.server";
import prisma from "../db.server";
import { hasPendingSubscribers, notifyRestocked } from "../services/waitlist-notify.server";

// inventory_levels/update carries no Protected Customer Data, so it runs without
// PCD approval. Two jobs:
//   1. Back-in-stock restock trigger (2026-09-28): when a location's available
//      quantity goes above zero, notify that variant's waiting subscribers.
//      Before this, only products/update triggered sends, so a plain stock
//      adjustment could leave subscribers waiting. Each subscriber is claimed
//      atomically before sending, so products/update firing for the same
//      restock can't send a second email.
//   2. Per-market reconciliation timestamp (surfaced on /app/markets).
//   3. Per-market stock (2026-09-28): drop the shop's cached per-location stock
//      (storefront config) and recompute the variant's `encore.market_blocked`
//      checkout guard — only for shops with a live product-level preorder, and
//      market_stock.server returns before any API call for single-market shops.
type InventoryLevelPayload = {
  inventory_item_id?: number | string;
  location_id?: number | string;
  available?: number | null;
};

const VARIANT_FOR_ITEM = `#graphql
  query EncoreVariantForInventoryItem($id: ID!) {
    inventoryItem(id: $id) { variant { id product { id } } }
  }`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} from ${shop}`);

  try {
    await touchReconciled(shop);

    const p = payload as unknown as InventoryLevelPayload;
    invalidateShopStock(shop);
    // Isolated: a per-market hiccup must never fail the webhook (Shopify would
    // retry it) or skip the back-in-stock sends below.
    try {
      if (p.inventory_item_id != null && admin) {
        // One market on record → nothing to guard (0 = never reconciled: the
        // sync takes the snapshot once).
        const markets = Object.keys((await getMarketRule(shop)).marketSnapshot).length;
        const live =
          markets === 1 ? 0 : await prisma.campaign.count({ where: { shop, status: "LIVE", productMode: "SPECIFIC" } });
        if (live > 0) {
          const res = await admin.graphql(VARIANT_FOR_ITEM, {
            variables: { id: `gid://shopify/InventoryItem/${p.inventory_item_id}` },
          });
          const body = (await res.json()) as {
            data?: { inventoryItem?: { variant?: { id: string } | null } | null };
          };
          const vid = body.data?.inventoryItem?.variant?.id;
          if (vid) await syncMarketBlocksSafe(admin, shop, { variantIds: [vid] });
        }
      }
    } catch (err) {
      console.error("[webhook] inventory_levels/update: market stock sync failed", err);
    }
    // Fires on every stock change (sales included) — only look the variant up
    // when someone is actually waiting in this shop.
    if ((p.available ?? 0) > 0 && p.inventory_item_id != null && admin && (await hasPendingSubscribers(shop))) {
      const res = await admin.graphql(VARIANT_FOR_ITEM, {
        variables: { id: `gid://shopify/InventoryItem/${p.inventory_item_id}` },
      });
      const body = (await res.json()) as {
        data?: { inventoryItem?: { variant?: { id: string; product?: { id: string } } | null } | null };
      };
      const v = body.data?.inventoryItem?.variant;
      if (v?.id && v.product?.id) {
        const r = await notifyRestocked(shop, [{ productId: v.product.id, variantId: v.id }]);
        if (r.attempted) {
          console.log(`[webhook] inventory_levels/update: back-in-stock ${r.sent} sent, ${r.failed} failed for ${shop}`);
        }
      }
    }
  } catch (err) {
    console.error("[webhook] inventory_levels/update handler failed", err);
    return new Response("Handler failed", { status: 500 });
  }

  return new Response();
};
