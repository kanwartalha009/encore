// @ts-check
//
// Cart & Checkout Validation Function — Encore hard no-oversell guard.
// Blocks checkout when the quantity of a preorder variant on PREORDER lines
// (marked `_preorder` or bought with a selling plan; summed across cart lines)
// exceeds the variant's
// `encore.preorder_remaining` metafield (kept current by the app). Variants
// without that metafield aren't capped, so they're ignored.
//
// Per-market stock (2026-09-28): also blocks ANY line (preorder or not) of a
// variant whose `encore.market_blocked` metafield lists the buyer's market —
// the app writes it when the variant has no stock at the locations serving that
// market and no preorder is offered there ("sold out in this market"). The
// value carries an expiry date (`until`) so a block the app failed to clear
// lapses on its own.
//
// Runs in the Shopify Functions sandbox (no DB / network) — all data comes from
// the input query in cart_validations_generate_run.graphql.

/**
 * "gid://shopify/Market/123" → "123".
 * @param {unknown} gid
 * @returns {string}
 */
function numId(gid) {
  return gid ? String(gid).split("/").pop() || "" : "";
}

/**
 * Parse `encore.market_blocked`: {"m": ["123"], "until": "2026-10-01"}.
 * @param {string | null | undefined} raw
 * @returns {{ m: string[], until: string } | null}
 */
export function parseMarketBlocked(raw) {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return { m: v.map((x) => numId(String(x))), until: "" };
    if (v && typeof v === "object" && Array.isArray(v.m)) {
      return { m: v.m.map((/** @type {unknown} */ x) => numId(String(x))), until: String(v.until || "") };
    }
  } catch (e) {
    /* unreadable → not blocked */
  }
  return null;
}

/**
 * Is this variant blocked for the buyer's market today?
 * @param {string | null | undefined} raw metafield value
 * @param {string} market numeric market id ("" = unknown → never blocked)
 * @param {string} today shop-local YYYY-MM-DD ("" = unknown → expiry not applied)
 */
export function blockedInMarket(raw, market, today) {
  if (!market) return false;
  const v = parseMarketBlocked(raw);
  if (!v) return false;
  if (v.until && today && today > v.until) return false; // expired
  return v.m.indexOf(market) !== -1;
}

/**
 * @typedef {import("../generated/api").CartValidationsGenerateRunInput} CartValidationsGenerateRunInput
 * @typedef {import("../generated/api").CartValidationsGenerateRunResult} CartValidationsGenerateRunResult
 */

/**
 * @param {CartValidationsGenerateRunInput} input
 * @returns {CartValidationsGenerateRunResult}
 */
export function cartValidationsGenerateRun(input) {
  /** @type {{message: string, target: string}[]} */
  const errors = [];

  // Sum quantities per variant first: the same variant can sit on several
  // cart lines (different line properties / selling plans), and checking each
  // line alone let 3 + 3 through against 5 remaining (audit 2026-09-28).
  /** @type {Map<string, {qty: number, remaining: number, name: string}>} */
  const byVariant = new Map();
  const inp = /** @type {any} */ (input);
  const market = numId(inp.localization && inp.localization.market && inp.localization.market.id);
  const today = (inp.shop && inp.shop.localTime && inp.shop.localTime.date) || "";
  /** @type {Set<string>} */
  const marketBlocked = new Set();
  input.cart.lines.forEach((line, idx) => {
    const m = line.merchandise;
    if (!m || m.__typename !== "ProductVariant") return;

    // Sold out in the buyer's market (no stock at its locations, no preorder
    // offered there) — applies to every line of the variant, marked or not.
    const mb = /** @type {any} */ (m).marketBlocked;
    if (mb && blockedInMarket(mb.value, market, today)) {
      const key = /** @type {any} */ (m).id || `line:${idx}`;
      if (!marketBlocked.has(key)) {
        marketBlocked.add(key);
        const title = /** @type {any} */ (m).product && /** @type {any} */ (m).product.title;
        errors.push({
          message: `${title || "This item"} is sold out in your region.`,
          target: "$.cart",
        });
      }
      return;
    }

    // Only preorder lines are capped (see the input query). Unmarked lines of a
    // sold-out variant are counted after the order instead (units sold past
    // zero — orders.server.ts), which closes the cap and flips DENY.
    const l = /** @type {any} */ (line);
    const marked =
      (l.preorder && l.preorder.value === "true") ||
      !!(l.sellingPlanAllocation && l.sellingPlanAllocation.sellingPlan);
    if (!marked) return;

    // `remaining` is the aliased metafield from the input query.
    const field = /** @type {any} */ (m).remaining;
    if (!field || field.value == null) return; // not a capped preorder variant

    const remaining = parseInt(field.value, 10);
    if (Number.isNaN(remaining)) return;

    const key = /** @type {any} */ (m).id || `line:${idx}`;
    const name =
      /** @type {any} */ (m).product && /** @type {any} */ (m).product.title
        ? /** @type {any} */ (m).product.title
        : "this item";
    const prev = byVariant.get(key);
    byVariant.set(key, { qty: (prev ? prev.qty : 0) + line.quantity, remaining, name });
  });

  for (const { qty, remaining, name } of byVariant.values()) {
    if (qty > remaining) {
      errors.push({
        message:
          remaining > 0
            ? `Only ${remaining} preorder left for ${name}.`
            : `Preorder for ${name} is sold out.`,
        // JSONPath target. Older API versions use "cart" instead of "$.cart".
        target: "$.cart",
      });
    }
  }

  return {
    operations: errors.length ? [{ validationAdd: { errors } }] : [],
  };
}
