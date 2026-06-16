/**
 * GDPR compliance webhook — customers/redact.
 * Delete the customer's PII: waitlist contact rows are removed; order/accounting
 * rows are kept but stripped of PII. Returns 500 on failure so Shopify retries
 * until the redaction is confirmed (the obligation must complete within 30 days).
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { redactCustomer } from "../services/gdpr.server";
import { forwardToIngress } from "../lib/nova.server";

type Payload = { customer?: { email?: string | null } };

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[gdpr] ${topic} for ${shop}`);

  await forwardToIngress({
    topic,
    shopDomain: shop,
    webhookId: request.headers.get("X-Shopify-Webhook-Id"),
    payload,
  });

  const email = (payload as Payload).customer?.email ?? "";
  try {
    const r = await redactCustomer(shop, email);
    console.log(
      `[gdpr] redact ${shop}: ${r.waitlistDeleted} waitlist deleted, ${r.preordersAnonymized} preorder(s) anonymized`,
    );
  } catch (e) {
    console.error("[gdpr] customers/redact failed", e);
    return new Response("Redaction failed", { status: 500 });
  }
  return new Response();
};
