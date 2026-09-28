/**
 * GDPR / privacy-law compliance (§3.4 gate, spec §12).
 *
 * Backs the three mandatory Shopify compliance webhooks and the
 * purge-uninstalled job. Everything is keyed by `shop` (every shop-scoped table
 * carries it — the GDPR purge key) and, for customer requests, by the
 * customer's email, phone, customer id and order ids.
 *
 *   - customers/data_request → exportCustomerData (gather the stored data) and
 *                              deliverDataRequest (email it to the store owner)
 *   - customers/redact       → redactCustomer (delete waitlist PII; strip PII
 *                              from order/accounting rows, keep the row)
 *   - shop/redact + purge-uninstalled → purgeShopData (hard-delete everything
 *                              for the shop)
 *
 * 2026-09-28 (App Store readiness): the shop purge now also covers Klaviyo
 * tokens, billing state, referral codes and delivered Nova outbox rows; the
 * customer redact also matches phone-only sign-ups, `orders_to_redact` and the
 * customer id; the data request is delivered to the store owner instead of
 * only being logged; and a reinstall cancels the pending 48h purge.
 */
import prisma from "../db.server";
import {
  emailForms,
  phonesMatch,
  orderGids,
  customerIdForms,
  type GdprCustomer,
} from "../lib/gdpr-shared";
import { sendEmail, emailTransportConfigured } from "./email.server";
import { getShopContact } from "./shop-contact.server";
import { cancelPendingPurge } from "./purge-stamp.server";

export { cancelPendingPurge } from "./purge-stamp.server";

export { emailForms } from "../lib/gdpr-shared";

// Models added via `prisma db push` — reached through a narrow cast (the
// established pattern, see cron.purge-uninstalled / nova.server).
type CountResult = Promise<{ count: number }>;
const db = prisma as unknown as {
  klaviyoConnection: { deleteMany(a: { where: Record<string, unknown> }): CountResult };
  billingState: { deleteMany(a: { where: Record<string, unknown> }): CountResult };
  novaReferral: { deleteMany(a: { where: Record<string, unknown> }): CountResult };
  novaOutbox: { deleteMany(a: { where: Record<string, unknown> }): CountResult };
  uninstalledShop: {
    findMany(a: { where: Record<string, unknown> }): Promise<{ shop: string; uninstalledAt: Date }[]>;
    update(a: { where: { shop: string }; data: Record<string, unknown> }): Promise<unknown>;
    deleteMany(a: { where: Record<string, unknown> }): CountResult;
  };
};

export type GdprRequest = {
  customer?: GdprCustomer | null;
  /** customers/redact */
  orders_to_redact?: (number | string)[] | null;
  /** customers/data_request */
  orders_requested?: (number | string)[] | null;
};

/**
 * Waitlist rows for this customer: by email (case-insensitive — imports and
 * older sign-ups kept the case as typed), or by phone for phone-only sign-ups.
 * Matched in code because SQLite has no case-insensitive `in`.
 */
async function waitlistRowsFor(shop: string, customer: GdprCustomer | null | undefined) {
  const email = (customer?.email ?? "").trim().toLowerCase();
  const phone = customer?.phone ?? "";
  if (!email && !phone) return [];
  const rows = await prisma.waitlistSubscription.findMany({
    where: { shop },
    select: { id: true, email: true, phone: true },
  });
  return rows.filter(
    (r) => (email && (r.email ?? "").trim().toLowerCase() === email) || (phone && phonesMatch(r.phone, phone)),
  );
}

/** Preorder row ids for the customer's email (case-insensitive) or the listed orders. */
async function preorderIdsFor(
  shop: string,
  customer: GdprCustomer | null | undefined,
  orderIds: string[],
): Promise<string[]> {
  const email = (customer?.email ?? "").trim().toLowerCase();
  if (!email && !orderIds.length) return [];
  const rows = await prisma.preOrder.findMany({
    where: { shop },
    select: { id: true, customerEmail: true, shopifyOrderId: true },
  });
  const orders = new Set(orderIds);
  return rows
    .filter(
      (r) =>
        (email && (r.customerEmail ?? "").trim().toLowerCase() === email) ||
        (r.shopifyOrderId != null && orders.has(r.shopifyOrderId)),
    )
    .map((r) => r.id);
}

