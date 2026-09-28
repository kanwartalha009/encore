/**
 * Pure logic for the product-page Purchase options extension
 * (extensions/encore-purchase-options → /api/purchase-options).
 *
 * No `.server` imports: request validation, campaign scope edits and summary
 * mapping live here so they can be unit-tested (tests/purchase-options.test.ts)
 * and reused by app/services/purchase-options.server.ts.
 *
 * Error codes are stable strings — the extension maps them to its own
 * translated messages (extensions/encore-purchase-options/locales).
 */

export type PoPayment = "PAY_NOW" | "DEPOSIT" | "PAY_LATER";
export type PoWhen = "now" | "oos" | "date";

/** A resolved target: the product, plus the variant when opened on a variant page. */
export type PoTarget = { productId: string; variantId: string | null };
/** A target as sent by the extension (either GID may be missing; resolved server-side). */
export type PoRawTarget = { productId: string | null; variantId: string | null };

export type PoAction =
  | { action: "attach"; target: PoRawTarget; campaignId: string }
  | {
      action: "create";
      target: PoRawTarget;
      name: string;
      when: PoWhen;
      startDate: string | null;
      payment: PoPayment;
      depositPct: number | null;
      shipDate: string | null;
      locale: string | null;
    }
  | {
      action: "update";
      campaignId: string;
      /** undefined = leave payment unchanged */
      payment?: PoPayment;
      depositPct?: number | null;
      /** undefined = unchanged, null = clear, string = YYYY-MM-DD */
      shipDate?: string | null;
    }
  | { action: "detach"; target: PoRawTarget; campaignId: string }
  | { action: "pause"; campaignId: string }
  | { action: "resume"; campaignId: string };

export type PoErrorCode =
  | "invalid_body"
  | "unknown_action"
  | "invalid_target"
  | "invalid_campaign"
  | "name_required"
  | "name_too_long"
  | "invalid_when"
  | "start_date_required"
  | "invalid_date"
  | "ship_date_past"
  | "invalid_payment"
  | "deposit_pct_range"
  | "nothing_to_update";

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: PoErrorCode };

const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const SELLING_PLAN_GID = /^gid:\/\/shopify\/SellingPlan\/\d+$/;
const CAMPAIGN_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const NAME_MAX = 120;

export const isProductGid = (v: unknown): v is string => typeof v === "string" && PRODUCT_GID.test(v);
export const isVariantGid = (v: unknown): v is string => typeof v === "string" && VARIANT_GID.test(v);
export const isSellingPlanGid = (v: unknown): v is string =>
  typeof v === "string" && SELLING_PLAN_GID.test(v);
export const isCampaignId = (v: unknown): v is string => typeof v === "string" && CAMPAIGN_ID.test(v);

/** Numeric tail of a GID (or the value itself when it is already numeric). */
export function gidNum(v: string | null | undefined): string {
  if (!v) return "";
  return String(v).split("/").pop() ?? "";
}
const sameId = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && gidNum(a) !== "" && gidNum(a) === gidNum(b);

