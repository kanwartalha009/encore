/**
 * POST /apps/encore/notify
 *
 * App-proxy endpoint the back-in-stock popup posts to. Records a
 * WaitlistSubscription for the shop + product/variant, deduping repeat signups
 * for the same email. Validated by authenticate.public.appProxy.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { emitFlow, FLOW_WAITLIST_SIGNUP } from "../services/flow.server";
import { getNotificationSettings } from "../services/notifications.server";
import { subscribeBackInStock } from "../services/klaviyo.server";
import { isOverNotifyLimit } from "../services/usage.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json({ ok: false, error: "app_not_installed" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  const ct = request.headers.get("content-type") || "";
  if (ct.indexOf("application/json") !== -1) {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } else {
    const fd = await request.formData();
    body = Object.fromEntries(fd) as Record<string, unknown>;
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const phone = String(body.phone ?? "").trim();
  if (!email && !phone) {
    return Response.json({ ok: false, error: "missing_contact" }, { status: 400 });
  }

  const productId = String(body.product_id ?? "");
  if (!productId) {
    return Response.json({ ok: false, error: "missing_product" }, { status: 400 });
  }
  const variantId = body.variant_id ? String(body.variant_id) : null;
  const market = body.market ? String(body.market) : null;
  const locale = body.locale ? String(body.locale).slice(0, 5) : null;
  const channel = email && phone ? "BOTH" : phone ? "SMS" : "EMAIL";

  // Billing: stop accepting NEW notify-me signups once the shop is over its monthly
  // limit (existing waitlist untouched). Soft 200 so the popup degrades gracefully.
  if (await isOverNotifyLimit(session.shop)) {
    return Response.json({ ok: false, error: "limit_reached" }, { status: 200 });
  }

  // Dedupe: same shop + product + variant + email, still subscribed.
  const existing = email
    ? await prisma.waitlistSubscription.findFirst({
        where: { shop: session.shop, productId, variantId, email, subscribed: true },
      })
    : null;

  if (!existing) {
    await (
      prisma.waitlistSubscription.create as unknown as (a: {
        data: Record<string, unknown>;
      }) => Promise<unknown>
    )({
      data: {
        shop: session.shop,
        productId,
        variantId,
        market,
        locale,
        productTitle: body.product_title ? String(body.product_title) : null,
        variantTitle: body.variant_title ? String(body.variant_title) : null,
        email: email || null,
        phone: phone || null,
        channel,
      },
    });

    // Shopify Flow: "Waitlist signup" trigger (best-effort; only on a genuinely
    // new signup, not on a dedupe).
    await emitFlow(session.shop, FLOW_WAITLIST_SIGNUP, {
      email: email || "",
      product: body.product_title ? String(body.product_title) : "",
      variant_id: variantId ?? "",
      market: market ?? "",
    });

    // N3: Klaviyo native back-in-stock — subscribe now so Klaviyo's own BIS flow
    // fires on restock (best-effort; needs the catalog synced in their Klaviyo).
    try {
      const ns = await getNotificationSettings(session.shop);
      if (
        ns.provider === "klaviyo" &&
        ns.klaviyoBisMode === "native" &&
        variantId &&
        email
      ) {
        await subscribeBackInStock(session.shop, variantId, email);
      }
    } catch (e) {
      console.error("[notify] klaviyo native BIS subscribe failed", e);
    }
  }

  return Response.json({ ok: true, deduped: Boolean(existing) });
};

// GET isn't supported — the popup only POSTs.
export const loader = async (_args: LoaderFunctionArgs) =>
  Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
