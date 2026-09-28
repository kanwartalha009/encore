/**
 * In-process scheduler — Railway has no "ping this URL on a schedule" cron, so
 * the always-on web service runs its own timers. Started once from
 * entry.server.tsx at boot (global-guarded against dev-server module reloads).
 *
 * Every job here is idempotent, so restarts / occasional double-runs are safe:
 *   - outbox:            retry-safe by design (Nova dedupes, backoff in DB)
 *   - balance reminders: once per preorder via PreOrder.balanceRemindedAt
 *   - GDPR purge:        once per shop via UninstalledShop.purgedAt
 *   - campaign schedule: start/end dates → LIVE / ENDED (a moved campaign no
 *                        longer matches the query)
 *   - app pricing:       every 6 h, each shop's plan from the Partner API
 *
 * The /cron/* HTTP endpoints remain (token-guarded) as manual triggers and as
 * an external-scheduler option. Set ENCORE_DISABLE_INTERNAL_CRON=1 to turn the
 * internal timers off if an external scheduler is ever preferred.
 */
import prisma from "../db.server";
import { flushOutbox, scrubDeliveredOutbox } from "../lib/nova.server";
import { remindBalancesDue } from "./notify-events.server";
import { purgeDueShops } from "./gdpr.server";
import { reconcileLiveCampaignPolicies, syncCrossedVariantWindows } from "./inventory-policy.server";
import { applyCampaignSchedules } from "./campaign-schedule.server";
import { retryFailedAllShops } from "./waitlist-notify.server";
import { syncAllPlans } from "./app-pricing.server";
import { unauthenticated } from "../shopify.server";

const OUTBOX_EVERY_MS = 2 * 60 * 1000; // matches the "every 2 minutes" ops spec
const HOURLY_EVERY_MS = 60 * 60 * 1000; // daily jobs run hourly — idempotent, so
// this only makes them land closer to their due moment, never twice.
const BOOT_DELAY_MS = 30 * 1000; // let the server finish booting first

/** Heartbeats for /health — proves the timers are actually firing. */
export function schedulerHeartbeat(): {
  started: boolean;
  lastOutboxTickAt: string | null;
  lastHourlyTickAt: string | null;
} {
  const g = globalThis as unknown as {
    __encoreSchedulerStarted?: boolean;
    __encoreLastOutboxTick?: number;
    __encoreLastHourlyTick?: number;
  };
  return {
    started: !!g.__encoreSchedulerStarted,
    lastOutboxTickAt: g.__encoreLastOutboxTick
      ? new Date(g.__encoreLastOutboxTick).toISOString()
      : null,
    lastHourlyTickAt: g.__encoreLastHourlyTick
      ? new Date(g.__encoreLastHourlyTick).toISOString()
      : null,
  };
}

async function outboxTick(): Promise<void> {
  (globalThis as unknown as { __encoreLastOutboxTick?: number }).__encoreLastOutboxTick = Date.now();
  try {
    const r = await flushOutbox(100);
    if (r.processed > 0) {
      console.log(`[scheduler/outbox] sent=${r.sent} failed=${r.failed} processed=${r.processed}`);
    }
  } catch (e) {
    console.error("[scheduler/outbox]", e);
  }
}

async function balanceRemindersTick(): Promise<void> {
  (globalThis as unknown as { __encoreLastHourlyTick?: number }).__encoreLastHourlyTick = Date.now();
  try {
    const shops = await prisma.session.findMany({ distinct: ["shop"], select: { shop: true } });
    let reminded = 0;
    for (const s of shops) {
      reminded += await remindBalancesDue(s.shop).catch((e) => {
        console.error("[scheduler/balance-reminders]", s.shop, e);
        return 0;
      });
    }
    if (reminded > 0) {
      console.log(`[scheduler/balance-reminders] ${reminded} reminder(s) across ${shops.length} shop(s)`);
    }
  } catch (e) {
    console.error("[scheduler/balance-reminders]", e);
  }
}

