import prisma from "../db.server";
import { formatGmv } from "./campaign.server";

export type CohortListRow = {
  id: string;
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  name: string;
  shipDate: string;
  daysToShip: number;
  unitsSold: number;
  unitsTarget: number | null;
  gmv: string;
  status: "ON_TRACK" | "AT_RISK" | "READY_TO_SHIP" | "SHIPPED";
};

export async function listCohorts(shop: string): Promise<CohortListRow[]> {
  const cohorts = await prisma.cohort.findMany({
    where: { shop },
    orderBy: { shipDate: "asc" },
    include: {
      campaign: { select: { name: true, status: true } },
      preOrders: { select: { units: true, amount: true } },
    },
  });

  const now = Date.now();
  return cohorts.map((c) => {
    const unitsSold = c.preOrders.reduce((a, p) => a + p.units, 0);
    const gmv = Math.round(c.preOrders.reduce((a, p) => a + p.amount, 0) * 100);
    const daysToShip = Math.round(
      (c.shipDate.getTime() - now) / (1000 * 60 * 60 * 24),
    );
    return {
      id: c.id,
      campaignId: c.campaignId,
      campaignName: c.campaign.name,
      campaignStatus: c.campaign.status,
      name: c.name,
      shipDate: c.shipDate.toISOString().slice(0, 10),
      daysToShip,
      unitsSold,
      unitsTarget: c.unitsTarget,
      gmv: formatGmv(gmv),
      status: c.status as CohortListRow["status"],
    };
  });
}

// ---------- Preorder orders (one row per customer preorder line) ----------
export type PreOrderRow = {
  id: string;
  orderRef: string;
  customer: string;
  product: string;
  cohort: string;
  shipDate: string;
  units: number;
  amount: string;
  paymentStatus: string;
  createdAt: string;
};

const PAYMENT_LABEL: Record<string, string> = {
  DEPOSIT_PAID: "Deposit paid",
  BALANCE_PENDING: "Balance due",
  BALANCE_PAID: "Paid in full",
  BALANCE_FAILED: "Payment failed",
  REFUNDED: "Refunded",
};

export async function listPreOrders(shop: string): Promise<PreOrderRow[]> {
  const rows = await prisma.preOrder.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      campaign: { select: { name: true } },
      cohort: { select: { name: true, shipDate: true } },
    },
  });
  return rows.map((p) => ({
    id: p.id,
    orderRef: p.orderRef ?? p.shopifyOrderId ?? p.id.slice(0, 8),
    customer: p.customerName ?? p.customerEmail,
    product: p.campaign?.name ?? "—",
    cohort: p.cohort?.name ?? "—",
    shipDate: p.cohort?.shipDate
      ? p.cohort.shipDate.toISOString().slice(0, 10)
      : "—",
    units: p.units,
    amount: formatGmv(Math.round(p.amount * 100)),
    paymentStatus: PAYMENT_LABEL[p.paymentStatus] ?? p.paymentStatus,
    createdAt: p.createdAt.toISOString().slice(0, 10),
  }));
}