/** YYYY-MM-DD → Date (UTC midnight), or null when malformed. */
export function parseDay(v: string): Date | null {
  if (!ISO_DAY.test(v)) return null;
  const d = new Date(`${v}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  return d;
}

/** A day earlier than "yesterday" (UTC) — one day of slack for time zones. */
export function isPastDay(day: Date, now: Date): boolean {
  const floor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return day.getTime() < floor.getTime();
}

/**
 * Query-string target (GET). The extension passes the GID it was opened for:
 * `productId` on the product page, `variantId` on the variant page.
 */
export function parseTargetParams(params: URLSearchParams): ParseResult<{
  productId: string | null;
  variantId: string | null;
  sellingPlanId: string | null;
}> {
  const productId = params.get("productId") || null;
  const variantId = params.get("variantId") || null;
  const sellingPlanId = params.get("sellingPlanId") || null;
  if (!productId && !variantId) return { ok: false, error: "invalid_target" };
  if (productId && !isProductGid(productId)) return { ok: false, error: "invalid_target" };
  if (variantId && !isVariantGid(variantId)) return { ok: false, error: "invalid_target" };
  if (sellingPlanId && !isSellingPlanGid(sellingPlanId)) return { ok: false, error: "invalid_target" };
  return { ok: true, value: { productId, variantId, sellingPlanId } };
}

function parseTarget(raw: unknown): ParseResult<PoRawTarget> {
  if (!raw || typeof raw !== "object") return { ok: false, error: "invalid_target" };
  const r = raw as Record<string, unknown>;
  const productId = r.productId == null || r.productId === "" ? null : r.productId;
  const variantId = r.variantId == null || r.variantId === "" ? null : r.variantId;
  if (!productId && !variantId) return { ok: false, error: "invalid_target" };
  if (productId != null && !isProductGid(productId)) return { ok: false, error: "invalid_target" };
  if (variantId != null && !isVariantGid(variantId)) return { ok: false, error: "invalid_target" };
  return {
    ok: true,
    value: { productId: (productId as string | null) ?? null, variantId: (variantId as string | null) ?? null },
  };
}

function parsePayment(
  payment: unknown,
  depositPct: unknown,
): ParseResult<{ payment: PoPayment; depositPct: number | null }> {
  if (payment !== "PAY_NOW" && payment !== "DEPOSIT" && payment !== "PAY_LATER") {
    return { ok: false, error: "invalid_payment" };
  }
  if (payment !== "DEPOSIT") return { ok: true, value: { payment, depositPct: null } };
  const n = typeof depositPct === "string" ? Number(depositPct) : depositPct;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1 || n > 99) {
    return { ok: false, error: "deposit_pct_range" };
  }
  return { ok: true, value: { payment, depositPct: Math.round(n * 100) / 100 } };
}

function parseOptionalDay(v: unknown, now: Date): ParseResult<string | null> {
  if (v == null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "invalid_date" };
  const d = parseDay(v);
  if (!d) return { ok: false, error: "invalid_date" };
  if (isPastDay(d, now)) return { ok: false, error: "ship_date_past" };
  return { ok: true, value: v };
}

/**
 * Validate a POST body from the extension. Target GIDs are only checked for
 * shape here; the service resolves them against the Admin API (and the variant
 * → product link) before anything is written.
 */
export function parsePurchaseOptionAction(
  body: unknown,
  now: Date = new Date(),
): ParseResult<PoAction> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  const action = b.action;

  const needCampaign = (): ParseResult<string> =>
    isCampaignId(b.campaignId) ? { ok: true, value: b.campaignId } : { ok: false, error: "invalid_campaign" };

  const target = (): ParseResult<PoRawTarget> => parseTarget(b.target);

  switch (action) {
    case "attach":
    case "detach": {
      const c = needCampaign();
      if (!c.ok) return c;
      const t = target();
      if (!t.ok) return t;
      return {
        ok: true,
        value: {
          action,
          campaignId: c.value,
          target: t.value,
        },
      };
    }
    case "pause":
    case "resume": {
      const c = needCampaign();
      if (!c.ok) return c;
      return { ok: true, value: { action, campaignId: c.value } };
    }
    case "create": {
      const t = target();
      if (!t.ok) return t;
      const name = typeof b.name === "string" ? b.name.trim() : "";
      if (!name) return { ok: false, error: "name_required" };
      if (name.length > NAME_MAX) return { ok: false, error: "name_too_long" };
      const when = b.when;
      if (when !== "now" && when !== "oos" && when !== "date") return { ok: false, error: "invalid_when" };
      let startDate: string | null = null;
      if (when === "date") {
        if (typeof b.startDate !== "string" || !b.startDate) return { ok: false, error: "start_date_required" };
        if (!parseDay(b.startDate)) return { ok: false, error: "invalid_date" };
        startDate = b.startDate;
      }
      const p = parsePayment(b.payment, b.depositPct);
      if (!p.ok) return p;
      const ship = parseOptionalDay(b.shipDate, now);
      if (!ship.ok) return ship;
      const locale = typeof b.locale === "string" && LOCALE.test(b.locale) ? b.locale : null;
      return {
        ok: true,
        value: {
          action,
          target: t.value,
          name,
          when,
          startDate,
          payment: p.value.payment,
          depositPct: p.value.depositPct,
          shipDate: ship.value,
          locale,
        },
      };
    }
    case "update": {
      const c = needCampaign();
      if (!c.ok) return c;
      const out: Extract<PoAction, { action: "update" }> = { action, campaignId: c.value };
      if (b.payment !== undefined) {
        const p = parsePayment(b.payment, b.depositPct);
        if (!p.ok) return p;
        out.payment = p.value.payment;
        out.depositPct = p.value.depositPct;
      }
      if (b.shipDate !== undefined) {
        const ship = parseOptionalDay(b.shipDate, now);
        if (!ship.ok) return ship;
        out.shipDate = ship.value;
      }
      if (out.payment === undefined && out.shipDate === undefined) {
        return { ok: false, error: "nothing_to_update" };
      }
      return { ok: true, value: out };
    }
    default:
      return { ok: false, error: "unknown_action" };
  }
}

// ---------- Campaign scope (productIds + variantConfigs) ----------
//
// A campaign is either PRODUCT-level (variantConfigs empty → every variant of
// each product) or VARIANT-level (variantConfigs lists the exact variants, and
// inventory-policy / caps treat the list as exhaustive across all products).
// Mixing the two would silently drop whole products from the continue-selling
// sync, so edits here keep the campaign in exactly one of the two shapes.

export type ScopeVariantConfig = {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  unitsOffered: number;
  [k: string]: unknown;
};
export type CampaignScope = { productIds: string[]; variantConfigs: ScopeVariantConfig[] };
export type CatalogProduct = { id: string; title: string; variants: { id: string; title: string }[] };
export type Catalog = Map<string, CatalogProduct>; // keyed by gidNum(productId)

export class ScopeError extends Error {
  constructor(public code: "catalog_missing" | "variant_not_found") {
    super(code);
  }
}

function catalogGet(catalog: Catalog, productId: string): CatalogProduct {
  const p = catalog.get(gidNum(productId));
  if (!p) throw new ScopeError("catalog_missing");
  return p;
}

function configsFor(p: CatalogProduct, variantIds?: string[]): ScopeVariantConfig[] {
  return p.variants
    .filter((v) => !variantIds || variantIds.some((id) => sameId(id, v.id)))
    .map((v) => ({
      productId: p.id,
      variantId: v.id,
      productTitle: p.title,
      variantTitle: v.title,
      // 0 = no per-variant limit (same as a product-level preorder); the
      // merchant can set one in Encore.
      unitsOffered: 0,
      availability: "now",
    }));
}

/** Product ids whose variants a scope needs from the Admin API for add/remove. */
export function productsNeededForScopeEdit(scope: CampaignScope, target: PoTarget): string[] {
  const ids = [target.productId];
  if (scope.variantConfigs.length === 0 && target.variantId) ids.push(...scope.productIds);
  return Array.from(new Map(ids.filter(Boolean).map((id) => [gidNum(id), id])).values());
}

export function scopeContains(scope: CampaignScope, target: PoTarget): boolean {
  if (!scope.productIds.some((p) => sameId(p, target.productId))) return false;
  if (!target.variantId || scope.variantConfigs.length === 0) return true;
  return scope.variantConfigs.some((vc) => sameId(vc.variantId, target.variantId));
}

export function addTargetToScope(scope: CampaignScope, target: PoTarget, catalog: Catalog): CampaignScope {
  const productIds = scope.productIds.some((p) => sameId(p, target.productId))
    ? [...scope.productIds]
    : [...scope.productIds, target.productId];
  const variantLevel = scope.variantConfigs.length > 0 || !!target.variantId;
  if (!variantLevel) return { productIds, variantConfigs: [] };

  let configs = [...scope.variantConfigs];
  if (configs.length === 0) {
    // Product-level campaign gaining a single variant: expand the products it
    // already covers so none of them lose coverage.
    for (const pid of scope.productIds) configs.push(...configsFor(catalogGet(catalog, pid)));
  }
  const product = catalogGet(catalog, target.productId);
  const toAdd = configsFor(product, target.variantId ? [target.variantId] : undefined);
  if (target.variantId && toAdd.length === 0) throw new ScopeError("variant_not_found");
  for (const cfg of toAdd) {
    if (!configs.some((c) => sameId(c.variantId, cfg.variantId))) configs = [...configs, cfg];
  }
  return { productIds, variantConfigs: configs };
}

/**
 * Remove the product (or one variant) from a campaign. Returns the variant
 * GIDs that left the campaign so their continue-selling policy and checkout
 * caps can be released.
 */
export function removeTargetFromScope(
  scope: CampaignScope,
  target: PoTarget,
  catalog: Catalog,
): { scope: CampaignScope; removedVariantIds: string[] } {
  const isTargetProduct = (pid: string) => sameId(pid, target.productId);

  if (!target.variantId) {
    const removedFromConfigs = scope.variantConfigs
      .filter((c) => isTargetProduct(c.productId))
      .map((c) => c.variantId);
    const removedVariantIds =
      scope.variantConfigs.length === 0
        ? (catalog.get(gidNum(target.productId))?.variants.map((v) => v.id) ?? [])
        : removedFromConfigs;
    return {
      scope: {
        productIds: scope.productIds.filter((p) => !isTargetProduct(p)),
        variantConfigs: scope.variantConfigs.filter((c) => !isTargetProduct(c.productId)),
      },
      removedVariantIds,
    };
  }

  // Variant removal.
  let configs = scope.variantConfigs;
  if (configs.length === 0) {
    // Product-level → variant-level, minus this one variant.
    configs = scope.productIds.flatMap((pid) => configsFor(catalogGet(catalog, pid)));
  }
  const remaining = configs.filter((c) => !sameId(c.variantId, target.variantId));
  const productIds = scope.productIds.filter((pid) => remaining.some((c) => sameId(c.productId, pid)));
  return {
    scope: { productIds, variantConfigs: remaining },
    removedVariantIds: configs.length === remaining.length ? [] : [target.variantId],
  };
}

// ---------- Summaries ----------

export type CampaignSummary = {
  id: string;
  name: string;
  status: string;
  paymentMode: PoPayment;
  depositKind: "PERCENT" | "FIXED";
  /** Deposit % (only for percentage deposits). */
  depositPct: number | null;
  shipDate: string | null; // YYYY-MM-DD
  productCount: number;
};

export function summarizeCampaign(c: {
  id: string;
  name: string;
  status: string;
  paymentMode: string;
  depositKind: string;
  depositAmount: number;
  shipDate: Date | null;
  productIds: string;
}): CampaignSummary {
  const paymentMode: PoPayment =
    c.paymentMode === "DEPOSIT" || c.paymentMode === "PAY_LATER" ? c.paymentMode : "PAY_NOW";
  const depositKind = c.depositKind === "FIXED" ? "FIXED" : "PERCENT";
  let productCount = 0;
  try {
    const ids = JSON.parse(c.productIds);
    productCount = Array.isArray(ids) ? ids.length : 0;
  } catch {
    productCount = 0;
  }
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    paymentMode,
    depositKind,
    depositPct: paymentMode === "DEPOSIT" && depositKind === "PERCENT" ? c.depositAmount : null,
    shipDate: c.shipDate ? c.shipDate.toISOString().slice(0, 10) : null,
    productCount,
  };
}

const STATUS_RANK: Record<string, number> = { LIVE: 0, SCHEDULED: 1, PAUSED: 2, DRAFT: 3 };

/** The campaign that best represents "this product's preorder" (ENDED excluded). */
export function pickCurrentCampaign<T extends { status: string; productMode: string; scope: CampaignScope }>(
  rows: T[],
  target: PoTarget,
): T | null {
  const hits = rows.filter(
    (r) => r.productMode === "SPECIFIC" && r.status in STATUS_RANK && scopeContains(r.scope, target),
  );
  hits.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  return hits[0] ?? null;
}

/** Status a newly created preorder starts in. */
export function initialStatus(when: PoWhen, startDate: string | null, now: Date): "LIVE" | "SCHEDULED" {
  if (when !== "date" || !startDate) return "LIVE";
  const d = parseDay(startDate);
  return d && d.getTime() > now.getTime() ? "SCHEDULED" : "LIVE";
}

export function triggerFor(when: PoWhen): "MANUAL" | "STOCK" | "DATE" {
  return when === "oos" ? "STOCK" : when === "date" ? "DATE" : "MANUAL";
}

/**
 * Store defaults (Settings → General, as returned by the form's
 * campaignDefaultsFromSettings) → DB-shaped campaign fields, so a preorder made
 * from the product page matches one made in the app.
 */
export function formDefaultsToCampaignFields(v: {
  paymentMode: string;
  depositAmount: string;
  balanceCaptureDays: string;
  deliveryNote: string;
  ctaLabel: string;
  ctaPlacement: string;
  cartMode: string;
  mixedCartWarning: string;
  orderTags: string[];
}) {
  const num = (s: string, d: number) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : d;
  };
  const upper = <T extends string>(s: string, allowed: readonly T[], d: T): T => {
    const u = String(s ?? "").toUpperCase() as T;
    return allowed.includes(u) ? u : d;
  };
  return {
    paymentMode: upper(v.paymentMode, ["PAY_NOW", "DEPOSIT", "PAY_LATER"] as const, "PAY_NOW"),
    depositPct: num(v.depositAmount, 20),
    balanceCaptureDays: Math.trunc(num(v.balanceCaptureDays, 7)),
    deliveryNote: v.deliveryNote,
    ctaLabel: v.ctaLabel || "Preorder",
    ctaPlacement: upper(v.ctaPlacement, ["REPLACE", "BESIDE", "STACK"] as const, "REPLACE"),
    cartMode: upper(v.cartMode, ["SPLIT", "WARNING"] as const, "SPLIT"),
    mixedCartWarning: v.mixedCartWarning,
    orderTags: (v.orderTags ?? []).filter(Boolean),
  };
}
