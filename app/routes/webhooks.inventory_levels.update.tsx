import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { touchReconciled } from "../models/markets.server";

// Per-market reconciliation signal. inventory_levels/update carries no PCD, so it
// runs without Protected Customer Data approval. For now it stamps the last
// reconcile time (surfaced on /app/markets); the full per-market location→stock
// recompute is the follow-up.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} from ${shop}`);

  try {
    await touchReconciled(shop);
  } catch (err) {
    console.error("[webhook] inventory_levels/update handler failed", err);
    return new Response("Handler failed", { status: 500 });
  }

  return new Response();
};
