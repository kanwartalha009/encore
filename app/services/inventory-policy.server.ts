/**
 * Continue-selling sync (R1.5 hotfix 2026-09-07).
 *
 * A sold-out variant can only be added to the cart when its inventory policy
 * is CONTINUE ("Continue selling when out of stock"). Every preorder app
 * flips that policy for the variants on a live campaign — Encore's Settings
 * toggle "Automatically manage continue selling" promised this but nothing
 * implemented it, so the storefront Preorder button submitted an add-to-cart
 * that Shopify rejected as sold out.
 *
 *   LIVE campaign            → CONTINUE on every targeted variant
 *   PAUSED / ENDED / DRAFT   → DENY (restores the no-oversell default)
 *
 * Only runs when general.autoManageContinueSelling is on (default true).
 * Best-effort: logs and never throws — a Shopify hiccup must not block a save.
 * SPECIFIC + COLLECTION/ALL: only explicit variants/products are touched;
 * catalog-wide modes are skipped (flipping a whole catalog is never safe).
 */
import prisma from "../db.server";
import { getSettings } from "../models/settings.server";
import { getCampaignCapacity } from "../models/capacity.server";
import type { AdminGraphqlClient } from "../models/selling-plan.server";

const toGid = (id: string, kind: "Product" | "ProductVariant") =>
  id.startsWith("gid://") ? id : `gid://shopify/${kind}/${id}`;

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  try {
    const v = JSON.parse(raw ?? "");
    return (v as T) ?? fallback;
  } catch {
    return fallback;
  }
}

type Row = {
  id: string;
  status: string;
  productMode: string;
  productIds: string;
  variantConfigs: string;
  maxPerCampaign: number | null;
};

export type PolicySyncResult =
  | { status: "skipped"; reason: string }
  | {
      status: "synced";
      policy: "CONTINUE" | "DENY" | "MIXED";
      products: number;
      variants: number;
      /** Variants forced back to DENY because their preorder cap is exhausted. */
      cappedVariants: number;
      errors: string[];
    };

export async function syncContinueSelling(
  admin: AdminGraphqlClient,
  shop: string,
  campaignId: string,
): Promise<PolicySyncResult> {
  const { general } = await getSettings(shop);
  const auto = (general as { autoManageContinueSelling?: boolean }).autoManageContinueSelling;
  if (auto === false) return { status: "skipped", reason: "autoManageContinueSelling off" };

  const row = (await prisma.campaign.findFirst({
    where: { shop, id: campaignId },
    select: {
      id: true,
      status: true,
      productMode: true,
      productIds: true,
      variantConfigs: true,
      maxPerCampaign: true,
    },
  })) as Row | null;
  if (!row) return { status: "skipped", reason: "campaign not found" };
  if (row.productMode !== "SPECIFIC") return { status: "skipped", reason: `productMode ${row.productMode}` };

  const livePolicy: "CONTINUE" | "DENY" = row.status === "LIVE" ? "CONTINUE" : "DENY";
  const productIds = parseJson<string[]>(row.productIds, []).map((p) => toGid(String(p), "Product"));
  const explicitVariants = parseJson<{ variantId?: string }[]>(row.variantConfigs, [])
    .map((v) => v.variantId)
    .filter((v): v is string => !!v)
    .map((v) => toGid(v, "ProductVariant"));
  if (!productIds.length) return { status: "skipped", reason: "no products" };

  // Resolve variants per product (all variants of the product, or only the
  // explicitly configured ones when the campaign is per-variant).
  const res = await admin.graphql(
    `#graphql
    query EncoreVariantsForPolicy($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product { id variants(first: 100) { nodes { id inventoryPolicy } } }
      }
    }`,
    { variables: { ids: productIds } },
  );
  const body = (await res.json()) as {
    data?: { nodes?: ({ id: string; variants?: { nodes: { id: string; inventoryPolicy: string }[] } } | null)[] };
  };
  const errors: string[] = [];
  let products = 0;
  let variants = 0;
  let cappedVariants = 0;
  for (const node of body.data?.nodes ?? []) {
    if (!node?.id) continue;
    const all = node.variants?.nodes ?? [];
    const scoped = explicitVariants.length ? all.filter((v) => explicitVariants.includes(v.id)) : all;

    // Per-variant policy: a LIVE campaign sells "past zero" only while the
    // app-side cap (unitsOffered / maxPerCampaign) has units left. Once a
    // variant's cap is exhausted it goes back to DENY, so the theme shows
    // Sold out natively and Shopify rejects any further add-to-cart — the
    // storefront never oversells the merchant's preorder allocation.
    const targets: { id: string; inventoryPolicy: "CONTINUE" | "DENY" }[] = [];
    for (const v of scoped) {
      let want: "CONTINUE" | "DENY" = livePolicy;
      if (want === "CONTINUE") {
        const cap = await getCampaignCapacity(shop, row, v.id);
        if (cap.soldOut) {
          want = "DENY";
          cappedVariants += 1;
        }
      }
      if (v.inventoryPolicy !== want) targets.push({ id: v.id, inventoryPolicy: want });
    }
    if (!targets.length) continue;
    const upd = await admin.graphql(
      `#graphql
      mutation EncoreSetInventoryPolicy($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          userErrors { field message }
        }
      }`,
      { variables: { productId: node.id, variants: targets } },
    );
    const ub = (await upd.json()) as {
      data?: { productVariantsBulkUpdate?: { userErrors?: { message: string }[] } };
      errors?: { message: string }[];
    };
    const errs = [
      ...(ub.data?.productVariantsBulkUpdate?.userErrors ?? []).map((e) => e.message),
      ...(ub.errors ?? []).map((e) => e.message),
    ];
    if (errs.length) errors.push(`${node.id}: ${errs.join("; ")}`);
    else {
      products += 1;
      variants += targets.length;
    }
  }
  const policy: "CONTINUE" | "DENY" | "MIXED" =
    livePolicy === "DENY" ? "DENY" : cappedVariants > 0 ? "MIXED" : "CONTINUE";
  if (errors.length) console.error(`[inventory-policy] ${shop} ${campaignId} → ${policy}:`, errors);
  else if (variants)
    console.log(
      `[inventory-policy] ${shop} ${campaignId} → ${policy} on ${variants} variant(s) / ${products} product(s)` +
        (cappedVariants ? ` (${cappedVariants} at cap → DENY)` : ""),
    );
  return { status: "synced", policy, products, variants, cappedVariants, errors };
}

