/**
 * GDPR compliance webhook — customers/data_request.
 * Gather the customer's stored data so the merchant (data controller) can fulfil
 * the request. `authenticate.webhook` verifies the HMAC and returns 401 on a bad
 * signature; we respond 200 on success.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { exportCustomerData } from "../services/gdpr.server";
import { forwardToIngress } from "../lib/nova.server";

type Payload = { customer?: { email?: string | null } };

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

  const email = (payload as Payload).customer?.email ?? "";
  try {
    const data = await exportCustomerData(shop, email);
    // Production delivers `data` to the merchant. We log a non-PII summary so the
    // request is auditable; we never echo PII back in the webhook response.
    console.log(
      `[gdpr] data_request ${shop}: ${data.waitlistSubscriptions.length} waitlist + ${data.preorders.length} preorder record(s)`,
    );
  } catch (e) {
    console.error("[gdpr] data_request gather failed", e);
  }
  return new Response();
};
