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

const REVISION = "2024-10-15";

/** OAuth bearer (preferred) → pasted private key → null. */
async function authHeader(shop: string): Promise<string | null> {
  const token = await getAccessToken(shop);
  if (token) return `Bearer ${token}`;
  const s = await getSettings(shop);
  const key = typeof s.general.klaviyoKey === "string" ? s.general.klaviyoKey : "";
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
