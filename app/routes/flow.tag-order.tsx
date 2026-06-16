/**
 * POST /flow/tag-order — runtime endpoint for the "Encore — Tag order" Flow action.
 *
 * Flow POSTs the action payload here, signed with an HMAC-SHA256 of the raw body
 * using the app's API secret (same scheme as webhooks). We verify it, then add
 * the configured tag to the referenced order.
 *
 * Idempotent: `tagsAdd` is a no-op when the tag already exists, so Flow can
 * safely retry the step (we return 5xx on transient failure to request a retry,
 * 200 once the tag is applied or there's nothing to do).
 */
import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { unauthenticated } from "../shopify.server";

type FlowActionBody = {
  shopify_domain?: string;
  properties?: Record<string, unknown>;
};

function verifyHmac(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  if (!secret) return false;
  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(header));
  } catch {
    return false;
  }
}

const TAGS_ADD = `#graphql
mutation EncoreFlowTagOrder($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
}`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const rawBody = await request.text();
  if (!verifyHmac(rawBody, request.headers.get("X-Shopify-Hmac-Sha256"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: FlowActionBody;
  try {
    body = JSON.parse(rawBody) as FlowActionBody;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const shop = body.shopify_domain ?? "";
  const props = body.properties ?? {};
  const tag = String(props.tag ?? "").trim();
  // The order_reference field arrives under one of these keys depending on
  // Flow's payload shape — read defensively.
  const orderId = String(
    props.order_id ?? props.order_reference ?? props.order ?? "",
  ).trim();

  // Nothing actionable — ack so Flow doesn't retry a malformed/no-op step.
  if (!shop || !tag || !orderId) {
    return Response.json({ ok: false, reason: "missing_order_or_tag" });
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(TAGS_ADD, {
      variables: { id: orderId, tags: [tag] },
    });
    const json = (await res.json()) as {
      data?: { tagsAdd?: { userErrors?: { message: string }[] } };
    };
    const errs = json.data?.tagsAdd?.userErrors ?? [];
    if (errs.length) {
      console.error("[flow] tag-order userErrors", errs);
      return new Response("Tagging failed", { status: 422 });
    }
  } catch (e) {
    console.error("[flow] tag-order failed", e);
    // 5xx → Flow retries the action step.
    return new Response("Retry", { status: 500 });
  }

  return Response.json({ ok: true });
};

// Flow only POSTs to the runtime URL.
export const loader = async (_args: LoaderFunctionArgs) =>
  new Response("Method Not Allowed", { status: 405 });
