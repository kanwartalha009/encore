/**
 * GET /klaviyo/connect — start the Klaviyo OAuth flow (N4).
 *
 * Called by the Notifications page with a fetcher (App Bridge session token),
 * NOT by a document navigation: inside the admin iframe a document request
 * has no shop/host params and would end on the login form, and Klaviyo's
 * authorize page cannot load inside the iframe anyway. Returns the authorize
 * URL as JSON (+ the signed PKCE cookie); the page then opens it top-level
 * via window.open(url, "_top") which App Bridge routes out of the iframe.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { startOAuth, klaviyoConfigured } from "../services/klaviyo-oauth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!klaviyoConfigured()) {
    return Response.json({ error: "unconfigured" }, { status: 200 });
  }
  const { url, cookie } = startOAuth(session.shop);
  return Response.json({ url }, { headers: { "Set-Cookie": cookie } });
};
