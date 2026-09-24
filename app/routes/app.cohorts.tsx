import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { DeliveryIcon, OrderIcon, CartIcon, ClockIcon } from "@shopify/polaris-icons";
import { PageHero, StatCard } from "../components/ui";
import { Tabs, badgeTone, flag } from "../components/wc";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  listCohorts,
  listPreOrders,
  type CohortListRow,
} from "../models/cohorts.server";
import { useLocale } from "../lib/i18n";
import { getShopCurrency } from "../models/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const currency = await getShopCurrency(admin, session.shop);
  const [orders, cohorts] = await Promise.all([
    listPreOrders(session.shop, currency),
    listCohorts(session.shop, currency),
  ]);
  return { orders, cohorts };
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

function cohortTone(
  s: CohortListRow["status"],
): "success" | "warning" | "attention" | undefined {
  switch (s) {
    case "ON_TRACK":
      return "success";
    case "AT_RISK":
      return "warning";
    case "READY_TO_SHIP":
      return "attention";
    default:
      return undefined;
  }
}

const COHORT_STATUS_LABEL: Record<CohortListRow["status"], string> = {
  ON_TRACK: "On track",
  AT_RISK: "At risk",
  READY_TO_SHIP: "Ready to ship",
  SHIPPED: "Shipped",
};

function payTone(
  label: string,
): "success" | "info" | "attention" | "critical" | undefined {
  if (label === "Paid in full") return "success";
  if (label === "Deposit paid") return "info";
  if (label === "Balance due") return "attention";
  if (label === "Payment failed") return "critical";
  return undefined;
}

export default function OrdersPage() {
  const { orders, cohorts } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const { t } = useLocale();
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get("view") === "cohorts" ? 1 : 0);

  const totalUnits = orders.reduce((a, o) => a + o.units, 0);

  const exportOrders = () => {
    if (typeof document === "undefined") return;
    const header = ["Order", "Customer", "Product", "Cohort", "Ship date", "Units", "Amount", "Payment", "Placed"];
    const body = orders.map((o) => [o.orderRef, o.customer, o.product, o.cohort, o.shipDate, o.units, o.amount, o.paymentStatus, o.createdAt]);
    const csv = [header, ...body].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "preorders.csv";
    a.click();
    URL.revokeObjectURL(url);
    shopify.toast.show(t("Orders exported"));
  };

  const orderRows = orders.map((o) => (
    <s-table-row key={o.id}>
      <s-table-cell>
        <s-text type="strong">{o.orderRef}</s-text>
      </s-table-cell>
      <s-table-cell>{o.customer}</s-table-cell>
      <s-table-cell>{o.product}</s-table-cell>
      <s-table-cell>{o.cohort}</s-table-cell>
      <s-table-cell>{o.shipDate}</s-table-cell>
      <s-table-cell>{o.units}</s-table-cell>
      <s-table-cell>{o.amount}</s-table-cell>
      <s-table-cell>
        <s-badge tone={badgeTone(payTone(o.paymentStatus))}>{t(o.paymentStatus)}</s-badge>
      </s-table-cell>
    </s-table-row>
  ));

  const cohortRows = cohorts.map((c) => {
    const pct = c.unitsTarget ? Math.min(100, Math.round((c.unitsSold / c.unitsTarget) * 100)) : null;
    return (
      <s-table-row key={c.id}>
        <s-table-cell>
          <s-stack direction="block" gap="none">
            <s-text type="strong">{c.name}</s-text>
            <s-text color="subdued" fontSize="small">
              {c.campaignName}
            </s-text>
          </s-stack>
        </s-table-cell>
        <s-table-cell>
          <s-badge tone={badgeTone(cohortTone(c.status))}>{t(COHORT_STATUS_LABEL[c.status])}</s-badge>
        </s-table-cell>
        <s-table-cell>{c.shipDate}</s-table-cell>
        <s-table-cell>
          <s-text color="subdued" fontSize="small">
            {c.unitsSold.toLocaleString()}
            {c.unitsTarget ? ` / ${c.unitsTarget.toLocaleString()}` : ""}
            {pct != null ? ` (${pct}%)` : ""}
          </s-text>
        </s-table-cell>
        <s-table-cell>{c.gmv}</s-table-cell>
      </s-table-row>
    );
  });

  return (
    <s-page inlineSize="large">
      <div className="encore-stack">
        <PageHero
          icon={DeliveryIcon}
          tone="violet"
          title={t("orders.title")}
          sub={t("orders.subtitle")}
          actions={
            tab === 0 ? (
              <s-button variant="primary" icon="export" onClick={exportOrders} disabled={flag(orders.length === 0)}>
                {t("Export orders")}
              </s-button>
            ) : undefined
          }
        />
        <div className="encore-grid encore-grid--3">
          <StatCard index={0} icon={OrderIcon} tone="violet" label={t("Preorder orders")} value={orders.length.toLocaleString()} />
          <StatCard index={1} icon={CartIcon} tone="teal" label={t("Units pre-sold")} value={totalUnits.toLocaleString()} />
          <StatCard index={2} icon={ClockIcon} tone="sky" label={t("Cohorts")} value={cohorts.length.toLocaleString()} />
        </div>

        <s-section padding="none">
          <Tabs
            tabs={[
              { id: "orders", content: t("Orders") },
              { id: "cohorts", content: t("Cohorts") },
            ]}
            selected={tab}
            onSelect={setTab}
          />
          {tab === 0 ? (
            orders.length === 0 ? (
              <s-box padding="large">
                <s-empty-state heading={t("No preorder orders yet")}>
                  <s-paragraph slot="subheading">{t("Orders placed on preorder show here, each linked to its cohort.")}</s-paragraph>
                </s-empty-state>
              </s-box>
            ) : (
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">{t("Order")}</s-table-header>
                  <s-table-header listSlot="secondary">{t("Customer")}</s-table-header>
                  <s-table-header>{t("Product")}</s-table-header>
                  <s-table-header listSlot="kicker">{t("Cohort")}</s-table-header>
                  <s-table-header>{t("Ship date")}</s-table-header>
                  <s-table-header format="numeric">{t("Units")}</s-table-header>
                  <s-table-header format="currency">{t("Amount")}</s-table-header>
                  <s-table-header listSlot="inline">{t("Payment")}</s-table-header>
                </s-table-header-row>
                <s-table-body>{orderRows}</s-table-body>
              </s-table>
            )
          ) : cohorts.length === 0 ? (
            <s-box padding="large">
              <s-empty-state heading={t("No cohorts yet")}>
                <s-paragraph slot="subheading">{t("Cohorts are auto-created when you set a ship date on a preorder.")}</s-paragraph>
              </s-empty-state>
            </s-box>
          ) : (
            <s-table>
              <s-table-header-row>
                <s-table-header listSlot="primary">{t("Cohort")}</s-table-header>
                <s-table-header listSlot="inline">{t("Status")}</s-table-header>
                <s-table-header>{t("Ship date")}</s-table-header>
                <s-table-header listSlot="secondary">{t("Progress")}</s-table-header>
                <s-table-header format="currency">{t("GMV")}</s-table-header>
              </s-table-header-row>
              <s-table-body>{cohortRows}</s-table-body>
            </s-table>
          )}
        </s-section>
      </div>
    </s-page>
  );
}
