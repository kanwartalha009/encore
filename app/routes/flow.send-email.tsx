/**
 * POST /flow/send-email — runtime endpoint for the "Encore — Send email" Flow action.
 *
 * Shopify Flow can't email a dynamic customer from its built-in action, so the
 * merchant's Flow (from our template) calls this with a message_type + recipient
 * (+ variables mapped from Flow Liquid). We resolve the merchant's editable,
 * translatable template, render it, and send via the configured transport.
 *
 * HMAC-verified (same scheme as webhooks). Returns 200 on success or permanent
 * skip; 5xx on a transient provider/transport error so Flow retries the step.
 */
import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import {
  resolveTemplate,
  applyVars,
  MESSAGE_TYPE_VALUES,
  type MessageType,
} from "../services/notifications.server";
import { sendEmail } from "../services/email.server";

type FlowActionBody = {
  shopify_domain?: string;
  properties?: Record<string, unknown>;
};

function verifyHmac(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  if (!secret) return false;
  const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(header));
  } catch {
    return false;
  }
}

const str = (v: unknown): string => (v == null ? "" : String(v)).trim();

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const raw = await request.text();
  if (!verifyHmac(raw, request.headers.get("X-Shopify-Hmac-Sha256"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: FlowActionBody;
  try {
    body = JSON.parse(raw) as FlowActionBody;
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const shop = str(body.shopify_domain);
  const p = body.properties ?? {};
  const type = str(p.message_type) as MessageType;
  const to = str(p.recipient) || str(p.email);

  // Nothing actionable — ack so Flow doesn't retry a malformed step.
  if (!shop || !MESSAGE_TYPE_VALUES.includes(type) || !to) {
    return json({ ok: false, reason: "missing_type_or_recipient" });
  }

  const locale = str(p.locale) || "en";
  const vars: Record<string, string> = {
    customer_name: str(p.customer_name) || "there",
    product: str(p.product),
    variant: str(p.variant),
    ship_date: str(p.ship_date),
    new_ship_date: str(p.new_ship_date),
    old_ship_date: str(p.old_ship_date),
    deposit: str(p.deposit),
    balance: str(p.balance),
    due_date: str(p.due_date),
    pay_link: str(p.pay_link),
    product_url: str(p.product_url),
    order_name: str(p.order_name),
  };

  const tpl = await resolveTemplate(shop, type, locale, vars);
  const subjectOverride = str(p.subject_override);
  const bodyOverride = str(p.body_override);
  const subject = subjectOverride ? applyVars(subjectOverride, vars) : tpl.subject;
  const text = bodyOverride ? applyVars(bodyOverride, vars) : tpl.body;

  const result = await sendEmail({ to, subject, text });
  if (!result.ok) {
    console.error(`[flow] send-email (${type}) failed: ${result.reason}`);
    // Transient (provider error / network) → 5xx so Flow retries. Config/recipient
    // problems → 200 ack (retrying won't help; the reason is logged + visible).
    if (
      result.reason.startsWith("provider_") ||
      result.reason.startsWith("transport_error")
    ) {
      return new Response("Retry", { status: 503 });
    }
    return json({ ok: false, reason: result.reason });
  }
  return json({ ok: true });
};

export const loader = async (_args: LoaderFunctionArgs) =>
  new Response("Method Not Allowed", { status: 405 });
