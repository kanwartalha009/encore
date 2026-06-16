/**
 * GET /apps/encore/config?product_id=…&locale=…
 *
 * App-proxy endpoint the storefront blocks call to learn whether a product is on
 * preorder / low stock / back-in-stock and with what copy. Validated by
 * authenticate.public.appProxy (HMAC-signed by Shopify).
 */
import type { LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import { getStorefrontConfig } from "../models/storefront.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);
  if (!session) {
    return Response.json({ error: "app_not_installed" }, { status: 401 });
  }

  const url = new URL(request.url);
  const productId = url.searchParams.get("product_id") || "";
  const variantId = url.searchParams.get("variant_id") || "";
  const locale = (url.searchParams.get("locale") || "en").toLowerCase().slice(0, 2);
  const marketId = url.searchParams.get("market_id") || "";

  const config = await getStorefrontConfig(
    session.shop,
    productId,
    variantId,
    locale,
    marketId,
  );

  return Response.json(config, {
    headers: { "Cache-Control": "no-store" },
  });
};
