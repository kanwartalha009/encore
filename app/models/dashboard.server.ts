/**
 * Dashboard aggregates. One module so the loader stays small.
 */
import prisma from "../db.server";
import { formatGmv } from "./campaign.server";
import { getReliability, type ReliabilityReport } from "../services/reliability.server";

export type DashboardData = {
  kpis: {
    label: string;
    value: string;
    delta: string;
    deltaTone: "success" | "critical" | "subdued";
    sub: string;
  }[];
  cohorts: {
    id: string;
    name: string;
    shipDate: string;
    unitsSold: number;
    unitsTarget: number;
    gmv: string;
    status: "On track" | "At risk" | "Ready to ship";
  }[];
  campaigns: {
    id: string;
    product: string;
    trigger: string;
    payment: string;
    units: string;
    shipDate: string;
    status: "Live" | "Scheduled" | "Paused" | "Ended" | "Draft";
  }[];
  activity: { kind: string; text: string; detail: string; time: string }[];
  reliability: ReliabilityReport;
  /** R0.2 — Nova outbox health: stuck PENDING (>15 min) or DEAD deliveries. */
  outboxAlert: { stuck: number; dead: number } | null;
};

const TRIGGER_LABEL: Record<string, string> = {
  STOCK: "Stock = 0",
  DATE: "Date range",
  MANUAL: "Manual",
};

const PAYMENT_LABEL: Record<string, string> = {
  PAY_NOW: "Pay now",
  DEPOSIT: "Deposit + balance",
  PAY_LATER: "Pay later",
};

const STATUS_LABEL: Record<string, DashboardData["campaigns"][number]["status"]> =
  {
    DRAFT: "Draft",
    SCHEDULED: "Scheduled",
    LIVE: "Live",
    PAUSED: "Paused",
    ENDED: "Ended",
  };

const COHORT_STATUS_LABEL: Record<string, DashboardData["cohorts"][number]["status"]> =
  {
    ON_TRACK: "On track",
    AT_RISK: "At risk",
    READY_TO_SHIP: "Ready to ship",
    SHIPPED: "Ready to ship",
  };

export async function getDashboard(
  shop: string,
  currency = "USD",
  locale = "en",
): Promise<DashboardData> {
  const [campaigns, cohorts, preOrders, waitlistCount, reliability] = await Promise.all([
    prisma.campaign.findMany({
      where: { shop },
      orderBy: { updatedAt: "desc" },
      include: {
        cohorts: { orderBy: { shipDate: "asc" }, take: 1 },
        preOrders: { select: { units: true, amount: true } },
      },
      take: 8,
    }),
    prisma.cohort.findMany({
      where: { shop, status: { not: "SHIPPED" } },
      orderBy: { shipDate: "asc" },
      include: {
        campaign: { select: { name: true, status: true } },
        preOrders: { select: { units: true, amount: true } },
      },
      take: 5,
    }),
    prisma.preOrder.findMany({
      where: { shop },
      select: { amount: true, units: true, createdAt: true, paymentStatus: true },
    }),
    prisma.waitlistSubscription.count({ where: { shop, subscribed: true } }),
    getReliability(shop),
  ]);

  // Outbox health — surfaces silently-failing delivery (unscheduled cron or
  // exhausted retries). prisma cast: NovaOutbox is post-template (db push).
  const ob = prisma as unknown as {
    novaOutbox: {
      count(a: { where: Record<string, unknown> }): Promise<number>;
    };
  };
  let outboxAlert: { stuck: number; dead: number } | null = null;
  try {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const [stuck, dead] = await Promise.all([
      ob.novaOutbox.count({ where: { status: "PENDING", createdAt: { lt: cutoff } } }),
      ob.novaOutbox.count({ where: { status: "DEAD" } }),
    ]);
    outboxAlert = stuck > 0 || dead > 0 ? { stuck, dead } : null;
  } catch {
    outboxAlert = null; // table absent in a fresh dev DB — never break the dashboard
  }

  const unitsSold = preOrders.reduce((a, p) => a + p.units, 0);
  const activeCampaigns = campaigns.filter(
    (c) => c.status === "LIVE" || c.status === "SCHEDULED",
  ).length;

  // Real 30-day deltas (R1 truth fix — these were hardcoded demo values).
  const DAY = 24 * 60 * 60 * 1000;
  const d30 = new Date(Date.now() - 30 * DAY);
  const d60 = new Date(Date.now() - 60 * DAY);
  const cur30 = preOrders.filter((p) => p.createdAt >= d30);
  const prev30 = preOrders.filter((p) => p.createdAt >= d60 && p.createdAt < d30);
  const cur30Gmv = cur30.reduce((a, p) => a + p.amount, 0);
  const prev30Gmv = prev30.reduce((a, p) => a + p.amount, 0);
  const gmvDelta =
    prev30Gmv > 0
      ? `${cur30Gmv >= prev30Gmv ? "+" : ""}${Math.round(((cur30Gmv - prev30Gmv) / prev30Gmv) * 100)}%`
      : "—";
  const cur30Units = cur30.reduce((a, p) => a + p.units, 0);

  const kpis: DashboardData["kpis"] = [
    {
      label: "Preorder GMV (last 30 days)",
      value: formatGmv(Math.round(cur30Gmv * 100), currency, locale),
      delta: gmvDelta,
      deltaTone: gmvDelta === "—" || cur30Gmv >= prev30Gmv ? "success" : "critical",
      sub: "vs. previous 30 days",
    },
    {
      label: "Active preorders",
      value: String(activeCampaigns),
      delta: campaigns.length ? `${campaigns.length} total` : "—",
      deltaTone: "subdued",
      sub: campaigns.length === 1 ? "preorder" : "preorders",
    },
    {
      label: "Units pre-sold",
      value: unitsSold.toLocaleString(),
      delta: cur30Units > 0 ? `+${cur30Units.toLocaleString()}` : "—",
      deltaTone: cur30Units > 0 ? "success" : "subdued",
      sub: "last 30 days",
    },
    {
      label: "Waitlist subscribers",
      value: waitlistCount.toLocaleString(),
      delta: "—",
      deltaTone: "subdued",
      sub: "back-in-stock signups",
    },
  ];

  return {
    kpis,
    outboxAlert,
    cohorts: cohorts.map((c) => {
      const sold = c.preOrders.reduce((a, p) => a + p.units, 0);
      const gmv = Math.round(c.preOrders.reduce((a, p) => a + p.amount, 0) * 100);
      return {
        id: c.id,
        name: c.name,
        shipDate: `Ships ${c.shipDate.toISOString().slice(0, 10)}`,
        unitsSold: sold,
        unitsTarget: c.unitsTarget ?? Math.max(sold, 1),
        gmv: formatGmv(gmv, currency, locale),
        status: COHORT_STATUS_LABEL[c.status] ?? "On track",
      };
    }),
    campaigns: campaigns.slice(0, 6).map((c) => {
      const sold = c.preOrders.reduce((a, p) => a + p.units, 0);
      const target = c.cohorts[0]?.unitsTarget;
      return {
        id: c.id,
        product: c.name,
        trigger: TRIGGER_LABEL[c.triggerType] ?? c.triggerType,
        payment: PAYMENT_LABEL[c.paymentMode] ?? c.paymentMode,
        units: target ? `${sold} / ${target}` : `${sold}`,
        shipDate:
          c.cohorts[0]?.shipDate.toISOString().slice(0, 10) ?? "TBD",
        status: STATUS_LABEL[c.status] ?? "Draft",
      };
    }),
    activity: [], // Populated by future event log; left empty for now.
    reliability,
  };
}
