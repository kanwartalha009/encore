/**
 * GET /apps/encore/badges?handles=a,b,c&locale=…&market_id=…
 *
 * App-proxy endpoint behind the collection-page badges (R1): the app embed's
 * injector sends up to 24 product handles from the cards on the page and gets
 * back the subset that is on a live preorder plus the badge label to render.
 * Validated by authenticate.public.appProxy (HMAC-signed by Shopify).
 *
 * Cached for 60s per shop+handles+locale+market — collection pages are hit far
 * more often than campaigns change, and a badge appearing a minute late is fine.
 */
import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getPreorderBadgeHandles } from "../models/storefront.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json({ error: "app_not_installed" }, { status: 401 });
  }

  const url = new URL(request.url);
  const handles = (url.searchParams.get("handles") || "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 24);
  const locale = (url.searchParams.get("locale") || "en").toLowerCase().slice(0, 2);
  const marketId = url.searchParams.get("market_id") || "";

  const result = await getPreorderBadgeHandles(
    session.shop,
    handles,
    locale,
    marketId,
    admin ?? null,
  );

  return Response.json(result, {
    headers: { "Cache-Control": "public, max-age=60" },
  });
};
