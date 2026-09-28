/**
 * Per-market stock (multi-location brands) — 2026-09-28.
 *
 * "Market 1 preorder, market 2 sells real stock, otherwise sold out." For a
 * shopper in market M looking at variant V (decision: lib/markets-shared.ts
 * `marketOutcome`):
 *   1. V has sellable stock at the locations that serve M → normal checkout
 *   2. else an Encore preorder is offered in M             → Preorder
 *   3. else                                                → Sold out
 *
 * This module reads Shopify inventory per location and:
 *   - `getMarketVariantStock` feeds the storefront config (hot path: in-memory
 *     cache per shop + product + location set, 60 s);
 *   - `syncMarketBlocks` keeps the variant metafield `encore.market_blocked`
 *     (JSON array of numeric market ids where case 3 applies) current, so the
 *     checkout-validation Function (extensions/encore-preorder-cap) can block
 *     the variant at checkout in those markets;
 *   - `marketStockSummary` powers the Per-market admin table.
 *
 * Only runs for shops with more than one market (MarketRule snapshot). Single-
 * market shops never reach any query here.
 *
 * Scopes: read_inventory + read_locations (inventory levels), write_products
 * (variant metafields) — all already granted.
 */
import prisma from "../db.server";
import {
  isMarketBlocked,
  isMultiMarket,
  marketInScope,
  marketNum,
  resolveServingLocations,
  sameMarket,
  stockAtLocations,
  type VariantMarketStock,
} from "../lib/markets-shared";
import { variantWindowOpen } from "../lib/cap-shared";
import { getCampaignCapacity } from "./capacity.server";
import {
  fetchLocations,
  getMarketRule,
  reconcileMarkets,
  type AdminGraphqlClient,
  type MarketRuleData,
} from "./markets.server";

const num = (g?: string | null): string => (g ? String(g).split("/").pop() || "" : "");
const variantGid = (v: string) => (v.startsWith("gid://") ? v : `gid://shopify/ProductVariant/${num(v)}`);
const productGid = (p: string) => (p.startsWith("gid://") ? p : `gid://shopify/Product/${num(p)}`);

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

// ---------- inventory read ----------

/** At most this many serving locations are read per query (aliased fields). */
export const MAX_LOCATIONS = 8;
/** Query-cost budget per request (Shopify max is 1000). */
const COST_BUDGET = 900;

/** Variants per page so the requested cost stays under budget. */
export function variantPageSize(locationCount: number): number {
  const k = Math.max(1, Math.min(MAX_LOCATIONS, locationCount));
  return Math.max(10, Math.min(100, Math.floor(COST_BUDGET / (3 + 2 * k))));
}

/**
 * Build the per-location inventory query. One aliased
 * `inventoryLevel(locationId:)` per serving location keeps the cost linear in
 * the number of serving locations instead of every location the shop has.
 */
export function buildStockQuery(
  mode: "product" | "variants",
  locationCount: number,
): string {
  const k = Math.max(0, Math.min(MAX_LOCATIONS, locationCount));
  const vars = Array.from({ length: k }, (_, i) => `$l${i}: ID!`).join(", ");
  const levels = Array.from(
    { length: k },
    (_, i) => `l${i}: inventoryLevel(locationId: $l${i}) { quantities(names: ["available"]) { name quantity } }`,
  ).join("\n          ");
  const variantFields = `id
        product { id }
        blocked: metafield(namespace: "encore", key: "market_blocked") { value }
        inventoryItem {
          tracked
          ${levels}
        }`;
  if (mode === "product") {
    return `#graphql
query EncoreMarketStock($id: ID!, $first: Int!${vars ? ", " + vars : ""}) {
  product(id: $id) {
    variants(first: $first) {
      nodes {
        ${variantFields}
      }
    }
  }
}`;
  }
  return `#graphql
query EncoreMarketStockVariants($ids: [ID!]!${vars ? ", " + vars : ""}) {
  nodes(ids: $ids) {
    ... on ProductVariant {
      ${variantFields}
    }
  }
}`;
}

type LevelNode = { quantities?: { name: string; quantity: number }[] } | null;
type VariantNode = {
  id?: string;
  product?: { id: string } | null;
  blocked?: { value: string | null } | null;
  inventoryItem?: ({ tracked?: boolean } & Record<string, LevelNode | boolean | undefined>) | null;
};

export type VariantLevels = {
  id: string; // numeric
  productId: string; // numeric
  tracked: boolean;
  /** location GID → available */
  available: Record<string, number>;
  /** Current `encore.market_blocked` value. */
  blocked: MarketBlockedValue | null;
};

