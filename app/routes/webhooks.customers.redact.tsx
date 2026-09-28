/**
 * GDPR compliance webhook — customers/redact.
 * Delete the customer's PII: waitlist contact rows (by email, or phone for
 * phone-only sign-ups) are removed; preorder rows for the customer's email and
 * every order in `orders_to_redact` are kept but stripped of PII; split-cart
 * links for the customer id are removed. Returns 500 on failure so Shopify
 * retries until the redaction is confirmed (the obligation must complete
 * within 30 days).
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { redactCustomer, type GdprRequest } from "../services/gdpr.server";
import { forwardToIngress } from "../lib/nova.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`[gdpr] ${topic} for ${shop}`);

  await forwardToIngress({
    topic,
    shopDomain: shop,
    webhookId: request.headers.get("X-Shopify-Webhook-Id"),
    payload,
  });

  try {
    const r = await redactCustomer(shop, payload as GdprRequest);
    console.log(
      `[gdpr] redact ${shop}: ${r.waitlistDeleted} waitlist deleted, ${r.preordersAnonymized} preorder(s) anonymized, ${r.bundlesDeleted} link(s) deleted, ${r.outboxDeleted} outbox copy(ies) deleted`,
    );
  } catch (e) {
    console.error("[gdpr] customers/redact failed", e);
    return new Response("Redaction failed", { status: 500 });
  }
  return new Response();
};