/** Best-effort wrapper for route handlers: never throws. */
export async function syncContinueSellingSafe(
  admin: AdminGraphqlClient,
  shop: string,
  campaignIds: string[],
): Promise<void> {
  for (const id of campaignIds) {
    try {
      await syncContinueSelling(admin, shop, id);
    } catch (e) {
      console.error("[inventory-policy] sync failed", id, e);
    }
  }
}

/**
 * Reconcile every LIVE campaign's variants (scheduler, hourly + boot):
 * CONTINUE while the variant's preorder cap has units left, DENY once it is
 * exhausted. Self-heals shops that went live before this service existed, and any
 * merchant who flipped a variant back to DENY by hand while a campaign is
 * still selling. Only LIVE → CONTINUE is reconciled here; DENY is applied on
 * explicit status transitions (pause/end) so we never fight a merchant's
 * deliberate policy on campaigns that are not selling.
 */
export async function reconcileLiveCampaignPolicies(
  getAdmin: (shop: string) => Promise<AdminGraphqlClient>,
): Promise<{ shops: number; campaigns: number; variants: number }> {
  const live = (await prisma.campaign.findMany({
    where: { status: "LIVE", productMode: "SPECIFIC" },
    select: { id: true, shop: true },
  })) as { id: string; shop: string }[];
  const byShop = new Map<string, string[]>();
  for (const c of live) byShop.set(c.shop, [...(byShop.get(c.shop) ?? []), c.id]);
  let variants = 0;
  for (const [shop, ids] of byShop) {
    let admin: AdminGraphqlClient;
    try {
      admin = await getAdmin(shop);
    } catch (e) {
      console.error("[inventory-policy/reconcile] no admin session for", shop, e);
      continue;
    }
    for (const id of ids) {
      try {
        const r = await syncContinueSelling(admin, shop, id);
        if (r.status === "synced") variants += r.variants;
      } catch (e) {
        console.error("[inventory-policy/reconcile]", shop, id, e);
      }
    }
  }
  return { shops: byShop.size, campaigns: live.length, variants };
}
