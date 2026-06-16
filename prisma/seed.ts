/**
 * Dev seed for Preorder Novafied.
 *
 * Run via:
 *   npx prisma db seed
 *
 * Wipes existing campaigns/cohorts/preorders/waitlist for the dev shop and
 * re-creates a representative slice that matches what the UI used to render
 * with hard-coded mock data.
 */

import { PrismaClient } from "@prisma/client";
import {
  DEMO_PRODUCTS_BY_ID,
  type DemoProduct,
} from "../app/lib/demoProducts";

const prisma = new PrismaClient();

const DEV_SHOP =
  process.env.SEED_SHOP ?? "preorder-novafied-dev.myshopify.com";

type CampaignSeed = {
  name: string;
  status: "LIVE" | "SCHEDULED" | "PAUSED" | "ENDED" | "DRAFT";
  product: string;
  productGid: string;
  // Optional: extra products on this campaign (the form supports multi-select).
  extraProductGids?: string[];
  triggerType: "STOCK" | "DATE" | "MANUAL";
  paymentMode: "PAY_NOW" | "DEPOSIT" | "PAY_LATER";
  depositKind?: "PERCENT" | "FIXED";
  depositAmount?: number;
  cartMode: "SPLIT" | "WARNING";
  shipDate: Date;
  unitsTarget: number | null;
  // pre-order rows
  preOrders: {
    customerName: string;
    email: string;
    units: number;
    unitPriceCents: number;
    paymentStatus:
      | "DEPOSIT_PAID"
      | "BALANCE_PENDING"
      | "BALANCE_PAID"
      | "BALANCE_FAILED"
      | "REFUNDED";
    orderRef: string;
    daysAgo: number;
  }[];
  moqEnabled?: boolean;
  moqUnits?: number;
  discountEnabled?: boolean;
  discountAmount?: number;
};

const NOW = new Date();
const daysFromNow = (n: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + n);
  return d;
};
const daysAgo = (n: number) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  return d;
};

