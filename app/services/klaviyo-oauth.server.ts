/**
 * Klaviyo OAuth (N4) — the productized connection (preferred over a pasted key).
 *
 * The merchant clicks "Connect Klaviyo" → /klaviyo/connect (we seal the shop +
 * PKCE verifier into the OAuth `state` and return Klaviyo's authorize URL) →
 * Klaviyo redirects to /klaviyo/callback → we exchange the code (with the
 * verifier) for a token, encrypt it at rest, and use it as a Bearer credential.
 *
 * Requires a Klaviyo app registered by us (one per Encore integration):
 *   ENCORE_KLAVIYO_CLIENT_ID, ENCORE_KLAVIYO_CLIENT_SECRET
 * Redirect URI = {SHOPIFY_APP_URL}/klaviyo/callback (register it in Klaviyo).
 */
import crypto from "node:crypto";
import prisma from "../db.server";
import { encryptSecret, decryptSecret } from "../lib/crypto.server";
import { seal, unseal } from "../lib/seal.server";

const AUTHORIZE_URL = "https://www.klaviyo.com/oauth/authorize";
const TOKEN_URL = "https://a.klaviyo.com/oauth/token";
// Adjust to match the scopes selected in the Klaviyo app registration.
// lists:read / lists:write (2026-09-28): back-in-stock sign-ups can be added to
// a Klaviyo list the merchant picks — reconnect Klaviyo once to grant them.
const SCOPES =
  "accounts:read events:write profiles:write metrics:read flows:read subscriptions:write lists:read lists:write";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};
type KlaviyoRow = {
  shop: string;
  accessTokenEnc: string;
  refreshTokenEnc: string | null;
  expiresAt: Date | null;
  scope: string | null;
};

const conn = (
  prisma as unknown as {
    klaviyoConnection: {
      findUnique(a: { where: { shop: string } }): Promise<KlaviyoRow | null>;
      upsert(a: {
        where: { shop: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }): Promise<unknown>;
      delete(a: { where: { shop: string } }): Promise<unknown>;
    };
  }
).klaviyoConnection;

export function klaviyoConfigured(): boolean {
  return Boolean(
    process.env.ENCORE_KLAVIYO_CLIENT_ID && process.env.ENCORE_KLAVIYO_CLIENT_SECRET,
  );
}

function redirectUri(): string {
  const base =
    process.env.SHOPIFY_APP_URL || "https://encore.nova-platform.localhost:3003";
  return base.replace(/\/$/, "") + "/klaviyo/callback";
}

function b64url(b: Buffer): string {
  return b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- OAuth start (PKCE + sealed state) ----
// The shop + PKCE verifier travel inside Klaviyo's `state` parameter, sealed
// (AES-256-GCM, 10-minute expiry — lib/seal.server). This replaced a
// SameSite=None cookie set from inside the Shopify admin iframe: browsers that
// block third-party cookies dropped it, so the callback failed (2026-09-28).
// The verifier is encrypted, so PKCE still protects the code exchange.
export type OAuthStart = { url: string };
const STATE_PURPOSE = "klaviyo-oauth";
const STATE_TTL_MS = 10 * 60 * 1000;

export function startOAuth(shop: string): OAuthStart {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = seal(STATE_PURPOSE, { shop, verifier }, STATE_TTL_MS);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ENCORE_KLAVIYO_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return { url: `${AUTHORIZE_URL}?${params.toString()}` };
}

/**
 * The callback doesn't exchange the code itself: it seals code + verifier for
 * the shop and sends the merchant back into the admin, where the exchange runs
 * inside an authenticated request for the SAME shop (finishOAuthForSession).
 * So a Klaviyo approval can only ever connect the shop of the admin user who
 * is logged in — someone tricked into approving another store's link connects
 * nothing (the job the old browser cookie did).
 */
const CODE_PURPOSE = "klaviyo-code";
export function sealCallback(shop: string, code: string, verifier: string): string {
  return seal(CODE_PURPOSE, { shop, code, verifier }, 5 * 60 * 1000);
}

export async function finishOAuthForSession(
  sessionShop: string,
  sealed: string,
): Promise<"connected" | "error"> {
  const d = unseal<{ shop?: unknown; code?: unknown; verifier?: unknown }>(CODE_PURPOSE, sealed);
  if (!d || d.shop !== sessionShop || typeof d.code !== "string" || typeof d.verifier !== "string") {
    return "error";
  }
  return (await finishOAuth(sessionShop, d.code, d.verifier)) ? "connected" : "error";
}

/** Shop + verifier from the callback's `state`, or null if invalid / expired. */
export function readState(state: string): { shop: string; verifier: string } | null {
  const d = unseal<{ shop?: unknown; verifier?: unknown }>(STATE_PURPOSE, state);
  if (!d || typeof d.shop !== "string" || typeof d.verifier !== "string") return null;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(d.shop)) return null;
  return { shop: d.shop, verifier: d.verifier };
}

// ---- Token exchange / refresh ----
async function tokenRequest(body: Record<string, string>): Promise<TokenResponse | null> {
  const id = process.env.ENCORE_KLAVIYO_CLIENT_ID ?? "";
  const secret = process.env.ENCORE_KLAVIYO_CLIENT_SECRET ?? "";
  const basic = Buffer.from(`${id}:${secret}`).toString("base64");
  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body).toString(),
    });
    if (!res.ok) {
      console.error("[klaviyo-oauth] token", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return null;
    }
    return (await res.json()) as TokenResponse;
  } catch (e) {
    console.error("[klaviyo-oauth] token error", e);
    return null;
  }
}

async function saveConnection(shop: string, t: TokenResponse): Promise<void> {
  const expiresAt = t.expires_in ? new Date(Date.now() + (t.expires_in - 60) * 1000) : null;
  const data = {
    accessTokenEnc: encryptSecret(t.access_token ?? ""),
    refreshTokenEnc: t.refresh_token ? encryptSecret(t.refresh_token) : null,
    expiresAt,
    scope: t.scope ?? null,
  };
  await conn.upsert({ where: { shop }, create: { shop, ...data }, update: data });
}

export async function finishOAuth(
  shop: string,
  code: string,
  verifier: string,
): Promise<boolean> {
  const t = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  if (!t?.access_token) return false;
  await saveConnection(shop, t);
  return true;
}

export async function isConnected(shop: string): Promise<boolean> {
  return Boolean(await conn.findUnique({ where: { shop } }));
}

export async function disconnect(shop: string): Promise<void> {
  await conn.delete({ where: { shop } }).catch(() => {});
}

/** A usable access token (refreshing if near expiry), or null if not connected. */
export async function getAccessToken(shop: string): Promise<string | null> {
  const row = await conn.findUnique({ where: { shop } });
  if (!row) return null;
  const valid = !row.expiresAt || row.expiresAt.getTime() > Date.now();
  if (valid) return decryptSecret(row.accessTokenEnc) || null;

  const refresh = row.refreshTokenEnc ? decryptSecret(row.refreshTokenEnc) : "";
  if (!refresh) return decryptSecret(row.accessTokenEnc) || null;
  const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refresh });
  if (!t?.access_token) return decryptSecret(row.accessTokenEnc) || null;
  await saveConnection(shop, { ...t, refresh_token: t.refresh_token ?? refresh });
  return t.access_token;
}