async function purgeTick(): Promise<void> {
  try {
    // Shared with /cron/purge-uninstalled; skips (and cancels) shops that
    // reinstalled within the 48h window.
    const purged = await purgeDueShops();
    if (purged.length > 0) console.log(`[scheduler/purge-uninstalled] purged ${purged.length} shop(s)`);
    const scrubbed = await scrubDeliveredOutbox();
    if (scrubbed > 0) console.log(`[scheduler/outbox] cleared ${scrubbed} delivered payload(s)`);
  } catch (e) {
    console.error("[scheduler/purge-uninstalled]", e);
  }
}

/** Start/end dates → status changes (every 2 min; cheap indexed query). */
async function campaignScheduleTick(): Promise<void> {
  const g = globalThis as unknown as { __encoreLastScheduleTick?: number };
  const now = new Date();
  // First tick after boot looks back 10 minutes so a restart never skips a boundary.
  const since = new Date(g.__encoreLastScheduleTick ?? now.getTime() - 10 * 60 * 1000);
  g.__encoreLastScheduleTick = now.getTime();
  const getAdmin = async (shop: string) => (await unauthenticated.admin(shop)).admin;
  try {
    await applyCampaignSchedules(getAdmin, now);
  } catch (e) {
    console.error("[scheduler/campaign-schedule]", e);
  }
  try {
    // Per-variant availability windows → continue-selling on time.
    await syncCrossedVariantWindows(getAdmin, since, now);
  } catch (e) {
    console.error("[scheduler/variant-windows]", e);
  }
}

/** Back-in-stock: retry transient send failures (setup problems wait for the merchant). */
async function waitlistRetryTick(): Promise<void> {
  try {
    const r = await retryFailedAllShops();
    if (r.attempted > 0) console.log(`[scheduler/back-in-stock-retry] sent=${r.sent} failed=${r.failed}`);
  } catch (e) {
    console.error("[scheduler/back-in-stock-retry]", e);
  }
}

async function policyReconcileTick(): Promise<void> {
  try {
    const r = await reconcileLiveCampaignPolicies(async (shop) => (await unauthenticated.admin(shop)).admin);
    if (r.variants > 0) {
      console.log(`[scheduler/inventory-policy] CONTINUE on ${r.variants} variant(s) across ${r.campaigns} live campaign(s) / ${r.shops} shop(s)`);
    }
  } catch (e) {
    console.error("[scheduler/inventory-policy]", e);
  }
}

/** Shopify App Pricing: re-check every shop's plan (no webhooks) — every 6th hourly tick. */
let hourlyCount = 0;
async function planSyncTick(): Promise<void> {
  if (hourlyCount++ % 6 !== 0) return;
  try {
    const shops = await prisma.session.findMany({ distinct: ["shop"], select: { shop: true } });
    const r = await syncAllPlans(
      shops.map((s) => s.shop),
      async (shop) => (await unauthenticated.admin(shop)).admin,
    );
    if (r.checked > 0) {
      console.log(`[scheduler/app-pricing] checked=${r.checked} active=${r.active} none=${r.none} unknown=${r.unknown}`);
    }
  } catch (e) {
    console.error("[scheduler/app-pricing]", e);
  }
}

export function startScheduler(): void {
  if (process.env.ENCORE_DISABLE_INTERNAL_CRON === "1") {
    console.log("[scheduler] internal cron disabled via ENCORE_DISABLE_INTERNAL_CRON");
    return;
  }
  const g = globalThis as unknown as { __encoreSchedulerStarted?: boolean };
  if (g.__encoreSchedulerStarted) return; // dev-server module reloads
  g.__encoreSchedulerStarted = true;

  setTimeout(() => {
    void outboxTick();
    void campaignScheduleTick();
    void balanceRemindersTick();
    void purgeTick();
    void policyReconcileTick();
    void waitlistRetryTick();
    void planSyncTick();
    setInterval(() => {
      void outboxTick();
      void campaignScheduleTick();
    }, OUTBOX_EVERY_MS);
    setInterval(() => {
      void balanceRemindersTick();
      void purgeTick();
      void policyReconcileTick();
      void waitlistRetryTick();
      void planSyncTick();
    }, HOURLY_EVERY_MS);
    console.log("[scheduler] started — outbox + campaign start/end every 2min, reminders/purge/policy-reconcile hourly");
  }, BOOT_DELAY_MS);
}
