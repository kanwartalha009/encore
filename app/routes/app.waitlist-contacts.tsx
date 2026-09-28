/**
 * GET /app/waitlist-contacts — every back-in-stock sign-up as rows for the
 * "Export contacts" CSV on the Back in stock page (2026-09-28). Loaded with a
 * fetcher (App Bridge adds the session token); the CSV is built in the
 * browser, like the existing summary export. Includes phone numbers, which
 * Encore doesn't use itself — this is how merchants take them to their own
 * SMS tool. Only this shop's rows; newest first; capped for safety.
 */
import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import type { ContactRow } from "../lib/contacts-shared";

const MAX_ROWS = 50_000;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const subs = await prisma.waitlistSubscription.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: MAX_ROWS,
  });
  const rows: ContactRow[] = subs.map((s) => ({
    signedUp: s.createdAt.toISOString().slice(0, 10),
    email: s.email ?? "",
    phone: s.phone ?? "",
    product: s.productTitle ?? "",
    variant: s.variantTitle ?? "",
    status: !s.subscribed
      ? "unsubscribed"
      : s.convertedAt
        ? "bought"
        : s.notifiedAt
          ? "notified"
          : "waiting",
    // consentAt arrives via `prisma db push` — read through a narrow cast.
    consent: (s as { consentAt?: Date | null }).consentAt ? "yes" : "no",
    language: s.locale ?? "",
    market: s.market ?? "",
  }));
  return Response.json({ rows, truncated: subs.length === MAX_ROWS });
};
