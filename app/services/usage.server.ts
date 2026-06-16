/**
 * Usage metering + limit resolution (billing). Counts the shop's pre-orders +
 * notify-me signups for the current calendar month and compares to the plan
 * limits (from Nova via plans.server). Cached briefly so the storefront hot path
 * (preorder eligibility) isn't re-counting on every PDP fetch.
 *
 * Enforcement is **soft + safe**: only a shop that is on a limited plan AND over
 * the cap is blocked from offering NEW pre-orders / accepting NEW notify-me
 * signups. Existing pre-orders, orders, and checkout are never touched (no
 * §8 "must never" violation). No plan / unlimited plan → never blocked.
 */
import prisma from "../db.server";
import { getPlan } from "./plans.server";
import { getBillingState } from "./billing.server";

export type Usage = {
  planCode: string | null;
  preorders: number;
  preorderLimit: number | null; // null = unlimited
  notify: number;
  notifyLimit: number | null;
  preorderOver: boolean;
  notifyOver: boolean;
};

function monthStartUtc(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

const cache = new Map<string, { at: number; usage: Usage }>();
const TTL = 30_000;

export async function getUsage(shop: string): Promise<Usage> {
  const hit = cache.get(shop);
  if (hit && Date.now() - hit.at < TTL) return hit.usage;

  const since = monthStartUtc();
  const [preorders, notify, bs] = await Promise.all([
    prisma.preOrder.count({ where: { shop, createdAt: { gte: since } } }),
    prisma.waitlistSubscription.count({ where: { shop, createdAt: { gte: since } } }),
    getBillingState(shop),
  ]);
  const plan = bs?.planCode ? await getPlan(bs.planCode) : null;
  const preorderLimit = plan?.preorderLimit ?? null;
  const notifyLimit = plan?.notifyLimit ?? null;

  const usage: Usage = {
    planCode: bs?.planCode ?? null,
    preorders,
    preorderLimit,
    notify,
    notifyLimit,
    preorderOver: preorderLimit != null && preorders >= preorderLimit,
    notifyOver: notifyLimit != null && notify >= notifyLimit,
  };
  cache.set(shop, { at: Date.now(), usage });
  return usage;
}

export async function isOverPreorderLimit(shop: string): Promise<boolean> {
  return (await getUsage(shop)).preorderOver;
}

export async function isOverNotifyLimit(shop: string): Promise<boolean> {
  return (await getUsage(shop)).notifyOver;
}
