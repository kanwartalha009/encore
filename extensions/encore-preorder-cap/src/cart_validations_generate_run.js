// @ts-check
//
// Cart & Checkout Validation Function — Encore hard no-oversell guard.
// Blocks checkout when a preorder line's quantity exceeds the variant's
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

  for (const line of input.cart.lines) {
    const m = line.merchandise;
    if (!m || m.__typename !== "ProductVariant") continue;

    // `remaining` is the aliased metafield from the input query.
    const field = /** @type {any} */ (m).remaining;
    if (!field || field.value == null) continue; // not a capped preorder variant

    const remaining = parseInt(field.value, 10);
    if (Number.isNaN(remaining)) continue;

    if (line.quantity > remaining) {
      const name =
        /** @type {any} */ (m).product && /** @type {any} */ (m).product.title
          ? /** @type {any} */ (m).product.title
          : "this item";
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