// ---- customers/data_request: gather the customer's stored data ----
export async function exportCustomerData(shop: string, req: GdprRequest) {
  const customer = req.customer ?? null;
  const orderIds = orderGids(req.orders_requested);
  const poIds = await preorderIdsFor(shop, customer, orderIds);
  const custIds = customerIdForms(customer?.id);
  const wlIds = (await waitlistRowsFor(shop, customer)).map((r) => r.id);
  const [waitlistSubscriptions, preorders, orderBundles] = await Promise.all([
    wlIds.length ? prisma.waitlistSubscription.findMany({ where: { shop, id: { in: wlIds } } }) : Promise.resolve([]),
    poIds.length ? prisma.preOrder.findMany({ where: { shop, id: { in: poIds } } }) : Promise.resolve([]),
    custIds.length
      ? prisma.orderBundle.findMany({ where: { shop, customerId: { in: custIds } } })
      : Promise.resolve([]),
  ]);
  return {
    shop,
    customer: { id: customer?.id ?? null, email: customer?.email ?? null, phone: customer?.phone ?? null },
    waitlistSubscriptions,
    preorders,
    orderBundles,
    generatedAt: new Date().toISOString(),
  };
}

export type CustomerExport = Awaited<ReturnType<typeof exportCustomerData>>;

/** Plain-text email body for the store owner. Exported for tests. */
export function dataRequestEmailText(data: CustomerExport, requestId: string | null): string {
  const who = data.customer.email || data.customer.phone || String(data.customer.id ?? "unknown");
  return [
    `A customer data request was received for ${data.shop}${requestId ? ` (request ${requestId})` : ""}.`,
    "",
    `Customer: ${who}`,
    `Back-in-stock sign-ups: ${data.waitlistSubscriptions.length}`,
    `Preorder records: ${data.preorders.length}`,
    `Linked order records: ${data.orderBundles.length}`,
    "",
    "Below is everything the Encore app stores about this customer. As the store owner",
    "(the data controller), please pass it on to the customer as part of your response.",
    "",
    JSON.stringify(data, null, 2),
  ].join("\n");
}

/**
 * Deliver a data request to the store owner (Shopify: the app must give the
 * merchant the customer's data). Emails the export to the store's owner email.
 * Never throws — failures are logged with a reason the operator can act on.
 */
export async function deliverDataRequest(
  shop: string,
  req: GdprRequest & { data_request?: { id?: number | string | null } | null },
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const data = await exportCustomerData(shop, req);
    const total = data.waitlistSubscriptions.length + data.preorders.length + data.orderBundles.length;
    console.log(`[gdpr] data_request ${shop}: ${total} record(s)`);
    if (!emailTransportConfigured()) {
      console.error("[gdpr] data_request not emailed: no email transport (ENCORE_EMAIL_API_KEY / ENCORE_EMAIL_FROM)");
      return { ok: false, reason: "no_transport" };
    }
    const contact = await getShopContact(shop);
    const to = contact?.ownerEmail || contact?.contactEmail || "";
    if (!to) {
      console.error(`[gdpr] data_request not emailed: no owner email for ${shop}`);
      return { ok: false, reason: "no_recipient" };
    }
    const reqId = req.data_request?.id != null ? String(req.data_request.id) : null;
    const r = await sendEmail({
      to,
      subject: `Customer data request — Encore (${shop})`,
      text: dataRequestEmailText(data, reqId),
    });
    if (!r.ok) console.error(`[gdpr] data_request email failed: ${r.reason}`);
    return r.ok ? { ok: true } : { ok: false, reason: r.reason };
  } catch (e) {
    console.error("[gdpr] data_request failed", e);
    return { ok: false, reason: String(e) };
  }
}

