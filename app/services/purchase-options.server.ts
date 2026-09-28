/**
 * Product-page Purchase options extension backend (App Store requirement 5.4:
 * "create and manage selling plans from the product page").
 *
 * The extension never touches Shopify selling plans itself. Every action edits
 * the Encore Campaign row through the same model functions the app uses, then
 * runs the same follow-up syncs as the app routes:
 *   - syncCampaignSellingPlan  (selling plan group + checkout caps)
 *   - syncContinueSellingSafe  (inventory policy "continue selling")
 *   - releaseVariants          (variants that left a campaign → DENY)
 *   - notifyShipDateChanged    (ship date edits)
 * so caps, continue-selling and selling plans stay consistent however the
 * merchant edits a preorder. Every query is scoped by shop.
 */
import prisma from "../db.server";
import {
  createCampaign,
  setCampaignStatus,
  updateCampaign,
  type VariantConfig,
} from "../models/campaign.server";
import { getSettings } from "../models/settings.server";
import {
  syncCampaignSellingPlan,
  type AdminGraphqlClient,
  type SellingPlanSyncResult,
} from "../models/selling-plan.server";
import { releaseVariants, syncContinueSellingSafe } from "./inventory-policy.server";
import { notifyShipDateChanged } from "./notify-events.server";
import { campaignDefaultsFromSettings } from "../components/CampaignForm";
import {
  addTargetToScope,
  formDefaultsToCampaignFields,
  gidNum,
  initialStatus,
  parseDay,
  pickCurrentCampaign,
  productsNeededForScopeEdit,
  removeTargetFromScope,
  ScopeError,
  scopeContains,
  summarizeCampaign,
  triggerFor,
  type Catalog,
  type CampaignScope,
  type CampaignSummary,
  type PoAction,
  type PoRawTarget,
  type PoTarget,
} from "../lib/purchase-options-shared";

export class PoError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}

// ---------- Admin API ----------

const CATALOG = `#graphql
  query EncorePoCatalog($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product { id title variants(first: 250) { nodes { id title } } }
      ... on ProductVariant { id title product { id title } }
    }
  }`;

type CatalogNode =
  | { id: string; title: string; variants?: { nodes: { id: string; title: string }[] }; product?: undefined }
  | { id: string; title: string; product?: { id: string; title: string }; variants?: undefined }
  | null;

async function fetchNodes(admin: AdminGraphqlClient, ids: string[]): Promise<CatalogNode[]> {
  if (!ids.length) return [];
  const res = await admin.graphql(CATALOG, { variables: { ids } });
  const body = (await res.json()) as { data?: { nodes?: CatalogNode[] }; errors?: unknown };
  // A GraphQL error (e.g. query cost) must not look like "product not found".
  if (body.errors) throw new PoError("shopify_error", 502);
  return body.data?.nodes ?? [];
}

// One product at a time, every variant (Shopify allows up to 2,048 per product):
// a single nodes() query for several products went over the 1,000 query-cost
// limit from 4 products on, and variants past 250 were silently dropped.
const PRODUCT_VARIANTS = `#graphql
  query EncorePoProductVariants($id: ID!, $after: String) {
    product(id: $id) {
      id
      title
      variants(first: 250, after: $after) { nodes { id title } pageInfo { hasNextPage endCursor } }
    }
  }`;
const MAX_VARIANT_PAGES = 10; // 2,500 variants

