import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { storeReferral } from "../lib/referral.server";

/**
 * Agency referral landing — the automatic attribution front door.
 *
 *   https://<app-url>/install?ref=<agencySlug>&shop=<merchant>.myshopify.com
 *
 * The agency shares this link. We record the ref keyed by shop (survives OAuth), then hand off to
 * the normal install flow (/app?shop=…), which begins OAuth. afterAuth consumes the ref and sends
 * it to Nova, which provisions the store under the referring agency (immutable attribution, I-8).
 *
 * If no shop is supplied we fall through to the standard shop-entry form; the install is then
 * treated as direct/house (Nova's NOVA_DEFAULT_AGENCY_SLUG).
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const ref = url.searchParams.get("ref")?.trim();
  const shop = url.searchParams.get("shop")?.trim();

  if (ref && shop) {
    await storeReferral(shop, ref);
    // Preserve any Shopify params (host/embedded) and begin the install.
    const passthrough = new URLSearchParams(url.searchParams);
    passthrough.delete("ref");
    throw redirect(`/app?${passthrough.toString()}`);
  }

  // No shop → can't key the referral; send to the standard login/entry form.
  throw redirect("/auth/login");
};
