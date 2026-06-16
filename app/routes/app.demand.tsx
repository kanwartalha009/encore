import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  IndexTable,
  EmptyState,
  Select,
  Box,
  Divider,
} from "@shopify/polaris";
import { ExportIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { rollupDemand, type DemandRow } from "../models/demand.server";
import { useLocale } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const demand = await rollupDemand(session.shop);
  return { demand };
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

export default function DemandPage() {
  const { demand } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const { t } = useLocale();

  const markets = useMemo(
    () => Array.from(new Set(demand.map((d: DemandRow) => d.market))),
    [demand],
  );
  const [market, setMarket] = useState<string>("ALL");

  const rows = useMemo(
    () => (market === "ALL" ? demand : demand.filter((d: DemandRow) => d.market === market)),
    [demand, market],
  );

  // Size curve — total demand by size, for the selected market.
  const sizeCurve = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const size = r.size ?? "—";
      m.set(size, (m.get(size) ?? 0) + r.total);
    }
    const arr = Array.from(m.entries()).map(([size, total]) => ({ size, total }));
    arr.sort((a, b) => b.total - a.total);
    return arr;
  }, [rows]);
  const sizeMax = sizeCurve.reduce((a, s) => Math.max(a, s.total), 0) || 1;

  const exportCsv = () => {
    if (typeof document === "undefined") return;
    const header = ["Product", "Variant", "Size", "Market", "Preorder units", "Waitlist", "Total demand"];
    const body = rows.map((r: DemandRow) => [
      r.productTitle,
      r.variantTitle ?? "",
      r.size ?? "",
      r.market,
      r.preorderUnits,
      r.waitlistCount,
      r.total,
    ]);
    const csv = [header, ...body]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "demand-signal.csv";
    a.click();
    URL.revokeObjectURL(url);
    shopify.toast.show(t("Demand exported"));
  };

  if (demand.length === 0) {
    return (
      <Page title={t("Demand signal")}>
        <Card>
          <EmptyState
            heading={t("No demand captured yet")}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>{t("Enable preorder or back-in-stock to start collecting the demand signal.")}</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const tableRows = rows.map((r: DemandRow, i) => (
    <IndexTable.Row id={`${r.productId}:${r.variantId ?? ""}:${i}`} key={i} position={i}>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{r.productTitle}</Text>
          {r.variantTitle && <Text as="span" variant="bodySm" tone="subdued">{r.variantTitle}</Text>}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{r.size ?? "—"}</IndexTable.Cell>
      <IndexTable.Cell><Badge>{r.market}</Badge></IndexTable.Cell>
      <IndexTable.Cell><Text as="span" numeric alignment="end">{r.preorderUnits}</Text></IndexTable.Cell>
      <IndexTable.Cell><Text as="span" numeric alignment="end">{r.waitlistCount}</Text></IndexTable.Cell>
      <IndexTable.Cell><Text as="span" numeric alignment="end" fontWeight="semibold">{r.total}</Text></IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title={t("Demand signal")}
      subtitle={t("How many shoppers want each product — preorder intent + waitlist. A signal to size reorders, not a forecast.")}
      secondaryActions={[{ content: t("common.export"), icon: ExportIcon, onAction: exportCsv }]}
    >
      <BlockStack gap="500">
        {markets.length > 1 && (
          <Card>
            <Select
              label={t("Market")}
              options={[{ label: t("All markets"), value: "ALL" }, ...markets.filter((m) => m !== "ALL").map((m) => ({ label: m, value: m }))]}
              value={market}
              onChange={setMarket}
            />
          </Card>
        )}

        <Card padding="0">
          <Box padding="400">
            <Text as="h2" variant="headingMd">{t("Demand by variant")}</Text>
          </Box>
          <IndexTable
            resourceName={{ singular: "row", plural: "rows" }}
            itemCount={rows.length}
            selectable={false}
            headings={[
              { title: t("Product") },
              { title: t("Size") },
              { title: t("Market") },
              { title: t("Preorder"), alignment: "end" },
              { title: t("Waitlist"), alignment: "end" },
              { title: t("Total"), alignment: "end" },
            ]}
          >
            {tableRows}
          </IndexTable>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("Size curve")}</Text>
            <Text as="p" variant="bodySm" tone="subdued">{t("Demand across sizes — the reorder-depth view.")}</Text>
            <Divider />
            <BlockStack gap="300">
              {sizeCurve.map((s) => (
                <InlineStack key={s.size} gap="300" blockAlign="center" wrap={false}>
                  <Box minWidth="56px"><Text as="span" variant="bodyMd" fontWeight="semibold">{s.size}</Text></Box>
                  <div style={{ flex: 1, background: "#F1F1F1", borderRadius: 999, height: 14, overflow: "hidden" }}>
                    <div style={{ width: `${Math.round((s.total / sizeMax) * 100)}%`, height: "100%", background: "#1A1A1A", borderRadius: 999 }} />
                  </div>
                  <Box minWidth="40px"><Text as="span" variant="bodySm" tone="subdued" alignment="end">{s.total}</Text></Box>
                </InlineStack>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
