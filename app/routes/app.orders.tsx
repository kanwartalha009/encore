/**
 * Orders — every Shopify order that carries preorder lines, across all
 * preorders (2026-09-24). Reached from Insights → Orders. Rows fold the
 * per-line PreOrder records back into orders and link to the Shopify admin
 * order page. Filters: payment status, preorder.
 */
import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { val } from "../components/wc";
import { OrderIcon, CashDollarIcon, ClockIcon, CartIcon } from "@shopify/polaris-icons";
import { AppPage, MetricStrip } from "../components/ui";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { listShopOrders } from "../models/orders-view.server";
import { getShopCurrency } from "../models/shop.server";
import { formatGmv } from "../lib/format";
import { OrdersTable, orderAdminUrl, type OrderRowView } from "../components/OrdersTable";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [orders, currency] = await Promise.all([
    listShopOrders(session.shop),
    getShopCurrency(admin, session.shop),
  ]);
  const totalCents = Math.round(orders.reduce((a, o) => a + o.amount, 0) * 100);
  const awaiting = orders.filter(
    (o) => o.paymentStatus === "BALANCE_PENDING" || o.paymentStatus === "BALANCE_FAILED",
  ).length;
  const units = orders.reduce((a, o) => a + o.units, 0);
  return {
    stats: {
      orders: orders.length,
      units,
      gmv: formatGmv(totalCents, currency),
      awaiting,
    },
    orders: orders.map<OrderRowView>((o) => ({
      id: o.id,
      orderRef: o.orderRef,
      shopifyUrl: orderAdminUrl(session.shop, o.shopifyOrderNumericId),
      campaignId: o.campaignId,
      campaignName: o.campaignName,
      customerName: o.customerName,
      customerEmail: o.customerEmail,
      units: o.units,
      amount: formatGmv(Math.round(o.amount * 100), currency),
      paymentStatus: o.paymentStatus,
      shipDate: o.shipDate ? o.shipDate.toISOString().slice(0, 10) : "TBD",
      placedAt: o.placedAt.toISOString().slice(0, 10),
    })),
  };
};

export const headers: HeadersFunction = (h) => boundary.headers(h);

export default function OrdersPage() {
  const { t } = useLocale();
  const { stats, orders } = useLoaderData<typeof loader>();
  const [status, setStatus] = useState("ALL");
  const [campaign, setCampaign] = useState("ALL");

  const campaigns = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) if (o.campaignId && !m.has(o.campaignId)) m.set(o.campaignId, o.campaignName || "—");
    return Array.from(m, ([value, label]) => ({ value, label }));
  }, [orders]);

  const rows = useMemo(
    () =>
      orders.filter(
        (o) =>
          (status === "ALL" ||
            (status === "AWAITING"
              ? o.paymentStatus === "BALANCE_PENDING" || o.paymentStatus === "BALANCE_FAILED"
              : o.paymentStatus === status)) &&
          (campaign === "ALL" || o.campaignId === campaign),
      ),
    [orders, status, campaign],
  );

  return (
    <AppPage
      heading={t("Orders")}
      size="large"
      breadcrumb={{ label: t("Insights"), to: "/app/insights" }}
      intro={t("Every Shopify order that includes a preorder item, with its payment state and ship date.")}
    >
        <MetricStrip
          metrics={[
            { icon: OrderIcon, tone: "violet", label: t("Orders"), value: String(stats.orders) },
            { icon: CartIcon, tone: "teal", label: t("Units"), value: String(stats.units) },
            { icon: CashDollarIcon, tone: "emerald", label: t("Order value"), value: stats.gmv },
            {
              icon: ClockIcon,
              tone: stats.awaiting > 0 ? "amber" : "slate",
              label: t("Awaiting payment"),
              value: String(stats.awaiting),
            },
          ]}
        />
        <s-section padding="none">
          <s-box padding="base">
            <s-stack direction="inline" gap="base" alignItems="end">
              <s-select label={t("Payment")} value={status} onChange={(e) => setStatus(val(e))}>
                <s-option value="ALL">{t("All")}</s-option>
                <s-option value="AWAITING">{t("Awaiting payment")}</s-option>
                <s-option value="DEPOSIT_PAID">{t("Deposit paid")}</s-option>
                <s-option value="BALANCE_PAID">{t("Paid")}</s-option>
                <s-option value="REFUNDED">{t("Refunded")}</s-option>
              </s-select>
              {campaigns.length > 1 && (
                <s-select label={t("Preorder")} value={campaign} onChange={(e) => setCampaign(val(e))}>
                  <s-option value="ALL">{t("All")}</s-option>
                  {campaigns.map((c) => (
                    <s-option key={c.value} value={c.value}>
                      {c.label}
                    </s-option>
                  ))}
                </s-select>
              )}
            </s-stack>
          </s-box>
          <s-divider />
          <OrdersTable orders={rows} showCampaign />
        </s-section>
    </AppPage>
  );
}