/**
 * `encore.market_blocked` metafield value: numeric market ids where the
 * variant is sold out, valid through `until` (YYYY-MM-DD). The Function
 * ignores an expired value, so a block the app forgot to clear (e.g. a
 * campaign deleted while Shopify was unreachable) lapses by itself; the
 * hourly reconcile keeps live ones fresh.
 */
export type MarketBlockedValue = { m: string[]; until: string };

/** Days a written block stays valid without a refresh. */
export const BLOCK_TTL_DAYS = 2;

export function blockUntil(now: Date = new Date()): string {
  return new Date(now.getTime() + BLOCK_TTL_DAYS * 86_400_000).toISOString().slice(0, 10);
}

export function parseBlockedValue(raw: string | null | undefined): MarketBlockedValue | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    if (Array.isArray(v)) return { m: v.map((x) => marketNum(String(x))), until: "" };
    if (v && typeof v === "object" && Array.isArray((v as MarketBlockedValue).m)) {
      const o = v as MarketBlockedValue;
      return { m: o.m.map((x) => marketNum(String(x))), until: String(o.until ?? "") };
    }
  } catch {
    /* unreadable → treated as absent */
  }
  return null;
}

/**
 * Does the stored value need a write? Different markets, or valid for less
 * than a day more (refresh before the Function starts ignoring it).
 */
export function blockedNeedsWrite(have: MarketBlockedValue | null, want: string[], now: Date = new Date()): boolean {
  if (!want.length) return !!have;
  if (!have) return true;
  const a = have.m.slice().sort();
  const b = want.slice().sort();
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) return true;
  const tomorrow = new Date(now.getTime() + 86_400_000).toISOString().slice(0, 10);
  return !have.until || have.until <= tomorrow;
}

/** Parse a variant node from the query above. */
export function parseVariantNode(n: VariantNode, locations: string[]): VariantLevels | null {
  if (!n?.id) return null;
  const item = n.inventoryItem ?? {};
  const available: Record<string, number> = {};
  locations.slice(0, MAX_LOCATIONS).forEach((loc, i) => {
    const lvl = item[`l${i}`] as LevelNode | undefined;
    const q = lvl?.quantities?.find((x) => x.name === "available")?.quantity;
    available[loc] = typeof q === "number" ? q : 0;
  });
  const blocked = parseBlockedValue(n.blocked?.value);
  return {
    id: num(n.id),
    productId: num(n.product?.id),
    tracked: item.tracked !== false,
    available,
    blocked,
  };
}

function locationVars(locations: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  locations.slice(0, MAX_LOCATIONS).forEach((l, i) => (out[`l${i}`] = l));
  return out;
}

async function readProductLevels(
  admin: AdminGraphqlClient,
  productId: string,
  locations: string[],
): Promise<VariantLevels[] | null> {
  const locs = locations.slice(0, MAX_LOCATIONS);
  if (!locs.length) return null;
  try {
    const res = await admin.graphql(buildStockQuery("product", locs.length), {
      variables: { id: productGid(productId), first: variantPageSize(locs.length), ...locationVars(locs) },
    });
    const body = (await res.json()) as {
      data?: { product?: { variants?: { nodes?: VariantNode[] } } | null };
      errors?: unknown;
    };
    if (!body.data?.product) return null;
    return (body.data.product.variants?.nodes ?? [])
      .map((n) => parseVariantNode(n, locs))
      .filter((v): v is VariantLevels => !!v);
  } catch (err) {
    console.error("[encore] market stock read failed", err);
    return null;
  }
}

async function readVariantLevels(
  admin: AdminGraphqlClient,
  variantIds: string[],
  locations: string[],
): Promise<VariantLevels[] | null> {
  const locs = locations.slice(0, MAX_LOCATIONS);
  if (!locs.length || !variantIds.length) return null;
  try {
    const out: VariantLevels[] = [];
    const page = variantPageSize(locs.length);
    for (let i = 0; i < variantIds.length; i += page) {
      const res = await admin.graphql(buildStockQuery("variants", locs.length), {
        variables: { ids: variantIds.slice(i, i + page).map(variantGid), ...locationVars(locs) },
      });
      const body = (await res.json()) as { data?: { nodes?: (VariantNode | null)[] } };
      for (const n of body.data?.nodes ?? []) {
        const v = n ? parseVariantNode(n, locs) : null;
        if (v) out.push(v);
      }
    }
    return out;
  } catch (err) {
    console.error("[encore] market stock read failed", err);
    return null;
  }
}

// ---------- caches (hot path) ----------

const STOCK_TTL_MS = 60_000;
const LOCATIONS_TTL_MS = 10 * 60_000;
const MAX_CACHE = 2000;

