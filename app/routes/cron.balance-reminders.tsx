/**
 * POST /cron/balance-reminders — charge-later balance-due reminders (N1b).
 *
 * For every installed shop, remind pre-order customers whose deposit / charge-
 * later balance has entered the capture window (once each, idempotent via
 * PreOrder.balanceRemindedAt). The actual charge is Shopify-native (the selling
 * plan's billing policy) — this only sends the heads-up.
 *
 * Token-guarded for an external scheduler (run daily/hourly):
 *   Authorization: Bearer $ENCORE_CRON_SECRET   (or ?token=$ENCORE_CRON_SECRET)
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { remindBalancesDue } from "../services/notify-events.server";

function authorized(request: Request): boolean {
  const secret = process.env.ENCORE_CRON_SECRET ?? "";
  if (!secret) return false;
  const tokenParam = new URL(request.url).searchParams.get("token");
  const bearer = (request.headers.get("Authorization") || "").match(
    /^Bearer\s+(.+)$/i,
  )?.[1];
  return tokenParam === secret || bearer === secret;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });

  const shops = await prisma.session.findMany({
    distinct: ["shop"],
    select: { shop: true },
  });
  let reminded = 0;
  for (const s of shops) {
    reminded += await remindBalancesDue(s.shop).catch((e) => {
      console.error("[balance-reminders]", s.shop, e);
      return 0;
    });
  }
  console.log(
    `[balance-reminders] ${reminded} reminder(s) across ${shops.length} shop(s)`,
  );
  return Response.json({ shops: shops.length, reminded });
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
  return Response.json({ ok: true, hint: "POST to run balance-due reminders" });
};
