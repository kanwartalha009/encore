/**
 * Live collection list for the campaign "Specific collection" scope picker.
 * Reads the store's real Custom + Smart collections via the Admin API. Returns []
 * on any failure so the caller can fall back to demo data without throwing.
 */
import type { AdminGraphqlClient } from "./markets.server";

export type CollectionRow = { id: string; title: string; count: number };

const COLLECTIONS_QUERY = `#graphql
  query EncoreCollections {
    collections(first: 100, sortKey: TITLE) {
      edges {
        node {
          id
          title
          productsCount { count }
        }
      }
    }
  }`;

export async function listCollections(
  admin: AdminGraphqlClient | null | undefined,
): Promise<CollectionRow[]> {
  if (!admin) return [];
  try {
    const res = await admin.graphql(COLLECTIONS_QUERY);
    const body = (await res.json()) as {
      data?: {
        collections?: {
          edges: { node: { id: string; title: string; productsCount?: { count?: number } | number } }[];
        };
      };
    };
    const edges = body.data?.collections?.edges ?? [];
    return edges.map((e) => {
      const pc = e.node.productsCount;
      const count = typeof pc === "number" ? pc : (pc?.count ?? 0);
      return { id: e.node.id, title: e.node.title, count };
    });
  } catch (err) {
    console.error("[encore] listCollections failed", err);
    return [];
  }
}