type Entry<T> = { at: number; value: Promise<T> };
const stockCache = new Map<string, Entry<VariantLevels[] | null>>();
const locationCache = new Map<string, Entry<string[] | null>>();
const autoReconcileAt = new Map<string, number>();

function cached<T>(map: Map<string, Entry<T>>, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = map.get(key);
  if (hit && now - hit.at < ttl) return hit.value;
  if (map.size >= MAX_CACHE) {
    // Drop the oldest entries (Map keeps insertion order).
    for (const k of map.keys()) {
      map.delete(k);
      if (map.size < MAX_CACHE * 0.9) break;
    }
  }
  const value = load().catch(() => null as T);
  map.set(key, { at: now, value });
  return value;
}

/** Test hook. */
export function clearMarketStockCache(): void {
  stockCache.clear();
  locationCache.clear();
}

/** Drop a shop's cached stock (after an inventory webhook). */
export function invalidateShopStock(shop: string): void {
  for (const k of stockCache.keys()) if (k.startsWith(`${shop}|`)) stockCache.delete(k);
}

/** Active, online-fulfilling locations (fallback serving set), cached 10 min. */
export function getFulfillingLocations(admin: AdminGraphqlClient, shop: string): Promise<string[] | null> {
  return cached(locationCache, shop, LOCATIONS_TTL_MS, async () => {
    const locs = await fetchLocations(admin);
    return locs ? locs.filter((l) => l.active && l.fulfills).map((l) => l.id) : null;
  });
}

/** Serving locations for a market, with the live fallback only when needed. */
export async function servingLocationsFor(
  admin: AdminGraphqlClient,
  shop: string,
  marketId: string,
  rule: MarketRuleData,
): Promise<string[] | null> {
  const direct = resolveServingLocations(marketId, rule, null);
  if (direct) return direct;
  return resolveServingLocations(marketId, rule, await getFulfillingLocations(admin, shop));
}

/**
 * Per-variant stock at the given serving locations for one product, keyed by
 * numeric variant id. null when Shopify couldn't be read (callers then keep
 * today's behaviour — global availability).
 */
export async function getMarketVariantStock(
  admin: AdminGraphqlClient,
  shop: string,
  productId: string,
  serving: string[],
): Promise<Record<string, VariantMarketStock> | null> {
  const locs = Array.from(new Set(serving)).sort();
  // Beyond the aliased-read limit a location would read as 0 — fall back to
  // global availability rather than show a false "sold out".
  if (!locs.length || locs.length > MAX_LOCATIONS || !productId) return null;
  const key = `${shop}|${num(productId)}|${locs.join(",")}`;
  const rows = await cached(stockCache, key, STOCK_TTL_MS, () => readProductLevels(admin, productId, locs));
  if (!rows) return null;
  const out: Record<string, VariantMarketStock> = {};
  for (const r of rows) out[r.id] = stockAtLocations(r.tracked, r.available, locs);
  return out;
}

// ---------- which variants Encore manages / offers where ----------

type CampaignLike = {
  id: string;
  status: string;
  productMode: string;
  productIds: string;
  variantConfigs: string;
  maxPerCampaign: number | null;
  startDate: Date | null;
  endDate: Date | null;
  markets?: string | null;
};

type VariantCfg = { productId?: string; variantId?: string; availability?: string; availStart?: string; availEnd?: string };