const SEED: CampaignSeed[] = [
  {
    name: "Aurora Hoodie launch",
    status: "LIVE",
    product: "Aurora Hoodie — Indigo",
    productGid: "gid://shopify/Product/1001",
    // Three products in the same drop — common pattern for capsule launches.
    extraProductGids: [
      "gid://shopify/Product/1009", // Northwind Jacket
      "gid://shopify/Product/1012", // Flatiron Sweater
    ],
    triggerType: "STOCK",
    paymentMode: "DEPOSIT",
    depositKind: "PERCENT",
    depositAmount: 20,
    cartMode: "SPLIT",
    shipDate: daysFromNow(37),
    unitsTarget: 600,
    discountEnabled: true,
    discountAmount: 10,
    preOrders: [
      { customerName: "Mira Tanaka", email: "mira@example.com", units: 2, unitPriceCents: 5400, paymentStatus: "DEPOSIT_PAID", orderRef: "#4821", daysAgo: 1 },
      { customerName: "Devon Adler", email: "devon@example.com", units: 1, unitPriceCents: 5400, paymentStatus: "BALANCE_PAID", orderRef: "#4810", daysAgo: 2 },
      { customerName: "Sarah Patel", email: "sarah.p@example.com", units: 3, unitPriceCents: 5400, paymentStatus: "BALANCE_FAILED", orderRef: "#4799", daysAgo: 4 },
      { customerName: "Lukas Bauer", email: "lukas@example.com", units: 1, unitPriceCents: 5400, paymentStatus: "BALANCE_PENDING", orderRef: "#4790", daysAgo: 4 },
      { customerName: "Aisha Khan", email: "aisha@example.com", units: 4, unitPriceCents: 5400, paymentStatus: "DEPOSIT_PAID", orderRef: "#4781", daysAgo: 5 },
      { customerName: "Marco Russo", email: "marco@example.com", units: 1, unitPriceCents: 5400, paymentStatus: "REFUNDED", orderRef: "#4775", daysAgo: 6 },
      // bulk filler so the unitsSold ≈ 412
      ...Array.from({ length: 50 }, (_, i) => ({
        customerName: `Customer ${i + 1}`,
        email: `c${i + 1}@example.com`,
        units: 8,
        unitPriceCents: 5400,
        paymentStatus: "DEPOSIT_PAID" as const,
        orderRef: `#${4700 + i}`,
        daysAgo: 7 + (i % 14),
      })),
    ],
  },
  {
    name: "Halcyon summer drop",
    status: "LIVE",
    product: "Halcyon Tee — Sand",
    productGid: "gid://shopify/Product/1002",
    triggerType: "DATE",
    paymentMode: "PAY_LATER",
    cartMode: "SPLIT",
    shipDate: daysFromNow(63),
    unitsTarget: 250,
    preOrders: Array.from({ length: 24 }, (_, i) => ({
      customerName: `Halcyon Buyer ${i + 1}`,
      email: `halcyon${i + 1}@example.com`,
      units: 8,
      unitPriceCents: 5200,
      paymentStatus: "DEPOSIT_PAID" as const,
      orderRef: `#${4600 + i}`,
      daysAgo: 1 + (i % 30),
    })),
  },
  {
    name: "Field Kit v2 replenishment",
    status: "LIVE",
    product: "Field Kit v2 — Charcoal",
    productGid: "gid://shopify/Product/1003",
    triggerType: "STOCK",
    paymentMode: "PAY_NOW",
    cartMode: "WARNING",
    shipDate: daysFromNow(16),
    unitsTarget: 300,
    preOrders: Array.from({ length: 18 }, (_, i) => ({
      customerName: `Field Buyer ${i + 1}`,
      email: `field${i + 1}@example.com`,
      units: 8,
      unitPriceCents: 5950,
      paymentStatus: "BALANCE_PAID" as const,
      orderRef: `#${4500 + i}`,
      daysAgo: 1 + (i % 25),
    })),
  },
  {
    name: "Limited bundle — Spring",
    status: "LIVE",
    product: "Limited Bundle — Spring",
    productGid: "gid://shopify/Product/1004",
    // Spring bundle includes a tee, hoodie, and cap.
    extraProductGids: [
      "gid://shopify/Product/1002",
      "gid://shopify/Product/1006",
    ],
    triggerType: "DATE",
    paymentMode: "DEPOSIT",
    depositKind: "PERCENT",
    depositAmount: 50,
    cartMode: "SPLIT",
    shipDate: daysFromNow(3),
    unitsTarget: 540,
    preOrders: Array.from({ length: 60 }, (_, i) => ({
      customerName: `Spring Buyer ${i + 1}`,
      email: `spring${i + 1}@example.com`,
      units: 9,
      unitPriceCents: 5100,
      paymentStatus: "BALANCE_PAID" as const,
      orderRef: `#${4400 + i}`,
      daysAgo: 5 + (i % 30),
    })),
  },
  {
    name: "Trail Runner pre-launch",
    status: "SCHEDULED",
    product: "Trail Runner — All sizes",
    productGid: "gid://shopify/Product/1005",
    triggerType: "MANUAL",
    paymentMode: "PAY_NOW",
    cartMode: "SPLIT",
    shipDate: daysFromNow(86),
    unitsTarget: 200,
    preOrders: [],
  },
  {
    name: "Heritage Cap — Olive",
    status: "PAUSED",
    product: "Heritage Cap — Olive",
    productGid: "gid://shopify/Product/1006",
    triggerType: "STOCK",
    paymentMode: "PAY_LATER",
    cartMode: "SPLIT",
    shipDate: daysFromNow(45),
    unitsTarget: null,
    preOrders: Array.from({ length: 8 }, (_, i) => ({
      customerName: `Cap Buyer ${i + 1}`,
      email: `cap${i + 1}@example.com`,
      units: 8,
      unitPriceCents: 3500,
      paymentStatus: "DEPOSIT_PAID" as const,
      orderRef: `#${4300 + i}`,
      daysAgo: 7 + (i % 21),
    })),
  },
  {
    name: "Crowdfund: Atlas Bag",
    status: "LIVE",
    product: "Atlas Travel Bag",
    productGid: "gid://shopify/Product/1007",
    extraProductGids: ["gid://shopify/Product/1011"], // Drift Backpack
    triggerType: "MANUAL",
    paymentMode: "DEPOSIT",
    depositKind: "PERCENT",
    depositAmount: 30,
    cartMode: "SPLIT",
    shipDate: daysFromNow(132),
    unitsTarget: 250,
    moqEnabled: true,
    moqUnits: 250,
    preOrders: Array.from({ length: 13 }, (_, i) => ({
      customerName: `Atlas Buyer ${i + 1}`,
      email: `atlas${i + 1}@example.com`,
      units: 6,
      unitPriceCents: 17000,
      paymentStatus: "DEPOSIT_PAID" as const,
      orderRef: `#${4200 + i}`,
      daysAgo: 1 + (i % 14),
    })),
  },
  {
    name: "Holiday capsule (last year)",
    status: "ENDED",
    product: "Holiday Capsule 2025",
    productGid: "gid://shopify/Product/1008",
    triggerType: "DATE",
    paymentMode: "DEPOSIT",
    depositKind: "PERCENT",
    depositAmount: 25,
    cartMode: "SPLIT",
    shipDate: daysAgo(150),
    unitsTarget: 880,
    preOrders: Array.from({ length: 50 }, (_, i) => ({
      customerName: `Holiday Buyer ${i + 1}`,
      email: `holiday${i + 1}@example.com`,
      units: 17,
      unitPriceCents: 6635,
      paymentStatus: "BALANCE_PAID" as const,
      orderRef: `#${4100 + i}`,
      daysAgo: 160 + (i % 30),
    })),
  },
];

