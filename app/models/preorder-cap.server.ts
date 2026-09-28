/**
 * Preorder cap metafields — the data the checkout-validation Function reads.
 *
 * A Shopify Function runs in a sandbox with no DB/network access, so the cap has
 * to live where the Function can see it: a per-variant metafield. This module
 * keeps `encore.preorder_remaining` (and `encore.preorder_cap`) in sync.
 *
 * Since 2026-09-28 every write goes through `recomputeVariantCaps`, which works
 * per VARIANT rather than per campaign:
 *   - cap       = tightest effective cap (Limit / End quantity) across every
 *                 LIVE or SCHEDULED campaign covering the variant
 *   - remaining = tightest (cap − units still held) across those campaigns;
 *                 cancelled / refunded orders no longer hold units
 *   - no active campaign caps the variant any more (ended, paused, deleted,
 *     variant removed) → both metafields are DELETED.
 * The Function itself only caps PREORDER lines (marked `_preorder` or bought
 * with a selling plan), so ordinary in-stock purchases of a capped variant are
 * never blocked, even while its campaign is live.
 * It runs on every selling-plan sync (create, edit, status change), after each
 * order, after a cancellation and when a campaign ends on its end date.
 *
 * The Function (`extensions/encore-preorder-cap`) blocks checkout when a
 * preorder line's quantity exceeds `preorder_remaining` — the hard, race-tighter
 * guarantee on top of the offer-level hide in `capacity.server.ts`.
 *
 * Scope: writing variant metafields needs `write_products` (already granted).
 */

import prisma from "../db.server";
import {
  combineVariantCaps,
  effectiveVariantCap,
  RELEASED_PAYMENT_STATUSES,
  type VariantCapConfig,
} from "../lib/cap-shared";

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type VariantConfig = VariantCapConfig;

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
      paymentStatus: { notIn: [...RELEASED_PAYMENT_STATUSES] },
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

const MF_DELETE = `#graphql
mutation EncoreCapDelete($metafields: [MetafieldIdentifierInput!]!) {
  metafieldsDelete(metafields: $metafields) { userErrors { field message } }
}`;

/** metafieldsSet / metafieldsDelete accept at most 25 entries per call. */
async function inChunks(
  admin: AdminGraphqlClient,
  mutation: string,
  items: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < items.length; i += 25) {
    await gql(admin, mutation, { metafields: items.slice(i, i + 25) });
  }
}

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

function variantGidsOf(variantConfigs: string): string[] {
  try {
    const cfgs = JSON.parse(variantConfigs) as VariantConfig[];
    return cfgs.map((c) => c.variantId).filter((v): v is string => !!v).map(toVariantGid);
  } catch {
    return [];
  }
}

/**
 * Recompute both metafields for the given variants from every active campaign
 * in the shop (see header). Deletes them for variants no active campaign caps.
 */
export async function recomputeVariantCaps(
  admin: AdminGraphqlClient,
  shop: string,
  variantGids: string[],
): Promise<{ set: number; cleared: number }> {
  const targets = Array.from(new Set(variantGids.map(toVariantGid)));
  if (!targets.length) return { set: 0, cleared: 0 };

  const active = await prisma.campaign.findMany({
    where: { shop, status: { in: ["LIVE", "SCHEDULED"] }, productMode: "SPECIFIC" },
    select: { id: true, variantConfigs: true },
  });
  const parsed = active.map((c) => {
    let cfgs: VariantConfig[] = [];
    try {
      cfgs = JSON.parse(c.variantConfigs) as VariantConfig[];
    } catch {
      cfgs = [];
    }
    return { id: c.id, cfgs };
  });

  const sets: Record<string, unknown>[] = [];
  const deletes: Record<string, unknown>[] = [];
  for (const gid of targets) {
    const n = numId(gid);
    const entries: { cap: number; sold: number }[] = [];
    for (const c of parsed) {
      const cap = effectiveVariantCap(c.cfgs.find((vc) => numId(vc.variantId) === n));
      if (cap == null) continue;
      entries.push({ cap, sold: await soldForVariant(shop, c.id, gid) });
    }
    const combined = combineVariantCaps(entries);
    if (combined) {
      sets.push(
        { ownerId: gid, namespace: "encore", key: "preorder_cap", type: "number_integer", value: String(combined.cap) },
        { ownerId: gid, namespace: "encore", key: "preorder_remaining", type: "number_integer", value: String(combined.remaining) },
      );
    } else {
      deletes.push(
        { ownerId: gid, namespace: "encore", key: "preorder_cap" },
        { ownerId: gid, namespace: "encore", key: "preorder_remaining" },
      );
    }
  }
  if (sets.length) {
    await ensureCapDefinitions(admin);
    await ensureCapValidation(admin);
    await inChunks(admin, MF_SET, sets);
  }
  if (deletes.length) await inChunks(admin, MF_DELETE, deletes);
  return { set: sets.length / 2, cleared: deletes.length / 2 };
}

/**
 * Sync the caps for every variant a campaign covers (plus any variants that
 * were just removed from it, so their stale caps are cleared).
 */
export async function syncVariantCaps(
  admin: AdminGraphqlClient,
  shop: string,
  campaign: { id: string; variantConfigs: string },
  alsoVariantGids: string[] = [],
): Promise<void> {
  await recomputeVariantCaps(admin, shop, [...variantGidsOf(campaign.variantConfigs), ...alsoVariantGids]);
}

/** Recompute `preorder_remaining` for specific variants (after an order or a cancel). */
export async function refreshVariantRemaining(
  admin: AdminGraphqlClient,
  shop: string,
  _campaign: { id: string; variantConfigs: string },
  variantGids: string[],
): Promise<void> {
  await recomputeVariantCaps(admin, shop, variantGids);
}

export { variantGidsOf };