function cfgsOf(c: CampaignLike): VariantCfg[] {
  try {
    const v = JSON.parse(c.variantConfigs) as VariantCfg[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Campaign-level market targeting (Campaign.markets — [] = all markets). */
export function campaignAllowsMarket(c: { markets?: string | null }, marketId: string): boolean {
  const cm = jsonArr(c.markets ?? "[]");
  return !cm.length || !marketId || cm.some((m) => sameMarket(m, marketId));
}

/**
 * Does a SPECIFIC campaign cover this variant? (Explicit variant row, or the
 * whole product when the campaign has no variant rows for it.)
 */
export function specificCovers(c: CampaignLike, productId: string, variantId: string): VariantCfg | "product" | null {
  if (!jsonArr(c.productIds).map(num).includes(num(productId))) return null;
  const mine = cfgsOf(c).filter((v) => v.variantId && (!v.productId || num(v.productId) === num(productId)));
  if (!mine.length) return "product";
  return mine.find((v) => num(v.variantId) === num(variantId)) ?? null;
}

// ---------- checkout guard: encore.market_blocked ----------

const MF_SET = `#graphql
mutation EncoreMarketBlockedSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { userErrors { field message } }
}`;
const MF_DELETE = `#graphql
mutation EncoreMarketBlockedDelete($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) { userErrors { field message } }
}`;

/**
 * Markets (numeric ids) where a variant must not be sold: Encore manages it
 * (a LIVE SPECIFIC campaign covers it — the variants whose policy Encore sets
 * to CONTINUE), it has no stock at the market's serving locations, and no
 * preorder is offered to it there. Pure given its inputs.
 */
export async function blockedMarketsFor(
  shop: string,
  v: VariantLevels,
  rule: MarketRuleData,
  marketIds: string[],
  serving: Record<string, string[] | null>,
  live: CampaignLike[],
  now: Date = new Date(),
): Promise<string[]> {
  const active = live.filter(
    (c) => c.status === "LIVE" && !(c.startDate && c.startDate > now) && !(c.endDate && c.endDate < now),
  );
  const covering = active
    .filter((c) => c.productMode === "SPECIFIC")
    .map((c) => ({ c, cov: specificCovers(c, v.productId, v.id) }))
    .filter((x) => x.cov);
  if (!covering.length) return []; // not managed → never blocked
  // Fail open: a catalog-wide (ALL) or collection campaign may offer it anywhere.
  const broad = active.filter((c) => c.productMode === "ALL" || c.productMode === "COLLECTION");

  const out: string[] = [];
  for (const m of marketIds) {
    const locs = serving[m];
    if (!locs || !locs.length) continue; // unknown → never block
    const { inStock } = stockAtLocations(v.tracked, v.available, locs);
    let offered = false;
    if (marketInScope(rule, m)) {
      if (broad.some((c) => campaignAllowsMarket(c, m))) offered = true;
      for (const { c, cov } of covering) {
        if (offered) break;
        if (!campaignAllowsMarket(c, m)) continue;
        if (cov !== "product" && !variantWindowOpen(cov, now)) continue;
        const cap = await getCampaignCapacity(shop, c, variantGid(v.id));
        if (!cap.soldOut) offered = true;
      }
    }
    if (isMarketBlocked({ managed: true, inStockHere: inStock, offered })) out.push(marketNum(m));
  }
  return out.sort();
}

/**
 * Recompute `encore.market_blocked` for Encore-managed variants.
 *   - variantIds given → just those (inventory webhook, released variants)
 *   - otherwise        → every variant of every LIVE SPECIFIC campaign product
 * Writes only when the value changes; deletes it when nothing is blocked.
 * `reconcile: true` refreshes the market ↔ location snapshot first (hourly job).
 * Best-effort: never throws. Single-market shops return before any API call
 * (unless `reconcile` is asked for, or the snapshot was never taken).
 */
export async function syncMarketBlocks(
  admin: AdminGraphqlClient,
  shop: string,
  opts: { variantIds?: string[]; productIds?: string[]; reconcile?: boolean } = {},
): Promise<{ checked: number; written: number; cleared: number } | { skipped: string }> {
  try {
    let rule = await getMarketRule(shop);
    // Never reconciled (merchant hasn't opened Per-market rules yet): take the
    // snapshot once — throttled per shop so a failing read can't loop.
    const neverReconciled = !Object.keys(rule.marketSnapshot).length;
    const lastTry = autoReconcileAt.get(shop) ?? 0;
    if (opts.reconcile || (neverReconciled && Date.now() - lastTry > 60 * 60_000)) {
      autoReconcileAt.set(shop, Date.now());
      const r = await reconcileMarkets(admin, shop);
      if (!r.unreadable) rule = await getMarketRule(shop);
    }
    if (!isMultiMarket(rule)) return { skipped: "single market" };

    const live = (await prisma.campaign.findMany({
      where: { shop, status: "LIVE" },
    })) as unknown as CampaignLike[];

    const marketIds = Object.keys(rule.marketSnapshot);
    const serving: Record<string, string[] | null> = {};
    for (const m of marketIds) serving[m] = await servingLocationsFor(admin, shop, m, rule);
    const allLocs = Array.from(new Set(Object.values(serving).flatMap((l) => l ?? []))).sort();
    if (!allLocs.length) return { skipped: "no locations" };
    if (allLocs.length > MAX_LOCATIONS) {
      // Beyond the aliased-read limit a location would read as 0 and could
      // block wrongly — fail open instead.
      console.warn(`[market-stock] ${shop}: ${allLocs.length} serving locations > ${MAX_LOCATIONS}; checkout guard skipped`);
      return { skipped: "too many locations" };
    }

    let rows: VariantLevels[] = [];
    if (opts.variantIds?.length && !opts.productIds?.length) {
      rows = (await readVariantLevels(admin, opts.variantIds, allLocs)) ?? [];
    } else {
      // A save names its campaigns' products → only those (a save used to
      // re-read every live product, one by one, on every campaign change).
      // No names (hourly reconcile / market-rule save) → every live SPECIFIC product.
      const named = (opts.productIds ?? []).map(num).filter(Boolean);
      const products = new Set<string>(named);
      if (!named.length) {
        for (const c of live) {
          if (c.productMode !== "SPECIFIC") continue;
          for (const p of jsonArr(c.productIds)) products.add(num(p));
        }
      }
      for (const p of Array.from(products).slice(0, 100)) {
        rows.push(...((await readProductLevels(admin, p, allLocs)) ?? []));
      }
    }

    const sets: Record<string, unknown>[] = [];
    const dels: Record<string, unknown>[] = [];
    for (const v of rows) {
      const want = await blockedMarketsFor(shop, v, rule, marketIds, serving, live);
      if (!blockedNeedsWrite(v.blocked, want)) continue;
      if (want.length) {
        const value: MarketBlockedValue = { m: want, until: blockUntil() };
        sets.push({
          ownerId: variantGid(v.id),
          namespace: "encore",
          key: "market_blocked",
          type: "json",
          value: JSON.stringify(value),
        });
      } else if (v.blocked) {
        dels.push({ ownerId: variantGid(v.id), namespace: "encore", key: "market_blocked" });
      }
    }
    for (let i = 0; i < sets.length; i += 25) {
      await admin.graphql(MF_SET, { variables: { metafields: sets.slice(i, i + 25) } });
    }
    for (let i = 0; i < dels.length; i += 25) {
      await admin.graphql(MF_DELETE, { variables: { metafields: dels.slice(i, i + 25) } });
    }
    if (sets.length || dels.length) {
      console.log(`[market-stock] ${shop}: market_blocked set on ${sets.length}, cleared on ${dels.length} variant(s)`);
    }
    return { checked: rows.length, written: sets.length, cleared: dels.length };
  } catch (err) {
    console.error("[market-stock] syncMarketBlocks failed", shop, err);
    return { skipped: "error" };
  }
}

/** Never-throwing variant for route handlers / webhooks. */
export async function syncMarketBlocksSafe(
  admin: AdminGraphqlClient,
  shop: string,
  opts: { variantIds?: string[]; productIds?: string[]; reconcile?: boolean } = {},
): Promise<void> {
  try {
    await syncMarketBlocks(admin, shop, opts);
  } catch (e) {
    console.error("[market-stock] sync failed", e);
  }
}

// ---------- admin summary ----------

export type MarketStockSummary = Record<string, { inStock: number; total: number }>;

/**
 * Per market: how many preorder variants (LIVE SPECIFIC campaigns, first
 * `maxProducts` products) have sellable stock at that market's locations.
 * null when there is nothing to check or Shopify couldn't be read.
 */
export async function marketStockSummary(
  admin: AdminGraphqlClient,
  shop: string,
  rule: MarketRuleData,
  marketIds: string[],
  maxProducts = 5,
): Promise<{ summary: MarketStockSummary; products: number; totalProducts: number } | null> {
  try {
    const live = (await prisma.campaign.findMany({
      where: { shop, status: "LIVE", productMode: "SPECIFIC" },
    })) as unknown as CampaignLike[];
    const products = Array.from(new Set(live.flatMap((c) => jsonArr(c.productIds).map(num)))).filter(Boolean);
    if (!products.length || !marketIds.length) return null;

    const serving: Record<string, string[] | null> = {};
    for (const m of marketIds) serving[m] = await servingLocationsFor(admin, shop, m, rule);
    const allLocs = Array.from(new Set(Object.values(serving).flatMap((l) => l ?? []))).sort();
    if (!allLocs.length || allLocs.length > MAX_LOCATIONS) return null;

    const summary: MarketStockSummary = {};
    for (const m of marketIds) summary[m] = { inStock: 0, total: 0 };
    const checked = products.slice(0, maxProducts);
    for (const p of checked) {
      const rows = await readProductLevels(admin, p, allLocs);
      if (!rows) continue;
      for (const v of rows) {
        if (!live.some((c) => specificCovers(c, v.productId || p, v.id))) continue;
        for (const m of marketIds) {
          const locs = serving[m] ?? [];
          if (!locs.length) continue;
          summary[m].total += 1;
          if (stockAtLocations(v.tracked, v.available, locs).inStock) summary[m].inStock += 1;
        }
      }
    }
    return { summary, products: checked.length, totalProducts: products.length };
  } catch (err) {
    console.error("[market-stock] summary failed", err);
    return null;
  }
}
