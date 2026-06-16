/**
 * Curated demo product catalog.
 *
 * Used in three places that need to agree:
 *   - prisma/seed.ts                  (seeds preorders against these variants)
 *   - app/components/CampaignForm.tsx (the variant picker)
 *   - app/models/campaign.server.ts   (dbToFormValues resolves titles)
 *
 * Preorders are configured at the **variant** level — each row in
 * variantConfigs points at one variant and carries its own unit allowance.
 */

export type DemoVariant = {
  id: string;
  title: string;
  priceCents: number;
};

export type DemoProduct = {
  id: string;
  title: string;
  vendor: string;
  variants: DemoVariant[];
};

const v = (id: string, title: string, priceCents: number): DemoVariant => ({
  id,
  title,
  priceCents,
});

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    id: "gid://shopify/Product/1001",
    title: "Aurora Hoodie — Indigo",
    vendor: "Northwind",
    variants: [
      v("gid://shopify/ProductVariant/100101", "Indigo / S", 5400),
      v("gid://shopify/ProductVariant/100102", "Indigo / M", 5400),
      v("gid://shopify/ProductVariant/100103", "Indigo / L", 5400),
      v("gid://shopify/ProductVariant/100104", "Indigo / XL", 5400),
      v("gid://shopify/ProductVariant/100105", "Black / M", 5400),
      v("gid://shopify/ProductVariant/100106", "Black / L", 5400),
    ],
  },
  {
    id: "gid://shopify/Product/1002",
    title: "Halcyon Tee — Sand",
    vendor: "Halcyon",
    variants: [
      v("gid://shopify/ProductVariant/100201", "Sand / S", 5200),
      v("gid://shopify/ProductVariant/100202", "Sand / M", 5200),
      v("gid://shopify/ProductVariant/100203", "Sand / L", 5200),
    ],
  },
  {
    id: "gid://shopify/Product/1003",
    title: "Field Kit v2 — Charcoal",
    vendor: "Atlas Goods",
    variants: [v("gid://shopify/ProductVariant/100301", "Charcoal", 5950)],
  },
  {
    id: "gid://shopify/Product/1004",
    title: "Limited Bundle — Spring",
    vendor: "Northwind",
    variants: [v("gid://shopify/ProductVariant/100401", "One size", 5100)],
  },
  {
    id: "gid://shopify/Product/1005",
    title: "Trail Runner",
    vendor: "Northwind",
    variants: [
      v("gid://shopify/ProductVariant/100501", "8", 6800),
      v("gid://shopify/ProductVariant/100502", "9", 6800),
      v("gid://shopify/ProductVariant/100503", "10", 6800),
      v("gid://shopify/ProductVariant/100504", "11", 6800),
      v("gid://shopify/ProductVariant/100505", "12", 6800),
    ],
  },
  {
    id: "gid://shopify/Product/1006",
    title: "Heritage Cap — Olive",
    vendor: "Halcyon",
    variants: [
      v("gid://shopify/ProductVariant/100601", "Olive / S/M", 3500),
      v("gid://shopify/ProductVariant/100602", "Olive / L/XL", 3500),
    ],
  },
  {
    id: "gid://shopify/Product/1007",
    title: "Atlas Travel Bag",
    vendor: "Atlas Goods",
    variants: [v("gid://shopify/ProductVariant/100701", "30L", 17000)],
  },
  {
    id: "gid://shopify/Product/1008",
    title: "Holiday Capsule 2025",
    vendor: "Northwind",
    variants: [
      v("gid://shopify/ProductVariant/100801", "Box A", 6635),
      v("gid://shopify/ProductVariant/100802", "Box B", 6635),
    ],
  },
  {
    id: "gid://shopify/Product/1009",
    title: "Northwind Jacket",
    vendor: "Northwind",
    variants: [
      v("gid://shopify/ProductVariant/100901", "Black / M", 12500),
      v("gid://shopify/ProductVariant/100902", "Black / L", 12500),
      v("gid://shopify/ProductVariant/100903", "Olive / M", 12500),
      v("gid://shopify/ProductVariant/100904", "Olive / L", 12500),
    ],
  },
  {
    id: "gid://shopify/Product/1010",
    title: "Ridgeline Beanie",
    vendor: "Halcyon",
    variants: [
      v("gid://shopify/ProductVariant/101001", "Charcoal", 2500),
      v("gid://shopify/ProductVariant/101002", "Olive", 2500),
      v("gid://shopify/ProductVariant/101003", "Burgundy", 2500),
    ],
  },
  {
    id: "gid://shopify/Product/1011",
    title: "Drift Backpack",
    vendor: "Atlas Goods",
    variants: [
      v("gid://shopify/ProductVariant/101101", "Charcoal", 8900),
      v("gid://shopify/ProductVariant/101102", "Sand", 8900),
    ],
  },
  {
    id: "gid://shopify/Product/1012",
    title: "Flatiron Sweater",
    vendor: "Northwind",
    variants: [
      v("gid://shopify/ProductVariant/101201", "Cream / S", 7400),
      v("gid://shopify/ProductVariant/101202", "Cream / M", 7400),
      v("gid://shopify/ProductVariant/101203", "Cream / L", 7400),
      v("gid://shopify/ProductVariant/101204", "Navy / M", 7400),
      v("gid://shopify/ProductVariant/101205", "Navy / L", 7400),
    ],
  },
];

