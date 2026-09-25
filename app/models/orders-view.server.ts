/**
 * Orders + activity view models (2026-09-24).
 *
 * Encore stores one PreOrder row per order line item. Merchants think in
 * orders, so this module folds rows back into orders (one row per Shopify
 * order, units/amount summed) and derives an activity timeline from the
 * timestamps already on the rows (placed, paid, failed, refunded, reminded).
 * There is no separate event log — everything here is computed from data the
 * webhooks already write, so it can never disagree with the tables.
 *
 * `groupOrders` and `deriveActivity` are pure and exported for tests; the
 * Prisma-backed loaders sit at the bottom.
 */
import prisma from "../db.server";
import { displayOrderRef } from "../lib/format";

export type PreOrderRowLike = {
  id: string;
  campaignId: string;
  customerEmail: string;
  customerName: string | null;
  shopifyOrderId: string | null;
  orderRef: string | null;
  units: number;
  amount: number;
  paymentStatus: string;
  paidAt: Date | null;
  failedAt: Date | null;
  refundedAt: Date | null;
  balanceRemindedAt: Date | null;
  createdAt: Date;
  campaign?: { name: string } | null;
  cohort?: { shipDate: Date } | null;
};

export type OrderRow = {
  /** PreOrder id of the first line (stable React key). */
  id: string;
  orderRef: string;
  /** Numeric Shopify order id, or null when the row came from the seed script. */
  shopifyOrderNumericId: string | null;
  campaignId: string;
  campaignName: string;
  customerName: string;
  customerEmail: string;
  units: number;
  amount: number;
  paymentStatus: string;
  shipDate: Date | null;
  placedAt: Date;
  lines: number;
};

/** Payment status of a whole order = the least-settled of its lines. */
const STATUS_RANK: Record<string, number> = {
  BALANCE_FAILED: 0,
  BALANCE_PENDING: 1,
  DEPOSIT_PAID: 2,
  BALANCE_PAID: 3,
  REFUNDED: 4,
};

export function numericOrderId(gid: string | null): string | null {
  if (!gid) return null;
  const m = /(\d+)$/.exec(gid);
  return m ? m[1] : null;
}

export function groupOrders(rows: PreOrderRowLike[]): OrderRow[] {
  const byKey = new Map<string, OrderRow>();
  for (const r of rows) {
    const key = r.shopifyOrderId ?? `row:${r.id}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        id: r.id,
        orderRef: displayOrderRef(r.orderRef) || "—",
        shopifyOrderNumericId: numericOrderId(r.shopifyOrderId),
        campaignId: r.campaignId,
        campaignName: r.campaign?.name ?? "",
        customerName: r.customerName ?? r.customerEmail,
        customerEmail: r.customerEmail,
        units: r.units,
        amount: r.amount,
        paymentStatus: r.paymentStatus,
        shipDate: r.cohort?.shipDate ?? null,
        placedAt: r.createdAt,
        lines: 1,
      });
      continue;
    }
    existing.units += r.units;
    existing.amount += r.amount;
    existing.lines += 1;
    if ((STATUS_RANK[r.paymentStatus] ?? 9) < (STATUS_RANK[existing.paymentStatus] ?? 9)) {
      existing.paymentStatus = r.paymentStatus;
    }
    if (r.createdAt < existing.placedAt) existing.placedAt = r.createdAt;
    if (r.cohort?.shipDate && (!existing.shipDate || r.cohort.shipDate < existing.shipDate)) {
      existing.shipDate = r.cohort.shipDate;
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.placedAt.getTime() - a.placedAt.getTime());
}

export type ActivityEvent = {
  /** Stable id for React keys. */
  id: string;
  kind: "order" | "paid" | "failed" | "refunded" | "reminder" | "campaign";
  /** i18n key — rendered through t(). */
  text: string;
  /** Free text (order ref, customer, amount) — not translated. */
  detail: string;
  at: Date;
};

/**
 * Timeline for one campaign, newest first. Each PreOrder row contributes the
 * events its timestamps prove happened; the campaign contributes its own
 * creation and (when set) launch.
 */
export function deriveActivity(
  rows: PreOrderRowLike[],
  campaign?: { createdAt: Date; startDate: Date | null; status: string; name: string } | null,
  limit = 50,
): ActivityEvent[] {
  const out: ActivityEvent[] = [];
  const orders = groupOrders(rows);
  for (const o of orders) {
    const who = o.customerName;
    out.push({
      id: `order:${o.id}`,
      kind: "order",
      text: "Preorder placed",
      detail: `${o.orderRef} · ${who} · ${o.units} ${o.units === 1 ? "unit" : "units"}`,
      at: o.placedAt,
    });
  }
  for (const r of rows) {
    const ref = displayOrderRef(r.orderRef) || "—";
    if (r.paidAt)
      out.push({ id: `paid:${r.id}`, kind: "paid", text: "Payment received", detail: ref, at: r.paidAt });
    if (r.failedAt)
      out.push({ id: `failed:${r.id}`, kind: "failed", text: "Payment failed", detail: ref, at: r.failedAt });
    if (r.refundedAt)
      out.push({ id: `refund:${r.id}`, kind: "refunded", text: "Refunded", detail: ref, at: r.refundedAt });
    if (r.balanceRemindedAt)
      out.push({
        id: `remind:${r.id}`,
        kind: "reminder",
        text: "Balance reminder sent",
        detail: `${ref} · ${r.customerEmail}`,
        at: r.balanceRemindedAt,
      });
  }
  if (campaign) {
    out.push({
      id: "campaign:created",
      kind: "campaign",
      text: "Preorder created",
      detail: campaign.name,
      at: campaign.createdAt,
    });
    if (campaign.startDate && campaign.startDate.getTime() <= Date.now()) {
      out.push({
        id: "campaign:started",
        kind: "campaign",
        text: "Preorder went live",
        detail: campaign.name,
        at: campaign.startDate,
      });
    }
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

// ---------- Prisma-backed loaders ----------

const rowSelect = {
  id: true,
  campaignId: true,
  customerEmail: true,
  customerName: true,
  shopifyOrderId: true,
  orderRef: true,
  units: true,
  amount: true,
  paymentStatus: true,
  paidAt: true,
  failedAt: true,
  refundedAt: true,
  balanceRemindedAt: true,
  createdAt: true,
  campaign: { select: { name: true } },
  cohort: { select: { shipDate: true } },
} as const;

/** Every preorder line for the shop (newest first), folded into orders. */
export async function listShopOrders(shop: string, take = 500): Promise<OrderRow[]> {
  const rows = await prisma.preOrder.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take,
    select: rowSelect,
  });
  return groupOrders(rows);
}

/** Orders + activity for one campaign. */
export async function getCampaignOrdersAndActivity(shop: string, campaignId: string) {
  const [rows, campaign] = await Promise.all([
    prisma.preOrder.findMany({
      where: { shop, campaignId },
      orderBy: { createdAt: "desc" },
      take: 500,
      select: rowSelect,
    }),
    prisma.campaign.findFirst({
      where: { shop, id: campaignId },
      select: { createdAt: true, startDate: true, status: true, name: true },
    }),
  ]);
  return { orders: groupOrders(rows), activity: deriveActivity(rows, campaign) };
}

/** Shop-wide recent activity for the dashboard feed. */
export async function listShopActivity(shop: string, limit = 8): Promise<ActivityEvent[]> {
  const rows = await prisma.preOrder.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: rowSelect,
  });
  return deriveActivity(rows, null, limit);
}
