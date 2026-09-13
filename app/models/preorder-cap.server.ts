/**
 * Preorder cap metafields — the data the checkout-validation Function reads.
 *
 * A Shopify Function runs in a sandbox with no DB/network access, so the cap has
 * to live where the Function can see it: a per-variant metafield. This module
 * keeps `encore.preorder_remaining` (and `encore.preorder_cap`) in sync:
 *   - on selling-plan sync: remaining = unitsOffered − units already sold
 *   - on orders/create:     decrement remaining for the bought variants
 *
 * The Function (`extensions/encore-preorder-cap`) blocks checkout when a
 * preorder line's quantity exceeds `preorder_remaining` — the hard, race-tighter
 * guarantee on top of the offer-level hide in `capacity.server.ts`.
 *
 * Scope: writing variant metafields needs `write_products` (already granted).
 */

import prisma from "../db.server";

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type VariantConfig = { variantId?: string; unitsOffered?: number | null };

const numId = (g?: string | null): string =>
  g ? String(g).split("/").pop() || "" : "";
const toVariantGid = (v: string): string =>
  v.startsWith("gid://") ? v : `gid://shopify/ProductVariant/${numId(v)}`;

// PreOrder.variantId is added via db push — reach aggregate through a cast.
const preOrder = (
  prisma as unknown as {
    preOrder: {
      aggregate(a: {
        where: Record<string, unknown>;
        _sum: { units: true };
      }): Promise<{ _sum: { units: number | null } }>;
    };
  }
).preOrder;

async function gql(
  admin: AdminGraphqlClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<void> {
  await admin.graphql(query, { variables });
}

async function gqlData<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await admin.graphql(query, { variables });
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
  return (body.data ?? {}) as T;
}

async function soldForVariant(
  shop: string,
  campaignId: string,
  variantGid: string,
): Promise<number> {
  const n = numId(variantGid);
  const agg = await preOrder.aggregate({
    where: {
      shop,
      campaignId,
      variantId: { in: [variantGid, `gid://shopify/ProductVariant/${n}`, n] },
    },
    _sum: { units: true },
  });
  return agg._sum.units ?? 0;
}

const DEF_CREATE = `#graphql
mutation EncoreCapDef($def: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $def) {
    createdDefinition { id }
    userErrors { code message }
  }
}`;

const MF_SET = `#graphql
mutation EncoreCapSet($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { userErrors { field message } }
}`;

/**
 * Idempotently create the two variant metafield definitions so the Function can
 * read them (and they show in the admin). "TAKEN" errors are ignored.
 */
export async function ensureCapDefinitions(admin: AdminGraphqlClient): Promise<void> {
  const defs = [
    { key: "preorder_remaining", name: "Encore preorder remaining" },
    { key: "preorder_cap", name: "Encore preorder cap" },
  ];
  for (const d of defs) {
    try {
      await gql(admin, DEF_CREATE, {
        def: {
          name: d.name,
          namespace: "encore",
          key: d.key,
          ownerType: "PRODUCTVARIANT",
          type: "number_integer",
          access: { admin: "MERCHANT_READ_WRITE" },
        },
      });
    } catch {
      /* already exists / transient — ignore */
    }
  }
}

const VALIDATIONS_Q = `#graphql
query EncoreCapValidations {
  validations(first: 25) {
    nodes { id title enabled shopifyFunction { id app { handle } } }
  }
}`;

const VALIDATION_CREATE = `#graphql
mutation EncoreCapValidationCreate($validation: ValidationCreateInput!) {
  validationCreate(validation: $validation) {
    validation { id enabled }
    userErrors { field message }
  }
}`;

const VALIDATION_UPDATE = `#graphql
mutation EncoreCapValidationEnable($id: ID!, $validation: ValidationUpdateInput!) {
  validationUpdate(id: $id, validation: $validation) {
    validation { id enabled }
    userErrors { field message }
  }
}`;

export const CAP_FUNCTION_HANDLE = "encore-preorder-cap";
const CAP_VALIDATION_TITLE = "Encore preorder cap";

/**
 * A deployed Cart & Checkout Validation Function does NOTHING until a
 * Validation object is created for it (validationCreate — needs the
 * write_validations scope). Idempotent: reuses the existing validation
 * (re-enabling it if a merchant switched it off by mistake), creates it
 * otherwise. blockOnFailure=false: a Function runtime error must never lock
 * a merchant's checkout — the offer-level cap + DENY policy still apply.
 * Best-effort: never throws.
 */
