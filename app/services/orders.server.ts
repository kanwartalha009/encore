/**
 * Order processing for the Shopify orders/* webhooks.
 *
 * Detection (in order of preference):
 *   1. Line item property `_preorder_campaign_id` set by our storefront
 *      extension at add-to-cart time. Most reliable — explicit and
 *      survives partial fulfillment.
 *   2. Fall back to matching the line item's product GID against any
 *      LIVE / SCHEDULED campaign for this shop. Slower (one DB read per
 *      order) but covers the case where the storefront extension didn't
 *      attach the property (e.g. headless / direct-to-checkout flows).
 *
 * Idempotency: every PreOrder is keyed by `shopifyOrderId` + `orderRef`
 * (we use the Shopify order GID + the line item id concatenated). If a
 * webhook fires twice we no-op rather than create duplicate rows.
 *
 * Payment status mapping (initial create):
 *   campaign.paymentMode  shopify financial_status  →  PreOrder.paymentStatus
 *   PAY_NOW               paid                          BALANCE_PAID
 *   PAY_NOW               anything else                 BALANCE_PENDING
 *   DEPOSIT               authorized | partially_paid   DEPOSIT_PAID
 *   DEPOSIT               paid                          BALANCE_PAID
 *   PAY_LATER             *                             BALANCE_PENDING
 */

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getSettings } from "../models/settings.server";
import { refreshVariantRemaining } from "../models/preorder-cap.server";

// ---------- Shopify webhook payload (subset we use) ----------
export type ShopifyMoney = string; // "54.00"
export type ShopifyLineItemProperty = { name: string; value: string };

export type ShopifyLineItem = {
  id: number;
  product_id: number | null;
  variant_id: number | null;
  title: string;
  variant_title: string | null;
  quantity: number;
  price: ShopifyMoney;
  properties?: ShopifyLineItemProperty[] | null;
};

export type ShopifyOrderPayload = {
  id: number;
  admin_graphql_api_id?: string; // gid://shopify/Order/...
  name?: string; // "#4821"
  order_number?: number;
  email?: string | null;
  contact_email?: string | null;
  customer_locale?: string | null; // buyer's checkout locale, e.g. "fr" / "en-US"
  customer?: {
    id?: number;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  } | null;
  financial_status?: string | null;
  line_items: ShopifyLineItem[];
  cancelled_at?: string | null;
  refunds?: { id: number }[] | null;
};

// ---------- Helpers ----------
function findCampaignIdProperty(li: ShopifyLineItem): string | null {
  if (!li.properties) return null;
  const hit = li.properties.find(
    (p) => p.name === "_preorder_campaign_id" || p.name === "preorder_campaign_id",
  );
  return hit?.value ?? null;
}

function productGidFromLineItem(li: ShopifyLineItem): string | null {
  return li.product_id ? `gid://shopify/Product/${li.product_id}` : null;
}

function findProperty(li: ShopifyLineItem, name: string): string | null {
  if (!li.properties) return null;
  const hit = li.properties.find((p) => p.name === name);
  return hit?.value ?? null;
}

