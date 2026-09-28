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
import { getSettings } from "../models/settings.server";
import { syncContact } from "../services/contact-sync.server";

// Plain, permissive email check (RFC-complete validation isn't the goal — this
// stops typos like "name@", "name.com" and junk from filling the waitlist).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Light abuse guard: at most N new signups per shop per minute (in memory; the
// proxy is per-shop signed by Shopify, so this only caps floods).
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;
const recent = new Map<string, number[]>();
function rateLimited(shop: string): boolean {
  const now = Date.now();
  const hits = (recent.get(shop) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_MAX) {
    recent.set(shop, hits);
    return true;
  }
  hits.push(now);
  recent.set(shop, hits);
  return false;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
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
  if (email && !EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  const consent = body.consent === true || body.consent === "true" || body.consent === "on";
  // "Require the consent box" (stored as doubleOptIn): no tick → no signup.
  const bisSettings = (await getSettings(session.shop)).backInStock as { doubleOptIn?: boolean };
  if (bisSettings?.doubleOptIn === true && !consent) {
    return Response.json({ ok: false, error: "consent_required" }, { status: 400 });
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

  // Dedupe: same shop + product + variant + email (or phone), still subscribed.
  const existing = await prisma.waitlistSubscription.findFirst({
    where: {
      shop: session.shop,
      productId,
      variantId,
      subscribed: true,
      ...(email ? { email } : { phone }),
    },
  });

  if (!existing && rateLimited(session.shop)) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }

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
        consentAt: consent ? new Date() : null,
      },
    });

    // Shopify Flow: "Waitlist signup" trigger (best-effort; only on a genuinely
    // new signup, not on a dedupe).
    await emitFlow(session.shop, FLOW_WAITLIST_SIGNUP, {
      email: email || "",
      phone: phone || "",
      product: body.product_title ? String(body.product_title) : "",
      variant_id: variantId ?? "",
      market: market ?? "",
    });

    // Save the contact where the merchant chose (Klaviyo list / Shopify
    // customer) — after answering the shopper, never blocking the popup.
    void syncContact(session.shop, admin, {
      email: email || null,
      phone: phone || null,
      productTitle: body.product_title ? String(body.product_title) : null,
      variantTitle: body.variant_title ? String(body.variant_title) : null,
      locale,
    }).then((r) => {
      if (!r.ok) console.error(`[notify] contact sync to ${r.target} failed: ${r.error}`);
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
