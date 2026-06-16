import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { notifyRestocked } from "../services/waitlist-notify.server";
import { emitFlow, FLOW_RESTOCK_DETECTED } from "../services/flow.server";

// products/update carries no Protected Customer Data, so (unlike orders/*) it can
// run without PCD approval. Shopify also fires it on inventory changes, which is
// our restock signal for back-in-stock.
type ProductUpdatePayload = {
  id: number;
  title?: string;
  variants?: { id: number; inventory_quantity?: number | null }[];
};

const tail = (g?: string | null): string =>
  g ? String(g).split("/").pop() || "" : "";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} from ${shop}`);

  try {
    const p = payload as unknown as ProductUpdatePayload;
    const restocked = (p.variants ?? [])
      .filter((v) => (v.inventory_quantity ?? 0) > 0)
      .map((v) => ({
        productId: `gid://shopify/Product/${p.id}`,
        variantId: `gid://shopify/ProductVariant/${v.id}`,
      }));

    if (restocked.length) {
      const r = await notifyRestocked(shop, restocked);
      if (r.attempted) {
        console.log(
          `[webhook] products/update: back-in-stock ${r.sent} sent, ${r.failed} failed for ${shop}`,
        );

        // Shopify Flow: "Restock detected" trigger, one per restocked variant
        // that had waiters. Best-effort; only fires when there was demand
        // (r.attempted > 0), so merchants aren't spammed for restocks nobody
        // was waiting on.
        const subs = await prisma.waitlistSubscription
          .findMany({
            where: { shop, subscribed: true },
            select: { productId: true, variantId: true },
          })
          .catch(() => [] as { productId: string; variantId: string | null }[]);
        for (const item of restocked) {
          const variant = (p.variants ?? []).find(
            (v) => `gid://shopify/ProductVariant/${v.id}` === item.variantId,
          );
          const vn = tail(item.variantId);
          const pn = tail(item.productId);
          const waiters = subs.filter((s) =>
            s.variantId ? tail(s.variantId) === vn : tail(s.productId) === pn,
          ).length;
          await emitFlow(shop, FLOW_RESTOCK_DETECTED, {
            product: p.title ?? "",
            variant_id: item.variantId,
            available: String(variant?.inventory_quantity ?? ""),
            waitlist_count: String(waiters),
          });
        }
      }
    }
  } catch (err) {
    console.error("[webhook] products/update handler failed", err);
    return new Response("Handler failed", { status: 500 });
  }

  return new Response();
};
