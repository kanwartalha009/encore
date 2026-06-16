/**
 * Per-market rules — the flagship "in-stock here, preorder there".
 *
 * Store-level MarketRule (one per shop): scope (ALL / SPECIFIC markets) +
 * per-market overrides + last reconcile time. The storefront config
 * (storefront.server.ts) consults this so preorder is only offered in the
 * markets the merchant scoped — and the matrix surfaces where sellable stock
 * exists so we never offer preorder where the market can already buy.
 *
 * MarketRule is added via `prisma db push`; reached through a narrow cast until
 * the client regenerates.
 */

import prisma from "../db.server";

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type PerMarketOverride = {
  shipDate?: string;
  badge?: string;
  /** Merchant: this market has no local stock → always preorder. */
  forcePreorder?: boolean;
  /** Locations that fulfill this market (defaults to all online-fulfilling). */
  locations?: string[];
};
export type MarketSnapshot = Record<
  string,
  { locations: string[]; fulfillable: boolean }
>;
export type MarketRuleData = {
  scope: "ALL" | "SPECIFIC";
  markets: string[];
  perMarketOverrides: Record<string, PerMarketOverride>;
  marketSnapshot: MarketSnapshot;
  lastReconciledAt: string | null;
};

type Row = {
  scope?: string;
  markets?: string;
  perMarketOverrides?: string;
  marketSnapshot?: string;
  lastReconciledAt?: Date | null;
};

const model = (
  prisma as unknown as {
    marketRule: {
      findUnique(a: { where: { shop: string } }): Promise<Row | null>;
      upsert(a: {
        where: { shop: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }): Promise<unknown>;
    };
  }
).marketRule;

function parseArr(s?: string): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
function parseObj(s?: string): Record<string, PerMarketOverride> {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as Record<string, PerMarketOverride>) : {};
  } catch {
    return {};
  }
}

function parseSnapshot(s?: string): MarketSnapshot {
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? (v as MarketSnapshot) : {};
  } catch {
    return {};
  }
}

export async function getMarketRule(shop: string): Promise<MarketRuleData> {
  const row = await model.findUnique({ where: { shop } });
  return {
    scope: row?.scope === "SPECIFIC" ? "SPECIFIC" : "ALL",
    markets: parseArr(row?.markets),
    perMarketOverrides: parseObj(row?.perMarketOverrides),
    marketSnapshot: parseSnapshot(row?.marketSnapshot),
    lastReconciledAt: row?.lastReconciledAt
      ? new Date(row.lastReconciledAt).toISOString()
      : null,
  };
}

export async function saveMarketRule(
  shop: string,
  data: {
    scope: string;
    markets: string[];
    perMarketOverrides?: Record<string, PerMarketOverride>;
  },
): Promise<void> {
  const scope = data.scope === "SPECIFIC" ? "SPECIFIC" : "ALL";
  const markets = JSON.stringify(data.markets ?? []);
  const overrides = JSON.stringify(data.perMarketOverrides ?? {});
  await model.upsert({
    where: { shop },
    create: { shop, scope, markets, perMarketOverrides: overrides, lastReconciledAt: new Date() },
    update: { scope, markets, perMarketOverrides: overrides },
  });
}

/** Stamp the last reconcile time (called by the inventory webhook / job). */
export async function touchReconciled(shop: string): Promise<void> {
  await model.upsert({
    where: { shop },
    create: { shop, lastReconciledAt: new Date() },
    update: { lastReconciledAt: new Date() },
  });
}

// ---------- Markets (Admin GraphQL, with demo fallback) ----------

export type MarketRow = {
  id: string;
  name: string;
  handle: string;
  enabled: boolean;
  primary: boolean;
  /** Best-effort sellable stock for this market; null = not yet reconciled. */
  stock: number | null;
};

const MARKETS_QUERY = `#graphql
query EncoreMarkets {
  markets(first: 50) {
    edges { node { id name handle enabled primary } }
  }
}`;

export async function fetchMarkets(
  admin: AdminGraphqlClient,
): Promise<MarketRow[] | null> {
  try {
    const res = await admin.graphql(MARKETS_QUERY, {});
    const body = (await res.json()) as {
      data?: { markets?: { edges: { node: Record<string, unknown> }[] } };
    };
    const edges = body.data?.markets?.edges ?? [];
    if (!edges.length) return null;
    return edges.map((e) => {
      const n = e.node;
      return {
        id: String(n.id),
        name: String(n.name ?? ""),
        handle: String(n.handle ?? ""),
        enabled: Boolean(n.enabled),
        primary: Boolean(n.primary),
        stock: null,
      };
    });
  } catch {
    return null;
  }
}

