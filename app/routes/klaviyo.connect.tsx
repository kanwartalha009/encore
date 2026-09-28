/**
 * GET /klaviyo/connect — start the Klaviyo OAuth flow (N4).
 *
 * Called by the Notifications / Settings page with a fetcher (App Bridge
 * session token), NOT by a document navigation: inside the admin iframe a
 * document request has no shop/host params and would end on the login form,
 * and Klaviyo's authorize page cannot load inside the iframe anyway. Returns
 * the authorize URL as JSON; the page opens it top-level via
 * window.open(url, "_top"), which App Bridge routes out of the iframe. The
 * shop + PKCE verifier ride in the sealed `state` (no cookie, 2026-09-28).
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { startOAuth, klaviyoConfigured } from "../services/klaviyo-oauth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!klaviyoConfigured()) {
    return Response.json({ error: "unconfigured" }, { status: 200 });
  }
  const { url } = startOAuth(session.shop);
  return Response.json({ url });
};
