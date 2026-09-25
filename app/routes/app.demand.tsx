import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppPage } from "../components/ui";
import { val } from "../components/wc";
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
      <AppPage heading={t("Demand signal")} breadcrumb={{ label: t("Insights"), to: "/app/insights" }}>
          <s-section>
            <s-empty-state heading={t("No demand captured yet")}>
              <s-paragraph slot="subheading">
                {t("Enable preorder or back-in-stock to start collecting the demand signal.")}
              </s-paragraph>
            </s-empty-state>
          </s-section>
      </AppPage>
    );
  }

  return (
    <AppPage
      heading={t("Demand signal")}
      breadcrumb={{ label: t("Insights"), to: "/app/insights" }}
      intro={t("How many shoppers want each product — preorder intent + waitlist. A signal to size reorders, not a forecast.")}
      secondaryActions={[
        <s-button key="export" icon="export" onClick={exportCsv}>
          {t("common.export")}
        </s-button>,
      ]}
    >
        {markets.length > 1 && (
          <s-section>
            <s-select label={t("Market")} value={market} onChange={(e) => setMarket(val(e))}>
              <s-option value="ALL">{t("All markets")}</s-option>
              {markets
                .filter((m) => m !== "ALL")
                .map((m) => (
                  <s-option key={m} value={m}>
                    {m}
                  </s-option>
                ))}
            </s-select>
          </s-section>
        )}

        <s-section heading={t("Demand by variant")} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("Product")}</s-table-header>
              <s-table-header>{t("Size")}</s-table-header>
              <s-table-header listSlot="kicker">{t("Market")}</s-table-header>
              <s-table-header format="numeric">{t("Preorder")}</s-table-header>
              <s-table-header format="numeric">{t("Waitlist")}</s-table-header>
              <s-table-header format="numeric">{t("Total")}</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {rows.map((r: DemandRow, i) => (
                <s-table-row key={`${r.productId}:${r.variantId ?? ""}:${i}`}>
                  <s-table-cell>
                    <s-stack direction="block" gap="none">
                      <s-text type="strong">{r.productTitle}</s-text>
                      {r.variantTitle && (
                        <s-text color="subdued" fontSize="small">
                          {r.variantTitle}
                        </s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>{r.size ?? "—"}</s-table-cell>
                  <s-table-cell>
                    <s-badge>{r.market}</s-badge>
                  </s-table-cell>
                  <s-table-cell>{r.preorderUnits}</s-table-cell>
                  <s-table-cell>{r.waitlistCount}</s-table-cell>
                  <s-table-cell>
                    <s-text type="strong">{r.total}</s-text>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>

        <s-section heading={t("Size curve")} subheading={t("Demand across sizes — the reorder-depth view.")}>
          <s-stack direction="block" gap="base">
            {sizeCurve.map((s) => (
              <s-stack key={s.size} direction="inline" gap="base" alignItems="center">
                <div style={{ minWidth: 56 }}>
                  <s-text type="strong">{s.size}</s-text>
                </div>
                <div style={{ flex: 1, background: "var(--s-color-bg-fill-secondary, #f1f1f1)", borderRadius: 999, height: 14, overflow: "hidden" }}>
                  <div style={{ width: `${Math.round((s.total / sizeMax) * 100)}%`, height: "100%", background: "var(--encore-accent, #5b4fd6)", borderRadius: 999 }} />
                </div>
                <div style={{ minWidth: 40, textAlign: "end" }}>
                  <s-text color="subdued" fontSize="small">
                    {s.total}
                  </s-text>
                </div>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
    </AppPage>
  );
}