async function loadCatalog(admin: AdminGraphqlClient, productIds: string[]): Promise<Catalog> {
  const catalog: Catalog = new Map();
  const gids = productIds.map((p) => (p.startsWith("gid://") ? p : `gid://shopify/Product/${gidNum(p)}`));
  for (const id of gids) {
    let after: string | null = null;
    let title = "";
    const variants: { id: string; title: string }[] = [];
    for (let page = 0; page < MAX_VARIANT_PAGES; page++) {
      const res = await admin.graphql(PRODUCT_VARIANTS, { variables: { id, after } });
      const body = (await res.json()) as {
        data?: {
          product?: {
            id: string;
            title: string;
            variants: { nodes: { id: string; title: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
          } | null;
        };
        errors?: unknown;
      };
      if (body.errors) throw new PoError("shopify_error", 502);
      const p = body.data?.product;
      if (!p) break; // deleted product — left out of the catalog
      title = p.title;
      variants.push(...p.variants.nodes);
      if (!p.variants.pageInfo.hasNextPage) break;
      after = p.variants.pageInfo.endCursor;
    }
    if (title || variants.length) catalog.set(gidNum(id), { id, title, variants });
  }
  return catalog;
}

export type ResolvedTarget = PoTarget & { productTitle: string; variantTitle: string | null };

/** Resolve the extension's GID(s) against the Admin API (variant → product). */
export async function resolveTarget(admin: AdminGraphqlClient, raw: PoRawTarget): Promise<ResolvedTarget> {
  const ids = [raw.productId, raw.variantId].filter((v): v is string => !!v);
  const nodes = await fetchNodes(admin, ids);
  let product: { id: string; title: string } | null = null;
  let variant: { id: string; title: string; productId: string } | null = null;
  for (const n of nodes) {
    if (!n?.id) continue;
    if (n.product) variant = { id: n.id, title: n.title, productId: n.product.id };
    if (n.product && !product) product = n.product;
    if (n.variants) product = { id: n.id, title: n.title };
  }
  if (!product) throw new PoError("target_not_found", 404);
  if (raw.variantId) {
    if (!variant || gidNum(variant.productId) !== gidNum(product.id)) {
      throw new PoError("target_not_found", 404);
    }
  }
  return {
    productId: product.id,
    variantId: variant?.id ?? null,
    productTitle: product.title,
    variantTitle: variant?.title ?? null,
  };
}

// ---------- DB ----------

const SELECT = {
  id: true,
  name: true,
  status: true,
  productMode: true,
  productIds: true,
  variantConfigs: true,
  paymentMode: true,
  depositKind: true,
  depositAmount: true,
  shipDate: true,
  sellingPlanId: true,
  updatedAt: true,
} as const;

type Row = {
  id: string;
  name: string;
  status: string;
  productMode: string;
  productIds: string;
  variantConfigs: string;
  paymentMode: string;
  depositKind: string;
  depositAmount: number;
  shipDate: Date | null;
  sellingPlanId: string | null;
};

function scopeOf(r: { productIds: string; variantConfigs: string }): CampaignScope {
  const arr = <T>(s: string): T[] => {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? (v as T[]) : [];
    } catch {
      return [];
    }
  };
  return {
    productIds: arr<unknown>(r.productIds).map(String),
    variantConfigs: arr<CampaignScope["variantConfigs"][number]>(r.variantConfigs).filter((v) => v && v.variantId),
  };
}

async function getRow(shop: string, id: string): Promise<Row> {
  const row = await prisma.campaign.findFirst({ where: { shop, id }, select: SELECT });
  if (!row) throw new PoError("campaign_not_found", 404);
  return row;
}

// ---------- GET ----------

export type PurchaseOptionsView = {
  target: ResolvedTarget;
  current: CampaignSummary | null;
  matchedBy: "sellingPlan" | "product" | null;
  /** Preorders this product/variant can be added to (not already in it). */
  campaigns: CampaignSummary[];
  defaults: { name: string; paymentMode: CampaignSummary["paymentMode"]; depositPct: number };
};

export async function loadPurchaseOptions(
  admin: AdminGraphqlClient,
  shop: string,
  raw: PoRawTarget,
  sellingPlanId: string | null,
): Promise<PurchaseOptionsView> {
  const target = await resolveTarget(admin, raw);
  const rows = await prisma.campaign.findMany({
    where: { shop, status: { not: "ENDED" } },
    select: SELECT,
    orderBy: { updatedAt: "desc" },
    take: 250,
  });

  let current: Row | null = null;
  let matchedBy: PurchaseOptionsView["matchedBy"] = null;
  if (sellingPlanId) {
    const n = gidNum(sellingPlanId);
    current = rows.find((r) => r.sellingPlanId && gidNum(r.sellingPlanId) === n) ?? null;
    if (current) matchedBy = "sellingPlan";
  }
  if (!current) {
    current = pickCurrentCampaign(
      rows.map((r) => ({ ...r, scope: scopeOf(r) })),
      target,
    );
    if (current) matchedBy = "product";
  }

  const campaigns = rows
    .filter(
      (r) =>
        r.productMode === "SPECIFIC" &&
        (r.status === "LIVE" || r.status === "SCHEDULED" || r.status === "DRAFT") &&
        !scopeContains(scopeOf(r), target),
    )
    .map(summarizeCampaign);

  const { general } = await getSettings(shop);
  const d = formDefaultsToCampaignFields(campaignDefaultsFromSettings(general as Record<string, unknown>));
  return {
    target,
    current: current ? summarizeCampaign(current) : null,
    matchedBy,
    campaigns,
    defaults: {
      name: `${target.productTitle} preorder`.slice(0, 120),
      paymentMode: d.paymentMode,
      depositPct: d.depositPct,
    },
  };
}

// ---------- POST ----------

export type PurchaseOptionsResult = {
  campaign: CampaignSummary;
  /** Set when the Shopify selling plan could not be synced (campaign was saved). */
  warning?: "selling_plan_failed";
  /** The campaign no longer covers any product (detach of the last one). */
  emptied?: boolean;
};

async function syncAfterWrite(
  admin: AdminGraphqlClient,
  shop: string,
  id: string,
  removedVariantGids: string[] = [],
): Promise<PurchaseOptionsResult["warning"]> {
  let sync: SellingPlanSyncResult | null = null;
  try {
    sync = await syncCampaignSellingPlan(admin, shop, id, { removedVariantGids });
  } catch (e) {
    console.error("[purchase-options] selling-plan sync failed", e);
  }
  await syncContinueSellingSafe(admin, shop, [id]);
  if (removedVariantGids.length) await releaseVariants(admin, shop, removedVariantGids);
  return !sync || sync.status === "error" ? "selling_plan_failed" : undefined;
}

async function editScope(
  admin: AdminGraphqlClient,
  row: Row,
  target: PoTarget,
  edit: (scope: CampaignScope, catalog: Catalog) => { scope: CampaignScope; removed: string[] },
) {
  const scope = scopeOf(row);
  const catalog = await loadCatalog(admin, productsNeededForScopeEdit(scope, target));
  try {
    return edit(scope, catalog);
  } catch (e) {
    if (e instanceof ScopeError) throw new PoError(e.code === "variant_not_found" ? "target_not_found" : "catalog_missing", 409);
    throw e;
  }
}

export async function runPurchaseOptionAction(
  admin: AdminGraphqlClient,
  shop: string,
  a: PoAction,
  now: Date = new Date(),
): Promise<PurchaseOptionsResult> {
  switch (a.action) {
    case "create": {
      const target = await resolveTarget(admin, a.target);
      const { general } = await getSettings(shop);
      const d = formDefaultsToCampaignFields(campaignDefaultsFromSettings(general as Record<string, unknown>));
      const catalog = await loadCatalog(admin, [target.productId]);
      let scope: CampaignScope;
      try {
        scope = addTargetToScope({ productIds: [], variantConfigs: [] }, target, catalog);
      } catch {
        throw new PoError("target_not_found", 404);
      }
      const startDate = a.when === "date" && a.startDate ? parseDay(a.startDate) : null;
      const shipDate = a.shipDate ? parseDay(a.shipDate) : null;
      const created = await createCampaign(shop, {
        name: a.name,
        status: initialStatus(a.when, a.startDate, now),
        locale: a.locale,
        productMode: "SPECIFIC",
        productIds: scope.productIds,
        variantConfigs: scope.variantConfigs as VariantConfig[],
        triggerType: triggerFor(a.when),
        stockThreshold: 0,
        ...(startDate ? { startDate } : {}),
        ...(shipDate ? { shipDate } : {}),
        paymentMode: a.payment,
        depositKind: "PERCENT",
        depositAmount: a.payment === "DEPOSIT" && a.depositPct != null ? a.depositPct : d.depositPct,
        balanceCaptureDays: d.balanceCaptureDays,
        deliveryNote: d.deliveryNote,
        ctaLabel: d.ctaLabel,
        ctaPlacement: d.ctaPlacement,
        cartMode: d.cartMode,
        mixedCartWarning: d.mixedCartWarning,
        orderTags: d.orderTags,
      });
      const warning = await syncAfterWrite(admin, shop, created.id);
      return { campaign: summarizeCampaign(await getRow(shop, created.id)), warning };
    }

    case "attach": {
      const row = await getRow(shop, a.campaignId);
      if (row.productMode !== "SPECIFIC" || !["LIVE", "SCHEDULED", "DRAFT", "PAUSED"].includes(row.status)) {
        throw new PoError("campaign_not_editable", 409);
      }
      const target = await resolveTarget(admin, a.target);
      const { scope } = await editScope(admin, row, target, (s, c) => ({
        scope: addTargetToScope(s, target, c),
        removed: [],
      }));
      await updateCampaign(shop, row.id, {
        productIds: scope.productIds,
        variantConfigs: scope.variantConfigs as VariantConfig[],
      });
      const warning = await syncAfterWrite(admin, shop, row.id);
      return { campaign: summarizeCampaign(await getRow(shop, row.id)), warning };
    }

    case "detach": {
      const row = await getRow(shop, a.campaignId);
      if (row.productMode !== "SPECIFIC") throw new PoError("campaign_not_editable", 409);
      const target = await resolveTarget(admin, a.target);
      const { scope, removed } = await editScope(admin, row, target, (s, c) => {
        const r = removeTargetFromScope(s, target, c);
        return { scope: r.scope, removed: r.removedVariantIds };
      });
      await updateCampaign(shop, row.id, {
        productIds: scope.productIds,
        variantConfigs: scope.variantConfigs as VariantConfig[],
      });
      const warning = await syncAfterWrite(admin, shop, row.id, removed);
      return {
        campaign: summarizeCampaign(await getRow(shop, row.id)),
        warning,
        emptied: scope.productIds.length === 0,
      };
    }

    case "update": {
      const row = await getRow(shop, a.campaignId);
      if (row.status === "ENDED") throw new PoError("campaign_not_editable", 409);
      const newShip = a.shipDate === undefined ? undefined : a.shipDate ? parseDay(a.shipDate) : null;
      await updateCampaign(shop, row.id, {
        ...(a.payment
          ? {
              paymentMode: a.payment,
              ...(a.payment === "DEPOSIT" && a.depositPct != null
                ? { depositKind: "PERCENT" as const, depositAmount: a.depositPct }
                : {}),
            }
          : {}),
        ...(newShip !== undefined ? { shipDate: newShip } : {}),
      });
      // Same customer notification as the app's edit page.
      try {
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        if (newShip && row.shipDate && fmt(newShip) !== fmt(row.shipDate)) {
          await notifyShipDateChanged(shop, row.id, row.name, fmt(row.shipDate), fmt(newShip));
        }
      } catch (e) {
        console.error("[purchase-options] ship-date notify failed", e);
      }
      const warning = await syncAfterWrite(admin, shop, row.id);
      return { campaign: summarizeCampaign(await getRow(shop, row.id)), warning };
    }

    case "pause":
    case "resume": {
      const row = await getRow(shop, a.campaignId);
      const allowed = a.action === "pause" ? ["LIVE", "SCHEDULED"] : ["PAUSED"];
      if (!allowed.includes(row.status)) throw new PoError("invalid_status", 409);
      // Mirrors app.campaigns.actions.tsx: status → continue-selling → selling plan.
      await setCampaignStatus(shop, row.id, a.action === "pause" ? "PAUSED" : "LIVE");
      await syncContinueSellingSafe(admin, shop, [row.id]);
      let warning: PurchaseOptionsResult["warning"];
      try {
        const r = await syncCampaignSellingPlan(admin, shop, row.id);
        if (r.status === "error") warning = "selling_plan_failed";
      } catch (e) {
        console.error("[purchase-options] selling-plan sync failed (status)", e);
        warning = "selling_plan_failed";
      }
      return { campaign: summarizeCampaign(await getRow(shop, row.id)), warning };
    }
  }
}
