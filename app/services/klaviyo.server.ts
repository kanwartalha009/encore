/**
 * Klaviyo HTTP (N1 + N3 + N4).
 *
 * Auth resolves to the **OAuth bearer token** when the shop has connected via
 * OAuth (preferred), otherwise the pasted private key. All Klaviyo calls go
 * through klaviyoPost so both paths get the same auth + revision handling.
 *
 *   - klaviyoEvent          — custom metric event (+ editable copy props)
 *   - subscribeBackInStock  — Klaviyo NATIVE back-in-stock (rides their catalog
 *                             + built-in BIS flow), used at notify-me signup
 */
import { getSettings } from "../models/settings.server";
import { getAccessToken } from "./klaviyo-oauth.server";
import { readKlaviyoKey } from "./klaviyo-key.server";

const REVISION = "2024-10-15";

/** OAuth bearer (preferred) → pasted private key → null. */
async function authHeader(shop: string): Promise<string | null> {
  const token = await getAccessToken(shop);
  if (token) return `Bearer ${token}`;
  const s = await getSettings(shop);
  const key = readKlaviyoKey(s.general); // encrypted at rest (klaviyo-key.server)
  return key ? `Klaviyo-API-Key ${key}` : null;
}

export async function klaviyoHasAuth(shop: string): Promise<boolean> {
  return (await authHeader(shop)) != null;
}

async function klaviyoPost(
  shop: string,
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number }> {
  const auth = await authHeader(shop);
  if (!auth) return { ok: false, status: 0 };
  try {
    const res = await fetch(`https://a.klaviyo.com${path}`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        accept: "application/json",
        revision: REVISION,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(
        `[klaviyo] ${path} ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`,
      );
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.error(`[klaviyo] ${path} failed`, e);
    return { ok: false, status: 0 };
  }
}

/** Custom metric event. Posting auto-creates the metric in the merchant's account. */
export async function klaviyoEvent(
  shop: string,
  metric: string,
  email: string,
  properties: Record<string, unknown>,
): Promise<{ ok: boolean; status: number }> {
  if (!email) return { ok: false, status: 0 };
  return klaviyoPost(shop, "/api/events/", {
    data: {
      type: "event",
      attributes: {
        metric: { data: { type: "metric", attributes: { name: metric } } },
        profile: { data: { type: "profile", attributes: { email } } },
        properties,
      },
    },
  });
}

/**
 * Klaviyo NATIVE back-in-stock subscription (N3). Subscribes the shopper to
 * Klaviyo's own BIS engine using the synced Shopify catalog variant, so Klaviyo
 * detects the restock and sends via the merchant's standard BIS flow. Requires
 * the merchant's Klaviyo Shopify catalog to contain the variant.
 */
export async function subscribeBackInStock(
  shop: string,
  shopifyVariantId: string,
  email: string,
  channels: string[] = ["EMAIL"],
): Promise<{ ok: boolean; status: number }> {
  if (!email || !shopifyVariantId) return { ok: false, status: 0 };
  const variantNum = String(shopifyVariantId).split("/").pop() || shopifyVariantId;
  return klaviyoPost(shop, "/api/back-in-stock-subscriptions/", {
    data: {
      type: "back-in-stock-subscription",
      attributes: {
        profile: { data: { type: "profile", attributes: { email } } },
        channels,
      },
      relationships: {
        variant: {
          data: {
            type: "catalog-variant",
            id: `$shopify:::$default:::${variantNum}`,
          },
        },
      },
    },
  });
}

// ---------- Contacts (2026-09-28): profile + list, for back-in-stock sign-ups ----------

async function klaviyoJson(
  shop: string,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const auth = await authHeader(shop);
  if (!auth) return { ok: false, status: 0, json: null };
  try {
    const res = await fetch(path.startsWith("http") ? path : `https://a.klaviyo.com${path}`, {
      method,
      headers: {
        Authorization: auth,
        accept: "application/json",
        revision: REVISION,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) console.error(`[klaviyo] ${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    console.error(`[klaviyo] ${method} ${path} failed`, e);
    return { ok: false, status: 0, json: null };
  }
}

/** Create or update a profile (email and/or E.164 phone); returns its id. */
export async function klaviyoUpsertProfile(
  shop: string,
  p: { email?: string | null; phone?: string | null; properties?: Record<string, unknown> },
): Promise<{ ok: boolean; status: number; id?: string }> {
  if (!p.email && !p.phone) return { ok: false, status: 0 };
  const r = await klaviyoJson(shop, "POST", "/api/profile-import/", {
    data: {
      type: "profile",
      attributes: {
        ...(p.email ? { email: p.email } : {}),
        ...(p.phone ? { phone_number: p.phone } : {}),
        ...(p.properties ? { properties: p.properties } : {}),
      },
    },
  });
  const id = (r.json as { data?: { id?: string } } | null)?.data?.id;
  return { ok: r.ok && !!id, status: r.status, id };
}

/** Add a profile to a list (list membership only — not marketing consent). */
export async function klaviyoAddToList(
  shop: string,
  listId: string,
  profileId: string,
): Promise<{ ok: boolean; status: number }> {
  const r = await klaviyoJson(shop, "POST", `/api/lists/${encodeURIComponent(listId)}/relationships/profiles/`, {
    data: [{ type: "profile", id: profileId }],
  });
  return { ok: r.ok, status: r.status };
}

/** The account's lists for the settings picker (first 3 pages — it runs in a page loader). */
export async function klaviyoLists(shop: string): Promise<{ id: string; name: string }[] | null> {
  const out: { id: string; name: string }[] = [];
  let path: string | null = "/api/lists/?fields[list]=name";
  for (let page = 0; path && page < 3; page++) {
    const r = await klaviyoJson(shop, "GET", path);
    if (!r.ok) return page === 0 ? null : out;
    const j = r.json as { data?: { id: string; attributes?: { name?: string } }[]; links?: { next?: string | null } };
    for (const l of j?.data ?? []) out.push({ id: l.id, name: l.attributes?.name ?? l.id });
    path = j?.links?.next ?? null;
  }
  return out;
}