// Used when Markets/inventory can't be read (e.g. local dev without a store).
export const DEMO_MARKETS: MarketRow[] = [
  { id: "gid://shopify/Market/1", name: "United States", handle: "us", enabled: true, primary: true, stock: 42 },
  { id: "gid://shopify/Market/2", name: "Europe", handle: "eu", enabled: true, primary: false, stock: 0 },
  { id: "gid://shopify/Market/3", name: "United Kingdom", handle: "uk", enabled: true, primary: false, stock: 6 },
  { id: "gid://shopify/Market/4", name: "Canada", handle: "ca", enabled: true, primary: false, stock: 0 },
];

/**
 * Resulting shopper experience for a market under a rule. The invariant: never
 * "Preorder" where sellable stock exists for that market (the negative test).
 */
// ---------- Locations + reconciliation ----------

export type LocationRow = { id: string; name: string; active: boolean; fulfills: boolean };

const LOCATIONS_QUERY = `#graphql
query EncoreLocations {
  locations(first: 30) {
    edges { node { id name isActive fulfillsOnlineOrders } }
  }
}`;

export async function fetchLocations(
  admin: AdminGraphqlClient,
): Promise<LocationRow[] | null> {
  try {
    const res = await admin.graphql(LOCATIONS_QUERY, {});
    const body = (await res.json()) as {
      data?: { locations?: { edges: { node: Record<string, unknown> }[] } };
    };
    const edges = body.data?.locations?.edges ?? [];
    if (!edges.length) return null;
    return edges.map((e) => ({
      id: String(e.node.id),
      name: String(e.node.name ?? ""),
      active: Boolean(e.node.isActive),
      fulfills: Boolean(e.node.fulfillsOnlineOrders),
    }));
  } catch {
    return null;
  }
}

export const DEMO_LOCATIONS: LocationRow[] = [
  { id: "gid://shopify/Location/1", name: "US Warehouse", active: true, fulfills: true },
  { id: "gid://shopify/Location/2", name: "EU Warehouse", active: true, fulfills: true },
];

/**
 * Reconcile markets ↔ locations: snapshot each market's serving locations
 * (merchant override, else all online-fulfilling) + whether it can be fulfilled.
 * Persists the snapshot + stamps the reconcile time. Called by the screen loader
 * and the inventory_levels/update webhook.
 */
export async function reconcileMarkets(
  admin: AdminGraphqlClient,
  shop: string,
): Promise<{ markets: MarketRow[]; locations: LocationRow[]; usingDemo: boolean }> {
  const [liveMarkets, liveLocations, rule] = await Promise.all([
    fetchMarkets(admin),
    fetchLocations(admin),
    getMarketRule(shop),
  ]);
  const markets = liveMarkets ?? DEMO_MARKETS;
  const locations = liveLocations ?? DEMO_LOCATIONS;

  const fulfilling = locations.filter((l) => l.active && l.fulfills).map((l) => l.id);
  const snapshot: MarketSnapshot = {};
  for (const m of markets) {
    const assigned = rule.perMarketOverrides[m.id]?.locations;
    const serving = assigned && assigned.length ? assigned : fulfilling;
    snapshot[m.id] = { locations: serving, fulfillable: serving.length > 0 };
  }

  await model.upsert({
    where: { shop },
    create: { shop, marketSnapshot: JSON.stringify(snapshot), lastReconciledAt: new Date() },
    update: { marketSnapshot: JSON.stringify(snapshot), lastReconciledAt: new Date() },
  });

  return { markets, locations, usingDemo: !liveMarkets || !liveLocations };
}

/**
 * Resulting shopper experience for a market under a rule. Invariant: never
 * "Preorder" where sellable stock exists for that market (the negative test).
 */
export function marketExperience(
  m: MarketRow,
  rule: MarketRuleData,
): "Buy" | "Preorder" | "Off" {
  const inScope = rule.scope === "ALL" || rule.markets.includes(m.id);
  if (!inScope) return "Off"; // preorder not offered here
  const ov = rule.perMarketOverrides[m.id];
  if (ov?.forcePreorder) return "Preorder"; // merchant: no local stock in this market
  const snap = rule.marketSnapshot[m.id];
  if (snap && !snap.fulfillable) return "Preorder"; // no serving location can fulfil
  if (m.stock != null && m.stock <= 0) return "Preorder";
  return "Buy"; // sellable stock exists → never preorder
}
