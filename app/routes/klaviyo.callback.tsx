/**
 * GET /klaviyo/callback — Klaviyo OAuth redirect target (N4).
 * Verifies the signed PKCE cookie + state, exchanges the code for a token
 * (encrypted at rest), and returns the merchant to the Notifications screen.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { readCookie, finishOAuth, clearCookie } from "../services/klaviyo-oauth.server";
import { adminAppUrl } from "../lib/admin-url.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const ck = readCookie(request.headers.get("Cookie"));
  const headers = { "Set-Cookie": clearCookie() };

  // Top-level redirect from Klaviyo: send the merchant back into the admin
  // (embedded URL), not to a bare /app/... which would show the login form.
  if (!code || !ck || ck.state !== state) {
    return redirect(ck ? adminAppUrl(ck.shop, "/app/notifications?klaviyo=error") : "/auth/login", { headers });
  }
  const ok = await finishOAuth(ck.shop, code, ck.verifier);
  return redirect(adminAppUrl(ck.shop, `/app/notifications?klaviyo=${ok ? "connected" : "error"}`), {
    headers,
  });
};
