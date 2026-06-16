/**
 * Per-customer notification dispatch for ship-date updates + balance-due
 * reminders (N1b). Routes by the merchant's provider exactly like the
 * back-in-stock path: a Klaviyo event (+ editable copy props) or a per-customer
 * Flow trigger the merchant's workflow turns into an email.
 */
import prisma from "../db.server";
import {
  getNotificationSettings,
  resolveTemplate,
  type MessageType,
  type NotificationProvider,
} from "./notifications.server";
import { emitFlow, FLOW_SHIP_DATE_UPDATED, FLOW_BALANCE_DUE } from "./flow.server";
import { klaviyoEvent } from "./klaviyo.server";

async function dispatchOne(
  shop: string,
  provider: NotificationProvider,
  type: MessageType,
  flowHandle: string,
  klaviyoMetric: string,
  email: string,
  locale: string,
  vars: Record<string, string>,
): Promise<void> {
  if (!email || provider === "off") return;
  const copy = await resolveTemplate(shop, type, locale || "en", vars);
  if (provider === "klaviyo") {
    await klaviyoEvent(shop, klaviyoMetric, email, {
      ...vars,
      EmailSubject: copy.subject,
      EmailBody: copy.body,
      Source: "Encore",
    });
  } else {
    await emitFlow(shop, flowHandle, { email, locale: locale || "en", ...vars });
  }
}

// PreOrder.balanceRemindedAt arrives via `prisma db push`; reach the new field +
// the campaign relation through a narrow cast.
const po = prisma as unknown as {
  preOrder: {
    findMany(a: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<
      Array<{
        id: string;
        customerEmail: string;
        customerName: string | null;
        orderRef: string | null;
        locale: string | null;
        balanceAmount: number | null;
        campaign?: {
          name?: string | null;
          shipDate?: Date | null;
          balanceCaptureDays?: number | null;
        } | null;
      }>
    >;
    update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
};

/** A campaign's ship date changed → notify each distinct pre-order customer. */
export async function notifyShipDateChanged(
  shop: string,
  campaignId: string,
  productName: string,
  oldShipDate: string,
  newShipDate: string,
): Promise<number> {
  const ns = await getNotificationSettings(shop);
  if (ns.provider === "off") return 0;

  const rows = await po.preOrder.findMany({
    where: { shop, campaignId },
    select: { id: true, customerEmail: true, customerName: true, orderRef: true, locale: true },
  });

  const seen = new Set<string>();
  let n = 0;
  for (const r of rows) {
    const email = (r.customerEmail || "").trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    await dispatchOne(
      shop,
      ns.provider,
      "ship_date_update",
      FLOW_SHIP_DATE_UPDATED,
      "Encore Ship Date Updated",
      email,
      r.locale || "en",
      {
        customer_name: r.customerName || "there",
        product: productName,
        old_ship_date: oldShipDate,
        new_ship_date: newShipDate,
        order_name: r.orderRef || "",
      },
    );
    n += 1;
  }
  return n;
}

/**
 * Balance-due reminders for one shop: pre-orders with an unpaid balance that have
 * entered the balance window (`balanceCaptureDays` before ship), reminded once.
 * The actual charge is Shopify-native (the selling plan's billing policy); this
 * only sends the heads-up + payment context.
 */
export async function remindBalancesDue(shop: string): Promise<number> {
  const ns = await getNotificationSettings(shop);
  if (ns.provider === "off") return 0;

  const now = Date.now();
  const rows = await po.preOrder.findMany({
    where: {
      shop,
      balanceRemindedAt: null,
      paymentStatus: { in: ["DEPOSIT_PAID", "BALANCE_PENDING"] },
      balanceAmount: { gt: 0 },
    },
    select: {
      id: true,
      customerEmail: true,
      customerName: true,
      orderRef: true,
      locale: true,
      balanceAmount: true,
      campaign: { select: { name: true, shipDate: true, balanceCaptureDays: true } },
    },
  });

  let n = 0;
  for (const r of rows) {
    const ship = r.campaign?.shipDate ? new Date(r.campaign.shipDate).getTime() : null;
    const days = r.campaign?.balanceCaptureDays ?? 7;
    // Only once we're inside the balance window.
    if (ship == null || now < ship - days * 86400000) continue;
    const email = (r.customerEmail || "").trim();
    if (!email) continue;

    await dispatchOne(
      shop,
      ns.provider,
      "balance_due",
      FLOW_BALANCE_DUE,
      "Encore Balance Due",
      email,
      r.locale || "en",
      {
        customer_name: r.customerName || "there",
        product: r.campaign?.name || "your pre-order",
        balance: (r.balanceAmount ?? 0).toFixed(2),
        due_date: new Date(ship).toISOString().slice(0, 10),
        pay_link: "",
        order_name: r.orderRef || "",
      },
    );
    await po.preOrder.update({
      where: { id: r.id },
      data: { balanceRemindedAt: new Date() },
    });
    n += 1;
  }
  return n;
}
