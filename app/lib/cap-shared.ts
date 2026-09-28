/**
 * Preorder cap maths — pure, shared by the storefront config, the capacity
 * guard, the checkout-Function metafields and the inventory-policy sync, so
 * every layer agrees on "how many can still be preordered" (2026-09-28).
 *
 * Per variant the merchant can set two numbers in the preorder form:
 *   - Limit quantity (unitsOffered) — units offered on preorder
 *   - End quantity (endQty)         — stop the preorder at this cumulative count
 * Both are upper bounds on units sold, so the effective cap is the smaller of
 * the two that are set. Before this module, End quantity was stored and never
 * enforced.
 *
 * When more than one active campaign covers the same variant, the tightest
 * remaining allowance wins (previously the last metafield write won).
 */

export type VariantCapConfig = {
  variantId?: string | null;
  unitsOffered?: number | string | null;
  endQty?: number | string | null;
};

const positive = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
};

/** Effective per-variant cap, or null when the variant is uncapped. */
export function effectiveVariantCap(vc: VariantCapConfig | null | undefined): number | null {
  if (!vc) return null;
  const caps = [positive(vc.unitsOffered), positive(vc.endQty)].filter((n): n is number => n != null);
  return caps.length ? Math.min(...caps) : null;
}

/**
 * Combine the caps of every active campaign that covers one variant.
 * Returns null when no campaign caps it (→ the Function metafields are removed).
 */
export function combineVariantCaps(
  entries: { cap: number; sold: number }[],
): { cap: number; remaining: number } | null {
  if (!entries.length) return null;
  return {
    cap: Math.min(...entries.map((e) => e.cap)),
    remaining: Math.max(0, Math.min(...entries.map((e) => e.cap - e.sold))),
  };
}

/** Numeric tail of a Shopify GID (or the id itself). */
export const numId = (g?: string | null): string => (g ? String(g).split("/").pop() || "" : "");

/** Payment states that no longer hold a preorder unit (cancelled / refunded orders). */
export const RELEASED_PAYMENT_STATUSES = ["REFUNDED"] as const;

/**
 * Per-variant availability window from the preorder form (2026-09-28 — was
 * stored but never enforced). Dates are the form's YYYY-MM-DD values, read as
 * UTC: a start date opens at 00:00, an end date closes at 23:59:59 (inclusive).
 * A missing date leaves that side of the window open.
 */
export type VariantWindowConfig = {
  availability?: string | null;
  availStart?: string | null;
  availEnd?: string | null;
};

const dayStart = (d?: string | null): number | null => {
  if (!d) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d);
  return Number.isNaN(t) ? null : t;
};
const dayEnd = (d?: string | null): number | null => {
  if (!d) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59.999Z` : d);
  return Number.isNaN(t) ? null : t;
};

export function variantWindowOpen(vc: VariantWindowConfig | null | undefined, now: Date = new Date()): boolean {
  if (!vc) return true;
  const t = now.getTime();
  const start = dayStart(vc.availStart);
  const end = dayEnd(vc.availEnd);
  switch (vc.availability ?? "now") {
    case "not_available":
      return false;
    case "from_start":
      return start == null || t >= start;
    case "now_until_end":
      return end == null || t <= end;
    case "between":
      return (start == null || t >= start) && (end == null || t <= end);
    default:
      return true;
  }
}

/** Window boundaries (ms) of a variant config — to re-sync policy when crossed. */
export function variantWindowBoundaries(vc: VariantWindowConfig | null | undefined): number[] {
  if (!vc) return [];
  const out: number[] = [];
  const a = vc.availability ?? "now";
  if (a === "from_start" || a === "between") {
    const s = dayStart(vc.availStart);
    if (s != null) out.push(s);
  }
  if (a === "now_until_end" || a === "between") {
    const e = dayEnd(vc.availEnd);
    if (e != null) out.push(e + 1);
  }
  return out;
}