export async function ensureCapValidation(
  admin: AdminGraphqlClient,
): Promise<{ status: "exists" | "created" | "enabled" | "error"; detail?: string }> {
  try {
    const q = await gqlData<{
      validations?: { nodes?: { id: string; title: string; enabled: boolean; shopifyFunction?: { app?: { handle?: string } } }[] };
    }>(admin, VALIDATIONS_Q, {});
    const mine = (q.validations?.nodes ?? []).find(
      (v) => v.title === CAP_VALIDATION_TITLE || v.shopifyFunction?.app?.handle === "encore",
    );
    if (mine) {
      if (mine.enabled) return { status: "exists" };
      const u = await gqlData<{ validationUpdate?: { userErrors?: { message: string }[] } }>(
        admin, VALIDATION_UPDATE, { id: mine.id, validation: { enable: true } },
      );
      const errs = u.validationUpdate?.userErrors ?? [];
      return errs.length ? { status: "error", detail: errs.map((e) => e.message).join("; ") } : { status: "enabled" };
    }
    const c = await gqlData<{ validationCreate?: { userErrors?: { message: string }[] } }>(admin, VALIDATION_CREATE, {
      validation: { functionHandle: CAP_FUNCTION_HANDLE, title: CAP_VALIDATION_TITLE, enable: true, blockOnFailure: false },
    });
    const errs = c.validationCreate?.userErrors ?? [];
    if (errs.length) {
      console.error("[preorder-cap] validationCreate:", errs);
      return { status: "error", detail: errs.map((e) => e.message).join("; ") };
    }
    console.log("[preorder-cap] checkout validation created + enabled");
    return { status: "created" };
  } catch (e) {
    console.error("[preorder-cap] ensureCapValidation failed", e);
    return { status: "error", detail: String((e as Error)?.message ?? e) };
  }
}

/** Write remaining + cap for every capped variant in the campaign. */
export async function syncVariantCaps(
  admin: AdminGraphqlClient,
  shop: string,
  campaign: { id: string; variantConfigs: string },
): Promise<void> {
  let cfgs: VariantConfig[] = [];
  try {
    cfgs = JSON.parse(campaign.variantConfigs) as VariantConfig[];
  } catch {
    return;
  }

  const metafields: Record<string, unknown>[] = [];
  for (const vc of cfgs) {
    if (!vc.variantId || typeof vc.unitsOffered !== "number" || vc.unitsOffered <= 0) {
      continue;
    }
    const gid = toVariantGid(vc.variantId);
    const sold = await soldForVariant(shop, campaign.id, gid);
    const remaining = Math.max(0, vc.unitsOffered - sold);
    metafields.push(
      { ownerId: gid, namespace: "encore", key: "preorder_cap", type: "number_integer", value: String(vc.unitsOffered) },
      { ownerId: gid, namespace: "encore", key: "preorder_remaining", type: "number_integer", value: String(remaining) },
    );
  }
  if (metafields.length) {
    await ensureCapDefinitions(admin);
    await ensureCapValidation(admin);
    await gql(admin, MF_SET, { metafields });
  }
}

/** Recompute `preorder_remaining` for specific variants (after an order). */
export async function refreshVariantRemaining(
  admin: AdminGraphqlClient,
  shop: string,
  campaign: { id: string; variantConfigs: string },
  variantGids: string[],
): Promise<void> {
  let cfgs: VariantConfig[] = [];
  try {
    cfgs = JSON.parse(campaign.variantConfigs) as VariantConfig[];
  } catch {
    return;
  }
  const capByVariant = new Map<string, number>();
  for (const c of cfgs) {
    if (c.variantId && typeof c.unitsOffered === "number") {
      capByVariant.set(numId(c.variantId), c.unitsOffered);
    }
  }

  const metafields: Record<string, unknown>[] = [];
  for (const gid of variantGids) {
    const cap = capByVariant.get(numId(gid));
    if (cap == null) continue;
    const sold = await soldForVariant(shop, campaign.id, gid);
    metafields.push({
      ownerId: gid,
      namespace: "encore",
      key: "preorder_remaining",
      type: "number_integer",
      value: String(Math.max(0, cap - sold)),
    });
  }
  if (metafields.length) await gql(admin, MF_SET, { metafields });
}
