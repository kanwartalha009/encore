/**
 * Selling-plan service — Shopify-native deferred purchase options for preorders.
 *
 * Translates an Encore campaign's payment config into a Shopify pre-order
 * Selling Plan (billing/delivery/inventory policies) via sellingPlanGroupCreate
 * /Update, attaches the campaign's products, and stores the resulting GIDs on
 * the Campaign. The plan is what makes deposit / pay-later actually work at
 * checkout: Shopify vaults the card and collects the balance per the policy.
 *
 * Payment-capability detection: deferred charges (deposit, pay-later) require a
 * gateway that supports deferring payment (e.g. Shopify Payments). There's no
 * reliable proactive Admin field for this, so the authoritative check happens at
 * publish time — if Shopify rejects the deferred plan we transparently retry as
 * "pay in full at checkout" and record PAY_NOW_FALLBACK on the campaign.
 *
 * Scope: sellingPlanGroup* mutations need write_products + write_purchase_options.
 */

import prisma from "../db.server";
import { syncVariantCaps } from "./preorder-cap.server";

// Minimal shape of the authenticated Admin GraphQL client (avoids tight coupling
// to the Shopify SDK types).
export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type RawCampaign = {
  id: string;
  shop: string;
  name: string;
  status: string;
  productMode: string;
  productIds: string; // JSON string[]
  paymentMode: string; // PAY_NOW | DEPOSIT | PAY_LATER
  depositKind: string; // PERCENT | FIXED
  depositAmount: number;
  balanceCaptureDays: number;
  discountEnabled: boolean;
  discountKind: string; // PERCENT | FIXED
  discountAmount: number;
  variantConfigs: string; // JSON [{ variantId, unitsOffered, ... }]
  shipDate: Date | null;
  sellingPlanGroupId?: string | null;
  sellingPlanId?: string | null;
  sellingPlanStatus?: string | null;
};

export type SellingPlanSyncResult =
  | { status: "skipped"; reason: string }
  | { status: "deleted" }
  | {
      status: "synced";
      mode: "DEFERRED" | "PAY_NOW";
      fallback: boolean;
      groupId: string;
      planId: string;
      warnings: string[];
    }
  | { status: "error"; errors: string[] };

// ---------- helpers ----------

function parseIds(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

function isoMinusDays(date: Date, days: number): string {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() - (days || 0));
  return d.toISOString();
}

function atNoonUtc(date: Date): string {
  const d = new Date(date.getTime());
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}

