import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  applyPreorderOrderMetadata,
  processOrderCreate,
  refreshCapsForOrder,
  type ShopifyOrderPayload,
} from "../services/orders.server";
import { emitFlow, FLOW_PREORDER_PLACED } from "../services/flow.server";
import { markWaitlistConverted } from "../services/benchmark.server";
import { getNotificationSettings, resolveTemplate } from "../services/notifications.server";
import { klaviyoEvent } from "../services/klaviyo.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} from ${shop}`);

  try {
    const order = payload as unknown as ShopifyOrderPayload;
    const result = await processOrderCreate(shop, order);

    // Phase 5: stamp any waitlisted shoppers who just converted (recovered demand
    // — the benchmark vs the incumbent). Best-effort; never blocks the ack.
    await markWaitlistConverted(shop, order).catch((e) =>
      console.error("[webhook] orders/create: waitlist conversion match failed", e),
    );

    if (result.createdCount > 0) {
      console.log(
        `[webhook] orders/create: created ${result.createdCount} PreOrder(s) for ${shop} order ${order.name ?? order.id}`,
      );
    }

    // Tag the order + write the ship-date metafield (verified post-write).
    if (result.isPreorder) {
      const meta = await applyPreorderOrderMetadata(
        shop,
        result.orderGid,
        result.tags,
        result.shipDates,
      );
      if (!meta.ok) {
        // Return 500 so Shopify retries until tagging is confirmed — never let
        // a preorder order sit untagged (reliability bar §8).
        console.error(
          "[webhook] orders/create: tag/metafield write incomplete",
          meta.warnings,
        );
        return new Response("Tagging incomplete", { status: 500 });
      }

      // Refresh per-variant remaining metafields for the checkout-validation
      // Function. Best-effort — caps are also recomputed live in the proxy.
      await refreshCapsForOrder(shop, result.variantsByCampaign).catch((e) =>
        console.error("[webhook] orders/create: cap refresh failed", e),
      );

      // §8 reliability: we only reach here after the tag + ship-date metafield
      // write verified (meta.ok), so confirm these preorder rows as tagged. This
      // powers the dashboard untagged-order audit (steady state 0).
      await (
        prisma as unknown as {
          preOrder: {
            updateMany(a: {
              where: Record<string, unknown>;
              data: Record<string, unknown>;
            }): Promise<unknown>;
          };
        }
      ).preOrder
        .updateMany({
          where: { shop, shopifyOrderId: result.orderGid },
          data: { tagged: true },
        })
        .catch((e) => console.error("[webhook] orders/create: tagged stamp failed", e));

      // Shopify Flow: "Preorder placed" trigger (best-effort; emitFlow swallows
      // its own errors so it can never fail the webhook). Representative line =
      // the first pre-order line on the order.
      const lines = order.line_items ?? [];
      const preLine =
        lines.find((li) =>
          (li.properties ?? []).some(
            (pp) => pp.name === "_preorder_campaign_id" || pp.name === "_preorder",
          ),
        ) ?? lines[0];
      const liProp = (n: string) =>
        String((preLine?.properties ?? []).find((pp) => pp.name === n)?.value ?? "");
      await emitFlow(shop, FLOW_PREORDER_PLACED, {
        order_id: result.orderGid,
        product: preLine?.title ?? "",
        variant_id: preLine?.variant_id
          ? `gid://shopify/ProductVariant/${preLine.variant_id}`
          : "",
        market: liProp("_preorder_market"),
        ship_date: (result.shipDates ?? [])[0] ?? "",
      });

      // Klaviyo path: "Encore Preorder Placed" event with editable/translatable
      // copy (provider-gated; dormant until PCD enables orders/* like the rest).
      const ns = await getNotificationSettings(shop);
      if (ns.provider === "klaviyo") {
        const email =
          order.email ?? order.contact_email ?? order.customer?.email ?? "";
        if (email) {
          const vars = {
            customer_name: order.customer?.first_name ?? "there",
            product: preLine?.title ?? "",
            ship_date: (result.shipDates ?? [])[0] ?? "",
            order_name: order.name ?? "",
          };
          const copy = await resolveTemplate(
            shop,
            "preorder_confirmation",
            (order.customer_locale ?? "").slice(0, 2) || "en",
            vars,
          );
          await klaviyoEvent(shop, "Encore Preorder Placed", email, {
            Product: vars.product,
            ShipDate: vars.ship_date,
            OrderName: vars.order_name,
            EmailSubject: copy.subject,
            EmailBody: copy.body,
            Source: "Encore",
          });
        }
      }
    }
  } catch (err) {
    console.error("[webhook] orders/create handler failed", err);
    // Return 500 so Shopify retries.
    return new Response("Handler failed", { status: 500 });
  }

  return new Response();
};
