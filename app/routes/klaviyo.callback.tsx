/**
 * GET /klaviyo/callback — Klaviyo OAuth redirect target (N4).
 * Verifies the signed PKCE cookie + state, exchanges the code for a token
 * (encrypted at rest), and returns the merchant to the Notifications screen.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { readCookie, finishOAuth, clearCookie } from "../services/klaviyo-oauth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const ck = readCookie(request.headers.get("Cookie"));
  const headers = { "Set-Cookie": clearCookie() };

  if (!code || !ck || ck.state !== state) {
    return redirect("/app/notifications?klaviyo=error", { headers });
  }
  const ok = await finishOAuth(ck.shop, code, ck.verifier);
  return redirect(`/app/notifications?klaviyo=${ok ? "connected" : "error"}`, {
    headers,
  });
};
