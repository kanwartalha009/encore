/**
 * GDPR / privacy-law compliance (§3.4 gate, spec §12).
 *
 * Backs the three mandatory Shopify compliance webhooks and the
 * purge-uninstalled job. Everything is keyed by `shop` (every shop-scoped table
 * carries it — the GDPR purge key) and, for customer requests, by email.
 *
 *   - customers/data_request → exportCustomerData (gather the stored PII)
 *   - customers/redact       → redactCustomer (delete waitlist PII; strip PII
 *                              from order/accounting rows, keep the row)
 *   - shop/redact + purge-uninstalled → purgeShopData (hard-delete everything
 *                              for the shop)
 */
import prisma from "../db.server";

function emailForms(email: string): string[] {
  const e = (email ?? "").trim();
  return Array.from(new Set([e, e.toLowerCase()])).filter(Boolean);
}

// ---- customers/data_request: gather the customer's stored data ----
export async function exportCustomerData(shop: string, email: string) {
  const emails = emailForms(email);
  if (emails.length === 0) {
    return { shop, email, waitlistSubscriptions: [], preorders: [], generatedAt: new Date().toISOString() };
  }
  const [waitlistSubscriptions, preorders] = await Promise.all([
    prisma.waitlistSubscription.findMany({ where: { shop, email: { in: emails } } }),
    prisma.preOrder.findMany({ where: { shop, customerEmail: { in: emails } } }),
  ]);
  return {
    shop,
    email,
    waitlistSubscriptions,
    preorders,
    generatedAt: new Date().toISOString(),
  };
}

// ---- customers/redact: delete the customer's PII ----
export async function redactCustomer(
  shop: string,
  email: string,
): Promise<{ waitlistDeleted: number; preordersAnonymized: number }> {
  const emails = emailForms(email);
  if (emails.length === 0) return { waitlistDeleted: 0, preordersAnonymized: 0 };

  // Waitlist rows are pure contact records → delete outright.
  const wl = await prisma.waitlistSubscription.deleteMany({
    where: { shop, email: { in: emails } },
  });
  // PreOrder rows are order/accounting records → keep the row, strip the PII.
  const po = await prisma.preOrder.updateMany({
    where: { shop, customerEmail: { in: emails } },
    data: { customerEmail: "redacted@gdpr.invalid", customerName: null },
  });
  return { waitlistDeleted: wl.count, preordersAnonymized: po.count };
}

// ---- shop/redact + purge-uninstalled: hard-delete all shop-scoped data ----
export async function purgeShopData(shop: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const del = async (label: string, fn: () => Promise<{ count: number }>) => {
    try {
      counts[label] = (await fn()).count;
    } catch (e) {
      console.error(`[gdpr] purge ${label} failed for ${shop}`, e);
      counts[label] = -1;
    }
  };

  // Leaf → root. Relation cascades would cover most of this, but an explicit
  // delete per shop-scoped table is deterministic and self-documenting.
  await del("preOrder", () => prisma.preOrder.deleteMany({ where: { shop } }));
  await del("orderBundle", () => prisma.orderBundle.deleteMany({ where: { shop } }));
  await del("waitlistSubscription", () =>
    prisma.waitlistSubscription.deleteMany({ where: { shop } }),
  );
  await del("demandSignal", () => prisma.demandSignal.deleteMany({ where: { shop } }));
  await del("translation", () => prisma.translation.deleteMany({ where: { shop } }));
  await del("marketRule", () => prisma.marketRule.deleteMany({ where: { shop } }));
  await del("appSettings", () => prisma.appSettings.deleteMany({ where: { shop } }));
  await del("cohort", () => prisma.cohort.deleteMany({ where: { shop } }));
  await del("campaign", () => prisma.campaign.deleteMany({ where: { shop } }));
  await del("session", () => prisma.session.deleteMany({ where: { shop } }));
  return counts;
}
