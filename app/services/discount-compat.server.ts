/**
 * Discount-compatibility verification (Phase 2 gate §3.2.2).
 *
 * Pre-orders run as selling-plan (deferred purchase) line items. Most discounts
 * apply to them like a normal one-time purchase, but **Buy-X-Get-Y** is the known
 * exception — Shopify doesn't apply BXGY to selling-plan lines. This check pulls
 * the shop's active automatic + code discounts and flags each as OK / REVIEW /
 * CONFLICT so the merchant can verify before launch.
 *
 * Scope: requires `read_discounts`.
 */

export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type DiscountStatus = "OK" | "REVIEW" | "CONFLICT";
export type DiscountCompatRow = {
  id: string;
  title: string;
  kind: string;
  status: DiscountStatus;
  note: string;
};

const AUTO_QUERY = `#graphql
query EncoreAutoDiscounts {
  automaticDiscountNodes(first: 50, query: "status:active") {
    nodes {
      id
      automaticDiscount {
        __typename
        ... on DiscountAutomaticBasic { title }
        ... on DiscountAutomaticBxgy { title }
        ... on DiscountAutomaticFreeShipping { title }
        ... on DiscountAutomaticApp { title }
      }
    }
  }
}`;

const CODE_QUERY = `#graphql
query EncoreCodeDiscounts {
  codeDiscountNodes(first: 50, query: "status:active") {
    nodes {
      id
      codeDiscount {
        __typename
        ... on DiscountCodeBasic { title }
        ... on DiscountCodeBxgy { title }
        ... on DiscountCodeFreeShipping { title }
        ... on DiscountCodeApp { title }
      }
    }
  }
}`;

function classify(typename: string): { kind: string; status: DiscountStatus; note: string } {
  if (typename.includes("Bxgy")) {
    return {
      kind: "Buy X Get Y",
      status: "CONFLICT",
      note: "Buy-X-Get-Y isn't applied to pre-order (selling-plan) lines by Shopify. Exclude pre-order products, or run BXGY on in-stock items only.",
    };
  }
  if (typename.includes("App")) {
    return {
      kind: "App / Function discount",
      status: "REVIEW",
      note: "Third-party or Function discount — confirm it targets one-time purchases so it reaches pre-order lines.",
    };
  }
  if (typename.includes("FreeShipping")) {
    return {
      kind: "Free shipping",
      status: "OK",
      note: "Shipping discounts apply to pre-order orders normally.",
    };
  }
  return {
    kind: "Amount / percentage",
    status: "OK",
    note: "Applies to pre-order lines like a normal one-time purchase.",
  };
}

type DiscountNode = { id: string; [k: string]: unknown };

export async function checkDiscountCompatibility(
  admin: AdminGraphqlClient,
): Promise<{ rows: DiscountCompatRow[]; checkedAt: string; error?: string }> {
  const rows: DiscountCompatRow[] = [];
  let error: string | undefined;

  async function run(query: string, key: string, subkey: string): Promise<void> {
    try {
      const res = await admin.graphql(query, {});
      const body = (await res.json()) as {
        data?: Record<string, { nodes?: DiscountNode[] }>;
        errors?: { message: string }[];
      };
      if (body.errors?.length) {
        error = body.errors[0].message;
        return;
      }
      for (const n of body.data?.[key]?.nodes ?? []) {
        const d = n[subkey] as { __typename?: string; title?: string } | undefined;
        if (!d) continue;
        const c = classify(d.__typename ?? "");
        rows.push({ id: n.id, title: d.title || "(untitled)", kind: c.kind, status: c.status, note: c.note });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  await run(AUTO_QUERY, "automaticDiscountNodes", "automaticDiscount");
  await run(CODE_QUERY, "codeDiscountNodes", "codeDiscount");

  // CONFLICT first, then REVIEW, then OK.
  const rank: Record<DiscountStatus, number> = { CONFLICT: 0, REVIEW: 1, OK: 2 };
  rows.sort((a, b) => rank[a.status] - rank[b.status]);

  return { rows, checkedAt: new Date().toISOString(), error };
}