// ---- customers/redact: delete the customer's PII ----
export async function redactCustomer(
  shop: string,
  req: GdprRequest,
): Promise<{ waitlistDeleted: number; preordersAnonymized: number; bundlesDeleted: number; outboxDeleted: number }> {
  const customer = req.customer ?? null;
  const orderIds = orderGids(req.orders_to_redact);

  // Waitlist rows are pure contact records → delete outright (email or phone).
  const rows = await waitlistRowsFor(shop, customer);
  const wl = rows.length
    ? await prisma.waitlistSubscription.deleteMany({ where: { shop, id: { in: rows.map((r) => r.id) } } })
    : { count: 0 };

  // PreOrder rows are order/accounting records → keep the row, strip the PII.
  // Matches the customer's email AND every order in orders_to_redact.
  const poIds = await preorderIdsFor(shop, customer, orderIds);
  const po = poIds.length
    ? await prisma.preOrder.updateMany({
        where: { shop, id: { in: poIds } },
        data: { customerEmail: "redacted@gdpr.invalid", customerName: null },
      })
    : { count: 0 };

  // Split-cart bundles only link order ids to the customer id → delete.
  const custIds = customerIdForms(customer?.id);
  const ob = custIds.length
    ? await prisma.orderBundle.deleteMany({ where: { shop, customerId: { in: custIds } } })
    : { count: 0 };

  // Delivered / dead Nova outbox copies that still carry the email. PENDING rows
  // are kept so the compliance forward itself still reaches the platform.
  const emails = emailForms(customer?.email);
  const ox = emails.length
    ? await db.novaOutbox
        .deleteMany({
          where: {
            status: { in: ["SENT", "DEAD"] },
            OR: emails.map((e) => ({ body: { contains: JSON.stringify(e) } })),
          },
        })
        .catch((e) => {
          console.error("[gdpr] outbox redact failed", e);
          return { count: 0 };
        })
    : { count: 0 };

  return {
    waitlistDeleted: wl.count,
    preordersAnonymized: po.count,
    bundlesDeleted: ob.count,
    outboxDeleted: ox.count,
  };
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
  const quoted = JSON.stringify(shop); // exact JSON string match, e.g. "a.myshopify.com"

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
  await del("klaviyoConnection", () => db.klaviyoConnection.deleteMany({ where: { shop } }));
  await del("billingState", () => db.billingState.deleteMany({ where: { shop } }));
  await del("novaReferral", () => db.novaReferral.deleteMany({ where: { shop } }));
  // Nova outbox has no shop column: match the shop header / body field. PENDING
  // rows stay so the uninstall / shop-redact forwards still reach the platform.
  await del("novaOutbox", () =>
    db.novaOutbox.deleteMany({
      where: {
        status: { in: ["SENT", "DEAD"] },
        OR: [{ headers: { contains: quoted } }, { body: { contains: quoted } }],
      },
    }),
  );
  await del("session", () => prisma.session.deleteMany({ where: { shop } }));
  return counts;
}

// ---- 48h purge after uninstall (cron route + in-process scheduler) ----
export const PURGE_AFTER_MS = 48 * 60 * 60 * 1000;

/**
 * Purge every shop uninstalled more than 48h ago. A shop that has a session
 * again was reinstalled (uninstall deletes its sessions), so its purge is
 * cancelled instead — belt and braces next to cancelPendingPurge.
 */
export async function purgeDueShops(now = new Date()): Promise<{ shop: string; counts: Record<string, number> }[]> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_MS);
  const due = await db.uninstalledShop.findMany({
    where: { purgedAt: null, uninstalledAt: { lt: cutoff } },
  });
  const results: { shop: string; counts: Record<string, number> }[] = [];
  for (const row of due) {
    const live = await prisma.session.count({ where: { shop: row.shop } });
    if (live > 0) {
      await cancelPendingPurge(row.shop);
      console.log(`[gdpr] purge cancelled for ${row.shop} — reinstalled`);
      continue;
    }
    const counts = await purgeShopData(row.shop);
    await db.uninstalledShop.update({ where: { shop: row.shop }, data: { purgedAt: new Date() } });
    results.push({ shop: row.shop, counts });
  }
  return results;
}

/** Dry run for the cron GET: shops due for purge. */
export async function shopsDueForPurge(now = new Date()): Promise<string[]> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_MS);
  const due = await db.uninstalledShop.findMany({
    where: { purgedAt: null, uninstalledAt: { lt: cutoff } },
  });
  return due.map((d) => d.shop);
}
