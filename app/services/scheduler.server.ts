/**
 * In-process scheduler — Railway has no "ping this URL on a schedule" cron, so
 * the always-on web service runs its own timers. Started once from
 * entry.server.tsx at boot (global-guarded against dev-server module reloads).
 *
 * Every job here is idempotent, so restarts / occasional double-runs are safe:
 *   - outbox:            retry-safe by design (Nova dedupes, backoff in DB)
 *   - balance reminders: once per preorder via PreOrder.balanceRemindedAt
 *   - GDPR purge:        once per shop via UninstalledShop.purgedAt
 *
 * The /cron/* HTTP endpoints remain (token-guarded) as manual triggers and as
 * an external-scheduler option. Set ENCORE_DISABLE_INTERNAL_CRON=1 to turn the
 * internal timers off if an external scheduler is ever preferred.
 */
import prisma from "../db.server";
import { flushOutbox } from "../lib/nova.server";
import { remindBalancesDue } from "./notify-events.server";
import { purgeShopData } from "./gdpr.server";

const OUTBOX_EVERY_MS = 2 * 60 * 1000; // matches the "every 2 minutes" ops spec
const HOURLY_EVERY_MS = 60 * 60 * 1000; // daily jobs run hourly — idempotent, so
// this only makes them land closer to their due moment, never twice.
const BOOT_DELAY_MS = 30 * 1000; // let the server finish booting first

const PURGE_AFTER_MS = 48 * 60 * 60 * 1000;

type UninstalledRow = { shop: string; uninstalledAt: Date };
const uninstalledShop = (
  prisma as unknown as {
    uninstalledShop: {
      findMany(a: { where: Record<string, unknown> }): Promise<UninstalledRow[]>;
      update(a: { where: { shop: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
  }
).uninstalledShop;

async function outboxTick(): Promise<void> {
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
    const cutoff = new Date(Date.now() - PURGE_AFTER_MS);
    const due = await uninstalledShop.findMany({
      where: { purgedAt: null, uninstalledAt: { lt: cutoff } },
    });
    for (const row of due) {
      await purgeShopData(row.shop);
      await uninstalledShop.update({ where: { shop: row.shop }, data: { purgedAt: new Date() } });
    }
    if (due.length > 0) console.log(`[scheduler/purge-uninstalled] purged ${due.length} shop(s)`);
  } catch (e) {
    console.error("[scheduler/purge-uninstalled]", e);
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
    void balanceRemindersTick();
    void purgeTick();
    setInterval(() => void outboxTick(), OUTBOX_EVERY_MS);
    setInterval(() => {
      void balanceRemindersTick();
      void purgeTick();
    }, HOURLY_EVERY_MS);
    console.log("[scheduler] started — outbox every 2min, reminders/purge hourly");
  }, BOOT_DELAY_MS);
}
