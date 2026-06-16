import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import {
  processOrderPaid,
  type ShopifyOrderPayload,
} from "../services/orders.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} from ${shop}`);

  try {
    const order = payload as unknown as ShopifyOrderPayload;
    const { updated } = await processOrderPaid(shop, order);
    if (updated > 0) {
      console.log(
        `[webhook] orders/paid: marked ${updated} PreOrder(s) BALANCE_PAID for ${shop} order ${order.name ?? order.id}`,
      );
    }
  } catch (err) {
    console.error("[webhook] orders/paid handler failed", err);
    return new Response("Handler failed", { status: 500 });
  }

  return new Response();
};
