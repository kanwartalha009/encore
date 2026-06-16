import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Tabs,
  IndexTable,
  EmptyState,
  Layout,
} from "@shopify/polaris";
import { ExportIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  listCohorts,
  listPreOrders,
  type CohortListRow,
} from "../models/cohorts.server";
import { useLocale } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [orders, cohorts] = await Promise.all([
    listPreOrders(session.shop),
    listCohorts(session.shop),
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

  const orderRows = orders.map((o, i) => (
    <IndexTable.Row id={o.id} key={o.id} position={i}>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">{o.orderRef}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{o.customer}</IndexTable.Cell>
      <IndexTable.Cell>{o.product}</IndexTable.Cell>
      <IndexTable.Cell>{o.cohort}</IndexTable.Cell>
      <IndexTable.Cell>{o.shipDate}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric alignment="end">{o.units}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" numeric alignment="end">{o.amount}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={payTone(o.paymentStatus)}>{t(o.paymentStatus)}</Badge>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  const cohortRows = cohorts.map((c, i) => {
    const pct = c.unitsTarget ? Math.min(100, Math.round((c.unitsSold / c.unitsTarget) * 100)) : null;
    return (
      <IndexTable.Row id={c.id} key={c.id} position={i}>
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">{c.name}</Text>
            <Text as="span" variant="bodySm" tone="subdued">{c.campaignName}</Text>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={cohortTone(c.status)}>{t(COHORT_STATUS_LABEL[c.status])}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{c.shipDate}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {c.unitsSold.toLocaleString()}
            {c.unitsTarget ? ` / ${c.unitsTarget.toLocaleString()}` : ""}
            {pct != null ? ` (${pct}%)` : ""}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" numeric alignment="end">{c.gmv}</Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title={t("orders.title")}
      subtitle={t("orders.subtitle")}
      primaryAction={
        tab === 0
          ? { content: t("Export orders"), icon: ExportIcon, onAction: exportOrders, disabled: orders.length === 0 }
          : undefined
      }
    >
      <BlockStack gap="400">
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{t("Preorder orders")}</Text>
                <Text as="p" variant="heading2xl">{orders.length.toLocaleString()}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{t("Units pre-sold")}</Text>
                <Text as="p" variant="heading2xl">{totalUnits.toLocaleString()}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{t("Cohorts")}</Text>
                <Text as="p" variant="heading2xl">{cohorts.length.toLocaleString()}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        <Card padding="0">
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
              <EmptyState
                heading={t("No preorder orders yet")}
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <p>{t("Orders placed on preorder show here, each linked to its cohort.")}</p>
              </EmptyState>
            ) : (
              <IndexTable
                resourceName={{ singular: "order", plural: "orders" }}
                itemCount={orders.length}
                selectable={false}
                headings={[
                  { title: t("Order") },
                  { title: t("Customer") },
                  { title: t("Product") },
                  { title: t("Cohort") },
                  { title: t("Ship date") },
                  { title: t("Units"), alignment: "end" },
                  { title: t("Amount"), alignment: "end" },
                  { title: t("Payment") },
                ]}
              >
                {orderRows}
              </IndexTable>
            )
          ) : cohorts.length === 0 ? (
            <EmptyState
              heading={t("No cohorts yet")}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>{t("Cohorts are auto-created when you set a ship date on a preorder.")}</p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={{ singular: "cohort", plural: "cohorts" }}
              itemCount={cohorts.length}
              selectable={false}
              headings={[
                { title: t("Cohort") },
                { title: t("Status") },
                { title: t("Ship date") },
                { title: t("Progress") },
                { title: t("GMV"), alignment: "end" },
              ]}
            >
              {cohortRows}
            </IndexTable>
          )}
        </Card>
      </BlockStack>
    </Page>
  );
}
