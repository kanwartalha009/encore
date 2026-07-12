/**
 * Shop-level facts we need for display (currency today).
 *
 * The shop's currency is NOT stored locally (there is no Shop model), so we read it
 * from the Admin API and memoize it per shop for the process lifetime — it changes
 * roughly never, and every money-rendering loader would otherwise re-query it.
 * Falls back to "USD" so a transient API failure degrades to the old behaviour
 * rather than throwing on a dashboard render.
 */
import type { AdminGraphqlClient } from "./markets.server";

const SHOP_CURRENCY_QUERY = `#graphql
  query EncoreShopCurrency {
    shop { currencyCode }
  }`;

const cache = new Map<string, string>();

export async function getShopCurrency(
  admin: AdminGraphqlClient | null | undefined,
  shop: string,
): Promise<string> {
  const hit = cache.get(shop);
  if (hit) return hit;
  if (!admin) return "USD";
  try {
    const res = await admin.graphql(SHOP_CURRENCY_QUERY);
    const body = (await res.json()) as {
      data?: { shop?: { currencyCode?: string } };
    };
    const code = body.data?.shop?.currencyCode;
    if (code) {
      cache.set(shop, code);
      return code;
    }
  } catch (err) {
    console.error("[encore] shop currency lookup failed", err);
  }
  return "USD";
}
