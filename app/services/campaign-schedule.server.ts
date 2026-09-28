/**
 * Campaign start/end dates → real status changes (2026-09-28).
 *
 * The storefront already hid an offer outside its start/end window, but the
 * campaign itself never changed status. After the end date its variants stayed
 * on CONTINUE ("sell past zero") and kept their checkout caps, so the theme's
 * own Add to cart kept selling; a SCHEDULED campaign whose start date arrived
 * never went LIVE, so its variants were never switched to CONTINUE and the
 * Preorder button's add-to-cart was rejected as sold out.
 *
 * This job runs on the scheduler's short tick and, per campaign:
 *   - LIVE / SCHEDULED / PAUSED with endDate passed        → ENDED
 *   - SCHEDULED with startDate reached (and not yet ended)  → LIVE
 * then re-syncs the selling plan + checkout caps and the continue-selling
 * policy exactly like a manual status change. Idempotent: once moved, a
 * campaign no longer matches either query.
 */
import prisma from "../db.server";
import type { AdminGraphqlClient } from "../models/selling-plan.server";
import { syncCampaignSellingPlan } from "../models/selling-plan.server";
import { syncContinueSellingSafe } from "./inventory-policy.server";

export type ScheduleTransition = { shop: string; id: string; to: "LIVE" | "ENDED" };

/** Pure: which transitions are due at `now`. Exported for tests. */
export function dueTransitions(
  rows: { shop: string; id: string; status: string; startDate: Date | null; endDate: Date | null }[],
  now: Date,
): ScheduleTransition[] {
  const out: ScheduleTransition[] = [];
  for (const r of rows) {
    const ended = r.endDate != null && r.endDate <= now;
    if (ended && (r.status === "LIVE" || r.status === "SCHEDULED" || r.status === "PAUSED")) {
      out.push({ shop: r.shop, id: r.id, to: "ENDED" });
    } else if (!ended && r.status === "SCHEDULED" && r.startDate != null && r.startDate <= now) {
      out.push({ shop: r.shop, id: r.id, to: "LIVE" });
    }
  }
  return out;
}

export async function applyCampaignSchedules(
  getAdmin: (shop: string) => Promise<AdminGraphqlClient>,
  now = new Date(),
): Promise<ScheduleTransition[]> {
  const rows = await prisma.campaign.findMany({
    where: {
      OR: [
        { status: { in: ["LIVE", "SCHEDULED", "PAUSED"] }, endDate: { lte: now } },
        { status: "SCHEDULED", startDate: { lte: now } },
      ],
    },
    select: { shop: true, id: true, status: true, startDate: true, endDate: true },
  });
  const due = dueTransitions(rows, now);
  for (const t of due) {
    await prisma.campaign.update({ where: { id: t.id }, data: { status: t.to } });
    try {
      const admin = await getAdmin(t.shop);
      await syncCampaignSellingPlan(admin, t.shop, t.id);
      await syncContinueSellingSafe(admin, t.shop, [t.id]);
    } catch (e) {
      // Status already moved; the hourly policy reconcile + next edit re-sync.
      console.error("[campaign-schedule] sync after", t.to, t.shop, t.id, e);
    }
  }
  if (due.length) console.log(`[campaign-schedule] ${due.map((d) => `${d.id}→${d.to}`).join(", ")}`);
  return due;
}