function customerNameOf(p: ShopifyOrderPayload): string | null {
  if (!p.customer) return null;
  const parts = [p.customer.first_name, p.customer.last_name].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function customerEmailOf(p: ShopifyOrderPayload): string {
  return (
    p.email ?? p.contact_email ?? p.customer?.email ?? "unknown@example.com"
  );
}

function shopifyOrderGid(p: ShopifyOrderPayload): string {
  return p.admin_graphql_api_id ?? `gid://shopify/Order/${p.id}`;
}

// One PreOrder per (order, line item) pair so partial fulfillment / refunds work.
function preorderKeyFor(orderGid: string, lineItem: ShopifyLineItem): string {
  return `${orderGid}::li_${lineItem.id}`;
}

// ---------- Status calc ----------
type Campaign = Awaited<
  ReturnType<typeof prisma.campaign.findFirst>
>;

function initialPaymentStatus(
  campaign: NonNullable<Campaign>,
  financialStatus: string | null | undefined,
): "DEPOSIT_PAID" | "BALANCE_PAID" | "BALANCE_PENDING" {
  const fs = (financialStatus ?? "").toLowerCase();
  switch (campaign.paymentMode) {
    case "PAY_NOW":
      return fs === "paid" ? "BALANCE_PAID" : "BALANCE_PENDING";
    case "DEPOSIT":
      if (fs === "paid") return "BALANCE_PAID";
      if (fs === "authorized" || fs === "partially_paid")
        return "DEPOSIT_PAID";
      return "DEPOSIT_PAID"; // most likely state at order create
    case "PAY_LATER":
    default:
      return "BALANCE_PENDING";
  }
}

function splitDepositBalance(
  totalCents: number,
  campaign: NonNullable<Campaign>,
): { depositCents: number; balanceCents: number } {
  switch (campaign.paymentMode) {
    case "PAY_NOW":
      return { depositCents: totalCents, balanceCents: 0 };
    case "PAY_LATER":
      return { depositCents: 0, balanceCents: totalCents };
    case "DEPOSIT": {
      const depCents =
        campaign.depositKind === "FIXED"
          ? Math.min(Math.round(campaign.depositAmount * 100), totalCents)
          : Math.round((totalCents * campaign.depositAmount) / 100);
      return { depositCents: depCents, balanceCents: totalCents - depCents };
    }
    default:
      return { depositCents: 0, balanceCents: totalCents };
  }
}

// ---------- Resolution ----------
async function resolveCampaignForLineItem(
  shop: string,
  li: ShopifyLineItem,
): Promise<NonNullable<Campaign> | null> {
  // 1. Explicit property — preferred.
  const explicitId = findCampaignIdProperty(li);
  if (explicitId) {
    const c = await prisma.campaign.findFirst({
      where: { shop, id: explicitId },
    });
    if (c) return c;
  }

  // 2. Fall back to product-id matching against active campaigns.
  const productGid = productGidFromLineItem(li);
  if (!productGid) return null;

  const candidates = await prisma.campaign.findMany({
    where: {
      shop,
      status: { in: ["LIVE", "SCHEDULED"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  for (const c of candidates) {
    // productMode === ALL → applies to every product
    if (c.productMode === "ALL") return c;
    // productMode === SPECIFIC → check the JSON array
    if (c.productMode === "SPECIFIC") {
      try {
        const ids = JSON.parse(c.productIds) as string[];
        if (ids.includes(productGid)) return c;
      } catch {
        // ignore malformed json
      }
    }
    // COLLECTION matching deferred — needs a Shopify Admin API call.
  }

  return null;
}

// ---------- Public: orders/create ----------
export async function processOrderCreate(
  shop: string,
  payload: ShopifyOrderPayload,
) {
  const orderGid = shopifyOrderGid(payload);
  const orderRefBase = payload.name ?? `#${payload.order_number ?? payload.id}`;
  const customerEmail = customerEmailOf(payload);
  const customerName = customerNameOf(payload);

  // Order-level metadata we write back to Shopify (tags + ship-date metafield).
  const settings = await getSettings(shop);
  const settingsTag =
    typeof settings.general.orderTagName === "string"
      ? settings.general.orderTagName.trim()
      : "";

  let createdCount = 0;
  let isPreorder = false;
  const tags = new Set<string>(["preorder"]);
  if (settingsTag) tags.add(settingsTag);
  const shipDates = new Set<string>();
  const touchedCampaignIds = new Set<string>();
  const touchedVariants = new Map<string, Set<string>>();

  for (const li of payload.line_items) {
    const campaign = await resolveCampaignForLineItem(shop, li);
    if (!campaign) continue;

    // Find the cohort this campaign points at. MVP: one cohort per campaign,
    // chosen by earliest ship date.
    const cohort = await prisma.cohort.findFirst({
      where: { shop, campaignId: campaign.id },
      orderBy: { shipDate: "asc" },
    });
    if (!cohort) continue; // can't attribute without a cohort

    // This line is a preorder. Collect the order tag(s) + ship date even when
    // the row already exists, so a re-delivered webhook re-verifies tagging.
    isPreorder = true;
    shipDates.add(cohort.shipDate.toISOString().slice(0, 10));
    try {
      for (const t of JSON.parse(campaign.orderTags) as string[]) {
        if (t && typeof t === "string") tags.add(t.trim());
      }
    } catch {
      /* ignore malformed orderTags json */
    }
    if (li.variant_id) {
      const vg = `gid://shopify/ProductVariant/${li.variant_id}`;
      let set = touchedVariants.get(campaign.id);
      if (!set) {
        set = new Set<string>();
        touchedVariants.set(campaign.id, set);
      }
      set.add(vg);
    }

    const totalCents = Math.round(Number(li.price) * li.quantity * 100);
    const { depositCents, balanceCents } = splitDepositBalance(
      totalCents,
      campaign,
    );

    const orderRef = `${orderRefBase}/L${li.id}`;

    // Idempotent: skip if we already saw this order+line.
    const existing = await prisma.preOrder.findFirst({
      where: {
        shop,
        shopifyOrderId: orderGid,
        orderRef,
      },
      select: { id: true },
    });
    if (existing) continue;

    await (
      prisma.preOrder.create as unknown as (a: {
        data: Record<string, unknown>;
      }) => Promise<unknown>
    )({
      data: {
        shop,
        campaignId: campaign.id,
        cohortId: cohort.id,
        customerEmail,
        customerName,
        shopifyOrderId: orderGid,
        orderRef,
        variantId: li.variant_id
          ? `gid://shopify/ProductVariant/${li.variant_id}`
          : null,
        market: findProperty(li, "_preorder_market") || null,
        locale: (payload.customer_locale ?? "").slice(0, 2) || null,
        units: li.quantity,
        amount: totalCents / 100,
        depositAmount: depositCents > 0 ? depositCents / 100 : null,
        balanceAmount: balanceCents > 0 ? balanceCents / 100 : null,
        paymentStatus: initialPaymentStatus(campaign, payload.financial_status),
        paidAt:
          (payload.financial_status ?? "").toLowerCase() === "paid"
            ? new Date()
            : null,
      },
    });
    createdCount += 1;
    touchedCampaignIds.add(campaign.id);
  }

  // After inserts, recompute cohort status for the touched campaigns.
  for (const id of touchedCampaignIds) {
    await refreshCohortStatus(shop, id);
  }

  return {
    createdCount,
    orderGid,
    isPreorder,
    tags: Array.from(tags).filter(Boolean),
    // Earliest first — ship_date metafield uses shipDates[0].
    shipDates: Array.from(shipDates).sort(),
    variantsByCampaign: Object.fromEntries(
      Array.from(touchedVariants.entries()).map(([k, v]) => [k, Array.from(v)]),
    ) as Record<string, string[]>,
  };
}

/**
 * Recompute the per-variant `encore.preorder_remaining` metafields for the
 * variants in an order, so the checkout-validation Function sees fresh counts.
 * Best-effort — runs after the order is recorded.
 */
export async function refreshCapsForOrder(
  shop: string,
  variantsByCampaign: Record<string, string[]>,
): Promise<void> {
  const entries = Object.entries(variantsByCampaign);
  if (!entries.length) return;
  const { admin } = await unauthenticated.admin(shop);
  for (const [campaignId, variantGids] of entries) {
    const c = await prisma.campaign.findFirst({
      where: { shop, id: campaignId },
      select: { id: true, variantConfigs: true },
    });
    if (c) await refreshVariantRemaining(admin, shop, c, variantGids);
  }
}

// ---------- Public: tag the order + write the ship-date metafield ----------
// Frozen Phase-1 contract: order tag(s) incl. `preorder`; order metafields
// `encore.is_preorder` (boolean) and `encore.ship_date` (date, earliest).

const TAGS_ADD = `#graphql
mutation EncoreTagsAdd($id: ID!, $tags: [String!]!) {
  tagsAdd(id: $id, tags: $tags) { userErrors { field message } }
}`;

const METAFIELDS_SET = `#graphql
mutation EncoreMfSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { userErrors { field message } }
}`;

const VERIFY_ORDER = `#graphql
query EncoreVerifyOrder($id: ID!) {
  order(id: $id) {
    tags
    metafield(namespace: "encore", key: "is_preorder") { value }
  }
}`;

export async function applyPreorderOrderMetadata(
  shop: string,
  orderGid: string,
  tags: string[],
  shipDates: string[],
): Promise<{ ok: boolean; warnings: string[] }> {
  const warnings: string[] = [];
  const { admin } = await unauthenticated.admin(shop);

  const cleanTags = Array.from(
    new Set(tags.map((t) => t.trim()).filter(Boolean)),
  );

  // 1. Tag the order.
  if (cleanTags.length) {
    const res = await admin.graphql(TAGS_ADD, {
      variables: { id: orderGid, tags: cleanTags },
    });
    const body = (await res.json()) as {
      data?: { tagsAdd?: { userErrors?: { message: string }[] } };
    };
    for (const e of body.data?.tagsAdd?.userErrors ?? []) warnings.push(e.message);
  }

  // 2. Order metafields: is_preorder flag + earliest ship date (+ full list).
  const metafields: Record<string, unknown>[] = [
    { ownerId: orderGid, namespace: "encore", key: "is_preorder", type: "boolean", value: "true" },
  ];
  if (shipDates.length) {
    metafields.push({
      ownerId: orderGid, namespace: "encore", key: "ship_date", type: "date", value: shipDates[0],
    });
    if (shipDates.length > 1) {
      metafields.push({
        ownerId: orderGid, namespace: "encore", key: "ship_dates", type: "list.date", value: JSON.stringify(shipDates),
      });
    }
  }
  const mfRes = await admin.graphql(METAFIELDS_SET, { variables: { metafields } });
  const mfBody = (await mfRes.json()) as {
    data?: { metafieldsSet?: { userErrors?: { message: string }[] } };
  };
  for (const e of mfBody.data?.metafieldsSet?.userErrors ?? []) warnings.push(e.message);

  // 3. Verify post-write — the order must carry the tag(s) + the preorder flag.
  const vRes = await admin.graphql(VERIFY_ORDER, { variables: { id: orderGid } });
  const vBody = (await vRes.json()) as {
    data?: { order?: { tags?: string[]; metafield?: { value?: string } | null } };
  };
  const liveTags = vBody.data?.order?.tags ?? [];
  const allTagged = cleanTags.every((t) => liveTags.includes(t));
  const flagged = vBody.data?.order?.metafield?.value === "true";

  const ok = allTagged && flagged && warnings.length === 0;
  if (!ok && warnings.length === 0) {
    warnings.push(
      `post-write verify failed (tags ${allTagged ? "ok" : "missing"}, flag ${flagged ? "ok" : "missing"})`,
    );
  }
  return { ok, warnings };
}

// ---------- Public: orders/paid ----------
export async function processOrderPaid(
  shop: string,
  payload: ShopifyOrderPayload,
) {
  const orderGid = shopifyOrderGid(payload);
  const updated = await prisma.preOrder.updateMany({
    where: { shop, shopifyOrderId: orderGid },
    data: {
      paymentStatus: "BALANCE_PAID",
      balanceAmount: 0,
      paidAt: new Date(),
    },
  });
  return { updated: updated.count };
}

// ---------- Public: orders/cancelled ----------
export async function processOrderCancelled(
  shop: string,
  payload: ShopifyOrderPayload,
) {
  const orderGid = shopifyOrderGid(payload);
  const updated = await prisma.preOrder.updateMany({
    where: { shop, shopifyOrderId: orderGid },
    data: {
      paymentStatus: "REFUNDED",
      refundedAt: new Date(),
    },
  });
  return { updated: updated.count };
}

// ---------- Cohort progress recompute ----------
async function refreshCohortStatus(shop: string, campaignId: string) {
  const cohort = await prisma.cohort.findFirst({
    where: { shop, campaignId },
    orderBy: { shipDate: "asc" },
  });
  if (!cohort) return;

  const sumUnits = await prisma.preOrder.aggregate({
    where: { shop, cohortId: cohort.id },
    _sum: { units: true },
  });
  const unitsSold = sumUnits._sum.units ?? 0;
  const target = cohort.unitsTarget;
  const daysToShip =
    (cohort.shipDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24);

  let nextStatus: string = cohort.status;
  if (cohort.status !== "SHIPPED") {
    if (daysToShip <= 7 && (target == null || unitsSold >= target)) {
      nextStatus = "READY_TO_SHIP";
    } else if (
      target != null &&
      unitsSold < target * 0.5 &&
      daysToShip < 21
    ) {
      nextStatus = "AT_RISK";
    } else {
      nextStatus = "ON_TRACK";
    }
  }

  if (nextStatus !== cohort.status) {
    await prisma.cohort.update({
      where: { id: cohort.id },
      data: { status: nextStatus },
    });
  }
}
