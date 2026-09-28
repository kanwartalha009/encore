/**
 * GDPR compliance webhook — customers/data_request.
 * Gather the customer's stored data (by email, phone, customer id and the
 * requested orders) and email it to the store owner, the data controller who
 * answers the customer (2026-09-28 — previously only a count was logged).
 * `authenticate.webhook` verifies the HMAC and returns 401 on a bad signature.
 *
 * The export + email run after the 200 is returned, so a slow email provider
 * can't push the handler past Shopify's 5-second webhook limit (which would
 * make Shopify retry and send the owner duplicate emails).
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { deliverDataRequest, type GdprRequest } from "../services/gdpr.server";
import { forwardToIngress } from "../lib/nova.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[gdpr] ${topic} for ${shop}`);

  // Forward to Nova (signed) — the platform records compliance requests (§5.2).
  await forwardToIngress({
    topic,
    shopDomain: shop,
    webhookId: request.headers.get("X-Shopify-Webhook-Id"),
    payload,
  });

  // Never echo PII in the webhook response; deliverDataRequest never throws.
  void deliverDataRequest(shop, payload as GdprRequest & { data_request?: { id?: number | string | null } });
  return new Response();
};