// Build the SellingPlanInput fragment from the campaign config. Exported for tests.
export function buildPlan(
  c: RawCampaign,
  opts: { forcePayNow?: boolean; planId?: string },
): { plan: Record<string, unknown>; mode: "DEFERRED" | "PAY_NOW" } {
  const effective = opts.forcePayNow ? "PAY_NOW" : c.paymentMode;

  let checkoutCharge: Record<string, unknown>;
  let remainingBalanceChargeTrigger: string;
  let remainingBalanceChargeExactTime: string | null = null;
  let remainingBalanceChargeTimeAfterCheckout: string | null = null;

  if (effective === "DEPOSIT") {
    checkoutCharge =
      c.depositKind === "FIXED"
        ? { type: "PRICE", value: { fixedValue: c.depositAmount } }
        : { type: "PERCENTAGE", value: { percentage: c.depositAmount } };
    if (c.shipDate) {
      remainingBalanceChargeTrigger = "EXACT_TIME";
      remainingBalanceChargeExactTime = isoMinusDays(c.shipDate, c.balanceCaptureDays);
    } else {
      remainingBalanceChargeTrigger = "TIME_AFTER_CHECKOUT";
      remainingBalanceChargeTimeAfterCheckout = `P${c.balanceCaptureDays || 7}D`;
    }
  } else if (effective === "PAY_LATER") {
    checkoutCharge = { type: "PERCENTAGE", value: { percentage: 0 } };
    if (c.shipDate) {
      remainingBalanceChargeTrigger = "EXACT_TIME";
      remainingBalanceChargeExactTime = c.shipDate.toISOString();
    } else {
      remainingBalanceChargeTrigger = "TIME_AFTER_CHECKOUT";
      remainingBalanceChargeTimeAfterCheckout = "P30D";
    }
  } else {
    // PAY_NOW — full amount at checkout, ship later.
    checkoutCharge = { type: "PERCENTAGE", value: { percentage: 100 } };
    remainingBalanceChargeTrigger = "NO_REMAINING_BALANCE";
  }

  // A balance date already in the past (ship date close, or passed) is
  // rejected by Shopify, which used to make the whole plan silently fall back
  // to pay-in-full. Charge the balance one day after checkout instead.
  if (
    remainingBalanceChargeExactTime &&
    Date.parse(remainingBalanceChargeExactTime) <= Date.now() + 60 * 60 * 1000
  ) {
    remainingBalanceChargeTrigger = "TIME_AFTER_CHECKOUT";
    remainingBalanceChargeExactTime = null;
    remainingBalanceChargeTimeAfterCheckout = "P1D";
  }

  const fixedBilling: Record<string, unknown> = {
    checkoutCharge,
    remainingBalanceChargeTrigger,
  };
  if (remainingBalanceChargeExactTime)
    fixedBilling.remainingBalanceChargeExactTime = remainingBalanceChargeExactTime;
  if (remainingBalanceChargeTimeAfterCheckout)
    fixedBilling.remainingBalanceChargeTimeAfterCheckout =
      remainingBalanceChargeTimeAfterCheckout;

  // Delivery policy: when the campaign has a future ship date we pass it as
  // EXACT_TIME so Shopify's fulfillment hold on the order reads the real date
  // (and releases automatically on it) instead of "Unknown delivery date"
  // (observed on order #1017, 2026-09-24). A missing or past date falls back
  // to UNKNOWN — Shopify rejects an exact time that is not in the future.
  // The date is stored at 00:00 UTC; we send it at 12:00 UTC so the admin
  // shows the same calendar day in every store timezone (a US store showed
  // "29 September" for a 30 September ship date at midnight UTC).
  const deliveryPolicy: Record<string, unknown> =
    c.shipDate && c.shipDate.getTime() > Date.now()
      ? { fixed: { fulfillmentTrigger: "EXACT_TIME", fulfillmentExactTime: atNoonUtc(c.shipDate) } }
      : { fixed: { fulfillmentTrigger: "UNKNOWN" } };

  const plan: Record<string, unknown> = {
    name: `${c.name} — preorder`,
    category: "PRE_ORDER",
    options: "Preorder",
    billingPolicy: { fixed: fixedBilling },
    deliveryPolicy,
    inventoryPolicy: { reserve: "ON_FULFILLMENT" },
  };
  if (opts.planId) plan.id = opts.planId;

  // Optional preorder discount. Percentage, or a fixed amount off each unit in
  // the shop's currency (the form offered "Fixed amount" but it was silently
  // skipped until 2026-09-28). On update with the discount switched off we send
  // an empty list so the old discount is removed (see syncSellingPlanOnly).
  if (c.discountEnabled && c.discountAmount > 0) {
    plan.pricingPolicies = [
      c.discountKind === "FIXED"
        ? {
            fixed: {
              adjustmentType: "FIXED_AMOUNT",
              adjustmentValue: { fixedValue: String(c.discountAmount) },
            },
          }
        : {
            fixed: {
              adjustmentType: "PERCENTAGE",
              adjustmentValue: { percentage: c.discountAmount },
            },
          },
    ];
  } else if (opts.planId) {
    plan.pricingPolicies = [];
  }

  return { plan, mode: effective === "PAY_NOW" ? "PAY_NOW" : "DEFERRED" };
}

async function gql(
  admin: AdminGraphqlClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await admin.graphql(query, { variables });
  const body = (await res.json()) as { data?: Record<string, unknown> };
  return body.data ?? {};
}

function looksLikeDeferredUnsupported(messages: string[]): boolean {
  const hay = messages.join(" ").toLowerCase();
  return (
    hay.includes("deferred") ||
    hay.includes("payment") ||
    hay.includes("checkout charge") ||
    hay.includes("remaining balance") ||
    hay.includes("not supported") ||
    hay.includes("not eligible")
  );
}

async function persist(
  id: string,
  data: { sellingPlanGroupId?: string | null; sellingPlanId?: string | null; sellingPlanStatus?: string },
): Promise<void> {
  await (
    prisma as unknown as {
      campaign: { update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown> };
    }
  ).campaign.update({ where: { id }, data });
}

// ---------- GraphQL ops ----------

const CREATE = `#graphql
mutation EncoreSPCreate($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput!) {
  sellingPlanGroupCreate(input: $input, resources: $resources) {
    sellingPlanGroup { id sellingPlans(first: 1) { edges { node { id } } } }
    userErrors { field message }
  }
}`;

