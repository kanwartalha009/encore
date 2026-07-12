/**
 * Storefront config resolver.
 *
 * Single source of truth for what the theme app extension renders: it merges
 * the merchant's store-wide settings (AppSettings.general/lowStock/backInStock),
 * the matching live preorder Campaign, and per-locale Translation overrides into
 * one JSON payload served over the /apps/encore/config app proxy.
 */

import prisma from "../db.server";
import { getSettings, getTranslations } from "./settings.server";
import { getCampaignCapacity } from "./capacity.server";
import { getMarketRule, type AdminGraphqlClient } from "./markets.server";
import { isOverPreorderLimit } from "../services/usage.server";

// COLLECTION-mode preorders match a product by its membership in the campaign's
// collection. `Collection.hasProduct` is a cheap boolean check; results are memoized
// per request so multiple candidate campaigns on the same collection cost one call.
const COLLECTION_HAS_PRODUCT = `#graphql
  query EncoreHasProduct($id: ID!, $pid: ID!) {
    collection(id: $id) { hasProduct(id: $pid) }
  }`;

async function productInCollection(
  admin: AdminGraphqlClient,
  collectionId: string,
  productIdOrGid: string,
  cache: Map<string, boolean>,
): Promise<boolean> {
  const productGid = productIdOrGid.startsWith("gid://")
    ? productIdOrGid
    : `gid://shopify/Product/${productIdOrGid.split("/").pop() ?? productIdOrGid}`;
  const key = `${collectionId}::${productGid}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  try {
    const res = await admin.graphql(COLLECTION_HAS_PRODUCT, {
      variables: { id: collectionId, pid: productGid },
    });
    const body = (await res.json()) as {
      data?: { collection?: { hasProduct?: boolean } };
    };
    const has = body.data?.collection?.hasProduct === true;
    cache.set(key, has);
    return has;
  } catch (err) {
    console.error("[encore] collection membership check failed", err);
    cache.set(key, false);
    return false;
  }
}

type G = Record<string, unknown>;

const s = (o: G, k: string, d = ""): string =>
  typeof o[k] === "string" ? (o[k] as string) : d;
const b = (o: G, k: string, d = false): boolean =>
  typeof o[k] === "boolean" ? (o[k] as boolean) : d;
const num = (o: G, k: string, d = 0): number => {
  const v = o[k];
  const p = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(p) ? p : d;
};

const gidNum = (gid?: string | null): string =>
  gid ? String(gid).split("/").pop() || "" : "";

function jsonArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function fmtDate(d: Date, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale || "en", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export type StorefrontConfig = {
  shop: string;
  locale: string;
  preorder:
    | null
    | {
        active: boolean;
        soldOut: boolean;
        remaining: number | null;
        label: string;
        badge: string;
        showBadge: boolean;
        badgeStyle: string;
        placement: string;
        message: string;
        fallback: string;
        shipDate: string | null;
        shipText: string;
        hideBuyNow: boolean;
        buttonColor: string;
        customCss: string;
        lineItem: { enabled: boolean; preorderLabel: string; shipLabel: string };
        mixedCartMessage: string;
        campaignId: string;
        sellingPlanId: string | null;
        /** This market is flagged no-local-stock → offer preorder even if in stock. */
        forcePreorder: boolean;
      };
  lowStock: {
    enabled: boolean;
    threshold: number;
    preset: string;
    text: string;
    barColor: string;
    bgColor: string;
    textColor: string;
    customCss: string;
  };
  backInStock: {
    enabled: boolean;
    buttonText: string;
    title: string;
    success: string;
    consentText: string;
    hideBuyNow: boolean;
    collectPhone: boolean;
    syncTarget: string;
  };
};

export async function getStorefrontConfig(
  shop: string,
  productId: string,
  variantId: string,
  locale: string,
  marketId = "",
  admin: AdminGraphqlClient | null = null,
): Promise<StorefrontConfig> {
  const collectionMembership = new Map<string, boolean>();
  const { general, lowStock, backInStock } = await getSettings(shop);
  const g = general as G;
  const ls = lowStock as G;
  const bis = backInStock as G;

  const tAll = await getTranslations(shop);
  const tr: Record<string, string> = tAll[locale] || {};
  const tv = (k: string): string | undefined => {
    const v = tr[k];
    return v && v.trim() ? v : undefined;
  };

  // ---- preorder: first live campaign that matches this product ----
  const now = new Date();
  const campaigns = await prisma.campaign.findMany({
    where: { shop, status: "LIVE" },
    orderBy: { updatedAt: "desc" },
  });
  const pid = String(productId);
  // Per-market: the store-level MarketRule scope decides whether preorder is
  // offered to this buyer's market at all (the flagship in-stock-here /
  // preorder-there control).
  const rule = await getMarketRule(shop);
  const marketAllowed =
    rule.scope !== "SPECIFIC" ||
    !marketId ||
    rule.markets.includes(marketId) ||
    rule.markets.map(gidNum).includes(gidNum(marketId));
  let match: (typeof campaigns)[number] | null = null;
  for (const c of marketAllowed ? campaigns : []) {
    if (c.startDate && c.startDate > now) continue;
    if (c.endDate && c.endDate < now) continue;
    // Per-campaign market targeting (Campaign.markets — [] = all markets).
    const cm = jsonArr((c as unknown as { markets?: string }).markets);
    if (
      cm.length &&
      marketId &&
      !cm.includes(marketId) &&
      !cm.map(gidNum).includes(gidNum(marketId))
    )
      continue;
    if (c.productMode === "ALL") {
      match = c;
      break;
    }
    if (c.productMode === "SPECIFIC") {
      const ids = jsonArr(c.productIds).map(gidNum);
      if (pid && ids.indexOf(pid) !== -1) {
        match = c;
        break;
      }
    }
    if (c.productMode === "COLLECTION") {
      const collId = (c as unknown as { collectionId?: string | null }).collectionId;
      if (
        collId &&
        admin &&
        pid &&
        (await productInCollection(admin, collId, pid, collectionMembership))
      ) {
        match = c;
        break;
      }
    }
  }

  let preorder: StorefrontConfig["preorder"] = null;
  if (match) {
    // No-oversell: hide the offer once the campaign/variant cap is reached.
    const cap = await getCampaignCapacity(shop, match, variantId);
    const shipDate = match.shipDate ? match.shipDate.toISOString() : null;
    const shipText = match.shipDate ? fmtDate(match.shipDate, locale) : "";
    preorder = {
      active: !cap.soldOut,
      soldOut: cap.soldOut,
      remaining: cap.remaining,
      label:
        tv("preorder_button") ||
        match.ctaLabel ||
        s(g, "defaultButtonLabel", "Preorder"),
      badge: tv("preorder_badge") || "Preorder",
      showBadge: b(g, "showPreorderLabel", true),
      badgeStyle: s(g, "badgeStyle", "pill"),
      placement: (
        s(g, "ctaPlacement", "") ||
        match.ctaPlacement ||
        "stack"
      ).toLowerCase(),
      message:
        tv("preorder_note") ||
        s(g, "defaultDeliveryNote", "") ||
        match.deliveryNote ||
        "Ships by {{shipping_date}}",
      fallback: s(g, "defaultDeliveryFallback", "Ships as soon as it's available."),
      shipDate,
      shipText,
      hideBuyNow: b(g, "hideBuyNow", false),
      buttonColor: s(g, "buttonColor", "#1A1A1A"),
      customCss: s(g, "customCss", ""),
      lineItem: {
        enabled: b(g, "showLineItemProps", true),
        preorderLabel:
          tv("cart_preorder_label") || s(g, "preorderPropLabel", "Preorder"),
        shipLabel: s(g, "shipDatePropLabel", "Ships"),
      },
      mixedCartMessage: s(g, "mixedCartMessage", ""),
      campaignId: match.id,
      // Numeric Selling Plan id for the storefront add-to-cart (selling_plan
      // param). Present once the campaign has been synced via the selling-plan
      // service; null falls back to a plain add-to-cart + line-item properties.
      sellingPlanId: gidNum(
        (match as unknown as { sellingPlanId?: string | null }).sellingPlanId,
      ) || null,
      forcePreorder: Boolean(
        marketId && rule.perMarketOverrides[marketId]?.forcePreorder,
      ),
    };
  }

  // Billing: a shop over its monthly pre-order limit stops OFFERING new pre-orders
  // (existing orders + checkout are never touched — no §8 violation). Unlimited or
  // no-plan shops are never gated.
  if (preorder && preorder.active && (await isOverPreorderLimit(shop))) {
    preorder = { ...preorder, active: false, soldOut: true };
  }

  return {
    shop,
    locale,
    preorder,
    lowStock: {
      enabled: b(ls, "enabled", false),
      threshold: num(ls, "threshold", 10),
      preset: s(ls, "preset", "bar_text"),
      text: tv("lowstock_text") || s(ls, "text", "Only {n} left"),
      barColor: s(ls, "barColor", "#E8A13A"),
      bgColor: s(ls, "bgColor", "#F1F1F1"),
      textColor: s(ls, "textColor", "#6B6B6B"),
      customCss: s(ls, "customCss", ""),
    },
    backInStock: {
      enabled: b(bis, "enabled", false),
      buttonText:
        tv("notify_button") || s(bis, "buttonText", "Notify me when available"),
      title: tv("notify_title") || s(bis, "popupTitle", "Get notified"),
      success:
        tv("notify_success") ||
        "You're on the list — we'll let you know when it's back.",
      consentText: s(
        bis,
        "consentText",
        "I agree to be notified by email about this product.",
      ),
      hideBuyNow: b(bis, "hideBuyNow", false),
      collectPhone: b(bis, "collectPhone", false),
      syncTarget: s(bis, "syncTarget", ""),
    },
  };
}
