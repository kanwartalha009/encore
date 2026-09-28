/**
 * GET /klaviyo/callback — Klaviyo OAuth redirect target (N4).
 * Opens the sealed `state` (shop + PKCE verifier, 10-minute expiry) and sends
 * the merchant back to Notifications inside the admin with the code sealed;
 * the Notifications loader exchanges it only for the logged-in shop
 * (klaviyo-oauth.server finishOAuthForSession). Token encrypted at rest.
 */
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { readState, sealCallback } from "../services/klaviyo-oauth.server";
import { adminAppUrl } from "../lib/admin-url.server";

// Clears the cookie the pre-2026-09-28 flow set, for anyone mid-flow at deploy.
const CLEAR_OLD_COOKIE = "encore_kl_oauth=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const st = readState(url.searchParams.get("state") ?? "");
  const headers = { "Set-Cookie": CLEAR_OLD_COOKIE };

  // Top-level redirect from Klaviyo: send the merchant back into the admin
  // (embedded URL), not to a bare /app/... which would show the login form.
  if (!st) return redirect("/auth/login", { headers });
  if (!code) return redirect(adminAppUrl(st.shop, "/app/notifications?klaviyo=error"), { headers });
  const sealed = sealCallback(st.shop, code, st.verifier);
  return redirect(adminAppUrl(st.shop, `/app/notifications?klaviyo_code=${encodeURIComponent(sealed)}`), {
    headers,
  });
};