const UPDATE = `#graphql
mutation EncoreSPUpdate($id: ID!, $input: SellingPlanGroupInput!) {
  sellingPlanGroupUpdate(id: $id, input: $input) {
    sellingPlanGroup { id sellingPlans(first: 1) { edges { node { id } } } }
    userErrors { field message }
  }
}`;

const GROUP_PRODUCTS = `#graphql
query EncoreSPProducts($id: ID!) {
  sellingPlanGroup(id: $id) { products(first: 100) { edges { node { id } } } }
}`;

const ADD_PRODUCTS = `#graphql
mutation EncoreSPAdd($id: ID!, $productIds: [ID!]!) {
  sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
    sellingPlanGroup { id }
    userErrors { field message }
  }
}`;

const REMOVE_PRODUCTS = `#graphql
mutation EncoreSPRemove($id: ID!, $productIds: [ID!]!) {
  sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
    removedProductIds
    userErrors { field message }
  }
}`;

const DELETE = `#graphql
mutation EncoreSPDelete($id: ID!) {
  sellingPlanGroupDelete(id: $id) { deletedSellingPlanGroupId userErrors { field message } }
}`;

// ---------- public API ----------

/**
 * Best-effort capability note. Deferred eligibility isn't reliably exposed as a
 * proactive Admin field, so this confirms Admin connectivity and explains that
 * the authoritative check (with automatic pay-now fallback) runs at publish.
 */
export async function detectPaymentCapability(
  admin: AdminGraphqlClient,
): Promise<{ ok: boolean; deferred: "unknown"; message: string }> {
  try {
    await gql(admin, `#graphql query EncoreShop { shop { id } }`, {});
    return {
      ok: true,
      deferred: "unknown",
      message:
        "Pay-in-full preorders work on any gateway. Deposit and pay-later need a gateway that can defer payment (e.g. Shopify Payments) — Encore checks this when you publish and falls back to charging in full if it isn't supported.",
    };
  } catch {
    return { ok: false, deferred: "unknown", message: "Could not reach the Shopify Admin API." };
  }
}

/**
 * Create/update the campaign's pre-order selling plan and reconcile its products,
 * then bring the checkout cap metafields in line with the campaign's current
 * status and variants. Idempotent: safe to call on every create/publish/update/
 * status change. Removes the plan when the campaign is no longer eligible.
 *
 * The cap sync used to run only on the "existing plan → update" path, so a
 * brand-new preorder had no checkout cap until it was edited once (audit
 * 2026-09-28). It now runs after every outcome, including teardown (caps are
 * cleared for variants no active campaign covers).
 */
export async function syncCampaignSellingPlan(
  admin: AdminGraphqlClient,
  shop: string,
  campaignId: string,
  opts: { removedVariantGids?: string[] } = {},
): Promise<SellingPlanSyncResult> {
  const result = await syncSellingPlanOnly(admin, shop, campaignId);
  const row = await prisma.campaign.findFirst({
    where: { shop, id: campaignId },
    select: { id: true, variantConfigs: true },
  });
  if (row) {
    await syncVariantCaps(admin, shop, row, opts.removedVariantGids ?? []).catch((e) =>
      console.error("variant cap sync failed", e),
    );
  }
  return result;
}

