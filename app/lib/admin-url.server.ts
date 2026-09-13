/**
 * Top-level (non-embedded) entry points — OAuth callbacks from third parties
 * (Klaviyo), billing returns — must land the merchant back INSIDE the Shopify
 * admin, never on a bare app URL (which has no shop/host params and would show
 * the login form). Build the embedded URL the same way Shopify does:
 *   https://admin.shopify.com/store/<store-handle>/apps/<app-handle>/<path>
 */
const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "encore-12";

export function storeHandle(shop: string): string {
  return shop.replace(/\.myshopify\.com$/i, "");
}

export function adminAppUrl(shop: string, path = "/app"): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://admin.shopify.com/store/${storeHandle(shop)}/apps/${APP_HANDLE}${p}`;
}