// Index by id for O(1) lookups.
export const DEMO_PRODUCTS_BY_ID: Record<string, DemoProduct> =
  Object.fromEntries(DEMO_PRODUCTS.map((p) => [p.id, p]));

const DEMO_VARIANTS_BY_ID: Record<
  string,
  { product: DemoProduct; variant: DemoVariant }
> = {};
for (const p of DEMO_PRODUCTS) {
  for (const variant of p.variants) {
    DEMO_VARIANTS_BY_ID[variant.id] = { product: p, variant };
  }
}

export function lookupDemoProduct(id: string): DemoProduct | undefined {
  return DEMO_PRODUCTS_BY_ID[id];
}

export function lookupDemoVariant(
  id: string,
): { product: DemoProduct; variant: DemoVariant } | undefined {
  return DEMO_VARIANTS_BY_ID[id];
}

export function titleForGid(id: string): string {
  const p = DEMO_PRODUCTS_BY_ID[id];
  if (p) return p.title;
  const vRec = DEMO_VARIANTS_BY_ID[id];
  if (vRec) return `${vRec.product.title} · ${vRec.variant.title}`;
  return id.split("/").pop() ?? id;
}

// Flat list of every variant for the picker.
export const DEMO_VARIANT_LIST: {
  productId: string;
  productTitle: string;
  vendor: string;
  variantId: string;
  variantTitle: string;
  priceCents: number;
}[] = DEMO_PRODUCTS.flatMap((p) =>
  p.variants.map((vt) => ({
    productId: p.id,
    productTitle: p.title,
    vendor: p.vendor,
    variantId: vt.id,
    variantTitle: vt.title,
    priceCents: vt.priceCents,
  })),
);

// ---------- Markets (Shopify Markets — dummy) ----------
export type DemoMarket = { id: string; title: string; subtitle: string };

export const DEMO_MARKETS: DemoMarket[] = [
  { id: "intl", title: "International", subtitle: "Rest of world" },
  { id: "us", title: "United States", subtitle: "United States" },
  { id: "eu", title: "European Union", subtitle: "27 countries" },
  { id: "uk", title: "United Kingdom", subtitle: "United Kingdom" },
  { id: "ca", title: "Canada", subtitle: "Canada" },
  { id: "au", title: "Australia & NZ", subtitle: "Australia, New Zealand" },
];

export const DEMO_MARKETS_BY_ID: Record<string, DemoMarket> =
  Object.fromEntries(DEMO_MARKETS.map((m) => [m.id, m]));

// ---------- Collections (for the "Specific collection" scope — dummy) ----------
export type DemoCollection = { id: string; title: string; count: number };

export const DEMO_COLLECTIONS: DemoCollection[] = [
  { id: "gid://shopify/Collection/301", title: "New Arrivals", count: 24 },
  { id: "gid://shopify/Collection/302", title: "Outerwear", count: 12 },
  { id: "gid://shopify/Collection/303", title: "Footwear", count: 18 },
  { id: "gid://shopify/Collection/304", title: "Accessories", count: 31 },
];