async function syncSellingPlanOnly(
  admin: AdminGraphqlClient,
  shop: string,
  campaignId: string,
): Promise<SellingPlanSyncResult> {
  const row = await prisma.campaign.findFirst({ where: { shop, id: campaignId } });
  if (!row) return { status: "skipped", reason: "campaign_not_found" };
  const c = row as unknown as RawCampaign;

  const eligible =
    (c.status === "LIVE" || c.status === "SCHEDULED") &&
    c.productMode === "SPECIFIC" &&
    parseIds(c.productIds).length > 0;

  // Not eligible → tear down any existing plan so we don't leave a stale one.
  if (!eligible) {
    if (c.sellingPlanGroupId) {
      await deleteCampaignSellingPlan(admin, shop, campaignId);
      return { status: "deleted" };
    }
    return { status: "skipped", reason: "not_eligible" };
  }

  const productIds = parseIds(c.productIds);

  async function createGroup(forcePayNow: boolean) {
    const { plan, mode } = buildPlan(c, { forcePayNow });
    const data = await gql(admin, CREATE, {
      input: {
        name: c.name,
        merchantCode: `encore-${c.id}`,
        options: ["Preorder"],
        position: 1,
        sellingPlansToCreate: [plan],
      },
      resources: { productIds },
    });
    const payload = (data.sellingPlanGroupCreate ?? {}) as {
      sellingPlanGroup?: { id: string; sellingPlans?: { edges: { node: { id: string } }[] } };
      userErrors?: { message: string }[];
    };
    return { payload, mode };
  }

  // ---- existing group → update policies + reconcile products ----
  if (c.sellingPlanGroupId && c.sellingPlanId) {
    const { plan, mode } = buildPlan(c, { planId: c.sellingPlanId });
    const update = async (p: Record<string, unknown>) => {
      const data = await gql(admin, UPDATE, {
        id: c.sellingPlanGroupId,
        input: { name: c.name, sellingPlansToUpdate: [p] },
      });
      const payload = (data.sellingPlanGroupUpdate ?? {}) as {
        userErrors?: { message: string }[];
      };
      return (payload.userErrors ?? []).map((e) => e.message);
    };
    let errs = await update(plan);
    // If the API refuses an empty pricing-policy list (removing a discount),
    // don't let that block the rest of the update — retry without it.
    if (errs.length && Array.isArray(plan.pricingPolicies) && (plan.pricingPolicies as unknown[]).length === 0) {
      const rest = { ...plan };
      delete rest.pricingPolicies;
      console.warn("[selling-plan] could not clear pricing policies:", errs);
      errs = await update(rest);
    }
    if (errs.length) return { status: "error", errors: errs };

    await reconcileProducts(admin, c.sellingPlanGroupId, productIds);
    await persist(c.id, { sellingPlanStatus: mode });
    return {
      status: "synced",
      mode,
      fallback: false,
      groupId: c.sellingPlanGroupId,
      planId: c.sellingPlanId,
      warnings: [],
    };
  }

  // ---- no group yet → create (with deferred → pay-now fallback) ----
  let { payload, mode } = await createGroup(false);
  let warnings: string[] = [];
  let fallback = false;
  let errs = (payload.userErrors ?? []).map((e) => e.message);

  if (errs.length && mode === "DEFERRED" && looksLikeDeferredUnsupported(errs)) {
    warnings = errs;
    fallback = true;
    ({ payload, mode } = await createGroup(true));
    errs = (payload.userErrors ?? []).map((e) => e.message);
  }
  if (errs.length || !payload.sellingPlanGroup) {
    return { status: "error", errors: errs.length ? errs : ["selling_plan_create_failed"] };
  }

  const groupId = payload.sellingPlanGroup.id;
  const planId = payload.sellingPlanGroup.sellingPlans?.edges?.[0]?.node?.id ?? "";
  const status = fallback ? "PAY_NOW_FALLBACK" : mode;
  await persist(c.id, { sellingPlanGroupId: groupId, sellingPlanId: planId, sellingPlanStatus: status });

  return { status: "synced", mode, fallback, groupId, planId, warnings };
}

async function reconcileProducts(
  admin: AdminGraphqlClient,
  groupId: string,
  desired: string[],
): Promise<void> {
  const data = await gql(admin, GROUP_PRODUCTS, { id: groupId });
  const group = (data.sellingPlanGroup ?? {}) as {
    products?: { edges: { node: { id: string } }[] };
  };
  const current = (group.products?.edges ?? []).map((e) => e.node.id);

  const toAdd = desired.filter((id) => !current.includes(id));
  const toRemove = current.filter((id) => !desired.includes(id));

  if (toAdd.length) await gql(admin, ADD_PRODUCTS, { id: groupId, productIds: toAdd });
  if (toRemove.length) await gql(admin, REMOVE_PRODUCTS, { id: groupId, productIds: toRemove });
}

/** Delete the campaign's selling plan group and clear the stored GIDs. */
export async function deleteCampaignSellingPlan(
  admin: AdminGraphqlClient,
  shop: string,
  campaignId: string,
): Promise<void> {
  const row = await prisma.campaign.findFirst({ where: { shop, id: campaignId } });
  if (!row) return;
  const c = row as unknown as RawCampaign;
  if (!c.sellingPlanGroupId) return;
  try {
    await gql(admin, DELETE, { id: c.sellingPlanGroupId });
  } catch {
    // best-effort — clear refs regardless so we don't get stuck.
  }
  await persist(campaignId, {
    sellingPlanGroupId: null,
    sellingPlanId: null,
    sellingPlanStatus: "NONE",
  });
}
