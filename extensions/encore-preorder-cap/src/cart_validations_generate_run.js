// @ts-check
//
// Cart & Checkout Validation Function — Encore hard no-oversell guard.
// Blocks checkout when the quantity of a preorder variant on PREORDER lines
// (marked `_preorder` or bought with a selling plan; summed across cart lines)
// exceeds the variant's
// `encore.preorder_remaining` metafield (kept current by the app). Variants
// without that metafield aren't capped, so they're ignored.
//
// Runs in the Shopify Functions sandbox (no DB / network) — all data comes from
// the input query in cart_validations_generate_run.graphql.

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
  input.cart.lines.forEach((line, idx) => {
    const m = line.merchandise;
    if (!m || m.__typename !== "ProductVariant") return;

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