async function main() {
  console.log(`Seeding shop: ${DEV_SHOP}`);

  // Reset for an idempotent seed.
  await prisma.preOrder.deleteMany({ where: { shop: DEV_SHOP } });
  await prisma.cohort.deleteMany({ where: { shop: DEV_SHOP } });
  await prisma.campaign.deleteMany({ where: { shop: DEV_SHOP } });
  await prisma.waitlistSubscription.deleteMany({ where: { shop: DEV_SHOP } });
  await prisma.orderBundle.deleteMany({ where: { shop: DEV_SHOP } });

  for (const s of SEED) {
    const campaign = await prisma.campaign.create({
      data: {
        shop: DEV_SHOP,
        name: s.name,
        status: s.status,
        productMode: "SPECIFIC",
        productIds: JSON.stringify([
          s.productGid,
          ...(s.extraProductGids ?? []),
        ]),
        triggerType: s.triggerType,
        stockThreshold: 0,
        paymentMode: s.paymentMode,
        depositKind: s.depositKind ?? "PERCENT",
        depositAmount: s.depositAmount ?? 20,
        cartMode: s.cartMode,
        shipDate: s.shipDate,
        cohortName: `${s.shipDate.toLocaleString("en-US", {
          month: "long",
        })} ${s.shipDate.getFullYear()} — ${s.name}`,
        moqEnabled: s.moqEnabled ?? false,
        moqUnits: s.moqUnits,
        discountEnabled: s.discountEnabled ?? false,
        discountKind: "PERCENT",
        discountAmount: s.discountAmount ?? 0,
        orderTags: JSON.stringify([
          "preorder",
          `ship-${s.shipDate.toISOString().slice(0, 7)}`,
        ]),
        dunningSteps: JSON.stringify([
          { id: "d1", channel: "email", offsetDays: 1, label: "First retry" },
          { id: "d2", channel: "email", offsetDays: 3, label: "Second retry" },
          { id: "d3", channel: "sms", offsetDays: 5, label: "Final reminder" },
        ]),
        // Seed each product's first 1-2 variants with realistic unit caps.
        variantConfigs: JSON.stringify(
          [s.productGid, ...(s.extraProductGids ?? [])]
            .map((pid) => DEMO_PRODUCTS_BY_ID[pid] as DemoProduct | undefined)
            .filter((p): p is DemoProduct => Boolean(p))
            .flatMap((p) =>
              p.variants.slice(0, 2).map((v) => ({
                productId: p.id,
                variantId: v.id,
                productTitle: p.title,
                variantTitle: v.title,
                unitsOffered: Math.max(
                  50,
                  Math.round(
                    (s.unitsTarget ?? 200) /
                      Math.max(1, p.variants.slice(0, 2).length),
                  ),
                ),
              })),
            ),
        ),
      },
    });

    const cohort = await prisma.cohort.create({
      data: {
        shop: DEV_SHOP,
        campaignId: campaign.id,
        shipDate: s.shipDate,
        name: campaign.cohortName ?? s.name,
        status:
          s.status === "ENDED"
            ? "SHIPPED"
            : s.shipDate < daysFromNow(7)
              ? "READY_TO_SHIP"
              : s.preOrders.reduce((a, p) => a + p.units, 0) <
                  (s.unitsTarget ?? Infinity) * 0.5
                ? "AT_RISK"
                : "ON_TRACK",
        unitsTarget: s.unitsTarget ?? null,
      },
    });

    if (s.preOrders.length) {
      await prisma.preOrder.createMany({
        data: s.preOrders.map((p) => {
          const total = (p.units * p.unitPriceCents) / 100;
          const deposit =
            s.paymentMode === "DEPOSIT"
              ? total * ((s.depositAmount ?? 20) / 100)
              : null;
          const balance = deposit !== null ? total - deposit : null;
          return {
            shop: DEV_SHOP,
            campaignId: campaign.id,
            cohortId: cohort.id,
            customerEmail: p.email,
            customerName: p.customerName,
            orderRef: p.orderRef,
            units: p.units,
            amount: total,
            depositAmount: deposit,
            balanceAmount: balance,
            paymentStatus: p.paymentStatus,
            paidAt:
              p.paymentStatus === "BALANCE_PAID" ? daysAgo(p.daysAgo) : null,
            failedAt:
              p.paymentStatus === "BALANCE_FAILED"
                ? daysAgo(p.daysAgo)
                : null,
            refundedAt:
              p.paymentStatus === "REFUNDED" ? daysAgo(p.daysAgo) : null,
            createdAt: daysAgo(p.daysAgo),
          };
        }),
      });
    }

    console.log(
      `  ${s.name.padEnd(36)}  ${s.preOrders.length} preorders, cohort ${cohort.id}`,
    );
  }

  // Some waitlist signups so the dashboard count is non-zero.
  const waitlistVariants = [
    {
      productId: "gid://shopify/Product/1001",
      productTitle: "Aurora Hoodie",
      variantTitle: "Indigo / M",
    },
    {
      productId: "gid://shopify/Product/1002",
      productTitle: "Halcyon Tee",
      variantTitle: "Sand / L",
    },
    {
      productId: "gid://shopify/Product/1006",
      productTitle: "Heritage Cap",
      variantTitle: "Olive",
    },
  ];
  for (const v of waitlistVariants) {
    await prisma.waitlistSubscription.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        shop: DEV_SHOP,
        productId: v.productId,
        productTitle: v.productTitle,
        variantTitle: v.variantTitle,
        email: `waitlist${i}_${v.productId.slice(-4)}@example.com`,
        channel: i % 5 === 0 ? "BOTH" : "EMAIL",
      })),
    });
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
