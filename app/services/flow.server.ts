/**
 * Shopify Flow triggers — make Encore a node in merchants' Flow automations.
 *
 * Emits `flowTriggerReceive` for the three Encore events (preorder placed,
 * waitlist signup, restock detected). Best-effort: a Flow emit failure must
 * never break the order/notify/restock path. Payload keys match the
 * `[[settings.fields]]` keys in each trigger extension's shopify.extension.toml.
 *
 * (No ARRS — Encore stays independent. An "emit ARRS event" Flow action can be
 *  added later without touching this.)
 */

import { unauthenticated } from "../shopify.server";

export const FLOW_PREORDER_PLACED = "encore-preorder-placed";
export const FLOW_WAITLIST_SIGNUP = "encore-waitlist-signup";
export const FLOW_RESTOCK_DETECTED = "encore-restock-detected";

// Per-customer triggers (N1) — fire once per affected shopper so a workflow can
// email each of them via the "Send email" action. (preorder confirmation rides
// the per-order FLOW_PREORDER_PLACED instead.)
export const FLOW_BACK_IN_STOCK_READY = "encore-back-in-stock-ready";
export const FLOW_SHIP_DATE_UPDATED = "encore-ship-date-updated";
export const FLOW_BALANCE_DUE = "encore-balance-due";

const TRIGGER = `#graphql
mutation EncoreFlowTrigger($handle: String, $payload: JSON) {
  flowTriggerReceive(handle: $handle, payload: $payload) {
    userErrors { field message }
  }
}`;

// Flow trigger field keys may only contain alphabetic characters and spaces
// (shopify.dev Flow trigger reference). App code keeps its snake_case vars —
// this map translates them at the send boundary so the payload matches the
// keys declared in each extension's shopify.extension.toml.
const FLOW_KEY_RENAMES: Record<string, string> = {
  product_url: "Product URL",
  due_date: "Due date",
  pay_link: "Payment link",
  order_name: "Order name",
  order_id: "Order ID",
  variant_id: "Variant ID",
  ship_date: "Ship date",
  waitlist_count: "Waitlist count",
  old_ship_date: "Old ship date",
  new_ship_date: "New ship date",
  customer_name: "Customer name",
};

function toFlowKeys(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    out[FLOW_KEY_RENAMES[k] ?? k] = v;
  }
  return out;
}

export async function emitFlow(
  shop: string,
  handle: string,
  rawPayload: Record<string, unknown>,
): Promise<void> {
  const payload = toFlowKeys(rawPayload);
  try {
    const { admin } = await unauthenticated.admin(shop);
    const res = await admin.graphql(TRIGGER, { variables: { handle, payload } });
    const body = (await res.json()) as {
      data?: { flowTriggerReceive?: { userErrors?: { message: string }[] } };
    };
    const errs = body.data?.flowTriggerReceive?.userErrors ?? [];
    if (errs.length) {
      // Most common cause: no merchant workflow uses this trigger yet — fine.
      console.log(`[flow] ${handle}: ${errs.map((e) => e.message).join("; ")}`);
    }
  } catch (e) {
    console.error(`[flow] emit ${handle} failed`, e);
  }
}
