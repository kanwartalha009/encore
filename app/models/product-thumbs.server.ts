/**
 * Product thumbnails for admin lists (2026-09-25).
 *
 * Encore stores product ids and titles, not images. Every Shopify admin list
 * shows a product thumbnail, and without one our rows read as a wall of
 * identical cart icons. One `nodes(ids:)` call resolves the featured image for
 * up to 50 products at a small, admin-sized rendition.
 *
 * Best-effort by design: any API failure returns {} and the UI falls back to
 * the icon tile, so a thumbnail can never break a page render.
 */
import type { AdminGraphqlClient } from "./markets.server";

const THUMBS_QUERY = `#graphql
  query EncoreProductThumbs($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 96, maxHeight: 96 })
            }
          }
        }
      }
    }
  }`;

export type ThumbMap = Record<string, string>;

export async function getProductThumbs(
  admin: AdminGraphqlClient | null | undefined,
  productIds: string[],
): Promise<ThumbMap> {
  const ids = Array.from(new Set(productIds.filter((id) => id.startsWith("gid://shopify/Product/")))).slice(0, 50);
  if (!admin || ids.length === 0) return {};
  try {
    const res = await admin.graphql(THUMBS_QUERY, { variables: { ids } });
    const body = (await res.json()) as {
      data?: {
        nodes?: ({ id?: string; featuredMedia?: { preview?: { image?: { url?: string } | null } | null } | null } | null)[];
      };
    };
    const out: ThumbMap = {};
    for (const n of body.data?.nodes ?? []) {
      const url = n?.featuredMedia?.preview?.image?.url;
      if (n?.id && url) out[n.id] = url;
    }
    return out;
  } catch (err) {
    console.error("[encore] product thumbnails lookup failed", err);
    return {};
  }
}

/** Parse the JSON-encoded productIds column without throwing. */
export function parseProductIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string");
  if (typeof raw !== "string") return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
