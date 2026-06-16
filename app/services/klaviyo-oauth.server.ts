/**
 * Klaviyo OAuth (N4) — the productized connection (preferred over a pasted key).
 *
 * The merchant clicks "Connect Klaviyo" → /klaviyo/connect (we set a signed,
 * httpOnly cookie carrying the PKCE verifier + state and redirect to Klaviyo) →
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

const AUTHORIZE_URL = "https://www.klaviyo.com/oauth/authorize";
const TOKEN_URL = "https://a.klaviyo.com/oauth/token";
// Adjust to match the scopes selected in the Klaviyo app registration.
const SCOPES =
  "accounts:read events:write profiles:write metrics:read flows:read subscriptions:write";
const COOKIE = "encore_kl_oauth";

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
function sign(data: string): string {
  return crypto
    .createHmac("sha256", process.env.SHOPIFY_API_SECRET ?? "")
    .update(data)
    .digest("base64url");
}

// ---- OAuth start (PKCE + signed cookie) ----
export type OAuthStart = { url: string; cookie: string };

export function startOAuth(shop: string): OAuthStart {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.ENCORE_KLAVIYO_CLIENT_ID ?? "",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  const data = Buffer.from(JSON.stringify({ shop, state, verifier })).toString("base64url");
  const cookie = `${COOKIE}=${data}.${sign(data)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
  return { url: `${AUTHORIZE_URL}?${params.toString()}`, cookie };
}

export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readCookie(
  header: string | null,
): { shop: string; state: string; verifier: string } | null {
  if (!header) return null;
  const m = header.match(new RegExp(COOKIE + "=([^;]+)"));
  if (!m) return null;
  const [data, mac] = m[1].split(".");
  if (!data || !mac || sign(data) !== mac) return null;
  try {
    return JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }
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
