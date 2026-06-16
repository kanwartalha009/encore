/**
 * POST /cron/purge-uninstalled — scheduled GDPR purge (§7.4).
 *
 * Hard-deletes all shop-scoped data 48h after uninstall. Idempotent: each
 * UninstalledShop row is purged once, then stamped `purgedAt`. Token-guarded for
 * an external scheduler (the Nova platform cron or any HTTP scheduler):
 *   Authorization: Bearer $ENCORE_CRON_SECRET   (or ?token=$ENCORE_CRON_SECRET)
 * GET is a dry run that lists which shops are due, without deleting.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { purgeShopData } from "../services/gdpr.server";

const PURGE_AFTER_MS = 48 * 60 * 60 * 1000; // 48 hours

type UninstalledRow = { shop: string; uninstalledAt: Date };

const uninstalledShop = (
  prisma as unknown as {
    uninstalledShop: {
      findMany(a: { where: Record<string, unknown> }): Promise<UninstalledRow[]>;
      update(a: {
        where: { shop: string };
        data: Record<string, unknown>;
      }): Promise<unknown>;
    };
  }
).uninstalledShop;

function authorized(request: Request): boolean {
  const secret = process.env.ENCORE_CRON_SECRET ?? "";
  if (!secret) return false;
  const tokenParam = new URL(request.url).searchParams.get("token");
  const bearer = (request.headers.get("Authorization") || "").match(
    /^Bearer\s+(.+)$/i,
  )?.[1];
  return tokenParam === secret || bearer === secret;
}

async function dueShops(): Promise<UninstalledRow[]> {
  const cutoff = new Date(Date.now() - PURGE_AFTER_MS);
  return uninstalledShop.findMany({
    where: { purgedAt: null, uninstalledAt: { lt: cutoff } },
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const due = await dueShops();
  const results: { shop: string; counts: Record<string, number> }[] = [];
  for (const row of due) {
    const counts = await purgeShopData(row.shop);
    await uninstalledShop.update({
      where: { shop: row.shop },
      data: { purgedAt: new Date() },
    });
    results.push({ shop: row.shop, counts });
  }
  console.log(`[purge-uninstalled] purged ${results.length} shop(s)`);
  return Response.json({ purged: results.length, results });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  const due = await dueShops();
  return Response.json({ due: due.map((d) => d.shop) });
};
