/**
 * GET /klaviyo/connect — start the Klaviyo OAuth flow (N4).
 * Authenticated (embedded admin → shop), sets the signed PKCE cookie, and
 * redirects to Klaviyo's authorize page.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";
import { startOAuth, klaviyoConfigured } from "../services/klaviyo-oauth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!klaviyoConfigured()) {
    return redirect("/app/notifications?klaviyo=unconfigured");
  }
  const { url, cookie } = startOAuth(session.shop);
  return redirect(url, { headers: { "Set-Cookie": cookie } });
};
