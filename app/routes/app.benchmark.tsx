/**
 * Pilot benchmark (§3.5) — the recovered-demand scorecard vs the incumbent.
 * Read-only metrics from benchmark.server + a saved incumbent baseline so the
 * pilot can prove the waitlist→purchase lift and the zero-incident bar.
 */
import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { CartIcon, CashDollarIcon, ChartVerticalIcon } from "@shopify/polaris-icons";
import { AppPage, MetricStrip } from "../components/ui";
import { flag, val, useLinkProps } from "../components/wc";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { getBenchmark } from "../services/benchmark.server";
import { saveSettingsSection } from "../models/settings.server";
import { formatGmv } from "../lib/format";
import { getShopCurrency } from "../models/shop.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [benchmark, currency] = await Promise.all([
    getBenchmark(session.shop),
    getShopCurrency(admin, session.shop),
  ]);
  return { ...benchmark, currency };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  if (fd.get("intent") === "save_baseline") {
    await saveSettingsSection(session.shop, "benchmark", {
      incumbentName: String(fd.get("incumbentName") ?? "").trim(),
      incumbentConversionRate: String(fd.get("incumbentConversionRate") ?? "").trim(),
    });
    return { ok: true };
  }
  return { ok: false };
};

export const headers: HeadersFunction = (h) => boundary.headers(h);

const pctText = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);

export default function BenchmarkPage() {
  const { t, locale } = useLocale();
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const link = useLinkProps();
  const [name, setName] = useState(data.incumbent.name);
  const [rate, setRate] = useState(
    data.incumbent.conversionRate == null ? "" : String((data.incumbent.conversionRate * 100).toFixed(1)),
  );

  const lift = data.liftPoints;
  const liftTone: "success" | "critical" | undefined =
    lift == null || lift === 0 ? undefined : lift > 0 ? "success" : "critical";
  const liftText = lift == null ? "—" : `${lift > 0 ? "+" : ""}${lift} pts`;
  const clean = data.reliability.oversellIncidents === 0 && data.reliability.untaggedOrders === 0;
  const noData =
    data.waitlist.sent === 0 &&
    data.waitlist.converted === 0 &&
    data.preorder.units === 0 &&
    data.preorder.gmv === 0;

  const exportCsv = () => {
    const rows = [
      ["metric", "value"],
      ["waitlist_notified", String(data.waitlist.sent)],
      ["waitlist_converted", String(data.waitlist.converted)],
      ["encore_conversion_rate", pctText(data.waitlist.conversionRate)],
      ["incumbent", data.incumbent.name || "—"],
      ["incumbent_conversion_rate", pctText(data.incumbent.conversionRate)],
      ["lift_points", lift == null ? "—" : String(lift)],
      ["preorder_units", String(data.preorder.units)],
      ["preorder_gmv", formatGmv(Math.round(data.preorder.gmv * 100), data.currency, locale)],
      ["oversell_incidents", String(data.reliability.oversellIncidents)],
      ["untagged_orders", String(data.reliability.untaggedOrders)],
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "encore-benchmark.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppPage
      heading={t("Benchmark")}
      breadcrumb={{ label: t("Insights"), to: "/app/insights" }}
      intro={t("How much demand Encore recovers for your store — at a glance.")}
      secondaryActions={[
        <s-button key="export" icon="export" onClick={exportCsv}>
          {t("Export CSV")}
        </s-button>,
      ]}
    >
        {noData ? (
          <s-section>
            <s-empty-state heading={t("Nothing to score yet")}>
              <s-paragraph slot="subheading">
                {t("Your recovered-demand scorecard fills in after your first back-in-stock alerts convert to orders — set up the waitlist to start capturing demand.")}
              </s-paragraph>
              <s-button slot="primary-action" variant="primary" {...link("/app/waitlist")}>
                {t("Set up back-in-stock")}
              </s-button>
            </s-empty-state>
          </s-section>
        ) : (
          <MetricStrip
            metrics={[
              {
                icon: ChartVerticalIcon,
                tone: "sky",
                label: t("Waitlist conversion"),
                value: pctText(data.waitlist.conversionRate),
                sub: `${data.waitlist.converted} / ${data.waitlist.sent} ${t("notified")}`,
              },
              { icon: CartIcon, tone: "teal", label: t("Units captured"), value: data.preorder.units.toLocaleString(), sub: t("preorders") },
              {
                icon: CashDollarIcon,
                tone: "emerald",
                label: t("GMV captured"),
                value: formatGmv(Math.round(data.preorder.gmv * 100), data.currency, locale),
                sub: t("preorder value"),
              },
            ]}
          />
        )}

        <div className="encore-layout">
          <s-section>
            <s-stack direction="block" gap="base">
              <div className="encore-row-between">
                <s-heading>{t("Compare with your previous app")}</s-heading>
                <s-badge tone={liftTone ?? "auto"}>{`${t("Lift")} ${liftText}`}</s-badge>
              </div>
              <s-text color="subdued" fontSize="small">
                {t("Enter your previous app's waitlist-to-purchase rate to see Encore's lift against that baseline.")}
              </s-text>
              <s-divider />
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="save_baseline" />
                <s-grid gridTemplateColumns="1fr 1fr auto" gap="base" alignItems="end">
                  <s-text-field
                    label={t("Previous app name")}
                    name="incumbentName"
                    value={name}
                    onInput={(e) => setName(val(e))}
                    placeholder="e.g. Globo / Notify Me"
                  />
                  <s-number-field
                    label={t("Previous app conversion rate (%)")}
                    name="incumbentConversionRate"
                    value={rate}
                    onInput={(e) => setRate(val(e))}
                    suffix="%"
                    min={0}
                    max={100}
                    step={0.1}
                  />
                  <s-button type="submit" variant="primary" loading={flag(fetcher.state !== "idle")}>
                    {t("Save baseline")}
                  </s-button>
                </s-grid>
              </fetcher.Form>
            </s-stack>
          </s-section>

          <s-section heading={t("Zero-incident proof")}>
            <s-stack direction="block" gap="base">
              <div className="encore-row-between">
                <s-text>{t("Oversell incidents")}</s-text>
                <s-badge tone={data.reliability.oversellIncidents === 0 ? "success" : "critical"}>
                  {String(data.reliability.oversellIncidents)}
                </s-badge>
              </div>
              <div className="encore-row-between">
                <s-text>{t("Untagged orders")}</s-text>
                <s-badge tone={data.reliability.untaggedOrders === 0 ? "success" : "critical"}>
                  {String(data.reliability.untaggedOrders)}
                </s-badge>
              </div>
              {!clean && (
                <s-banner tone="critical">{t("A reliability issue is open — resolve it before relying on these numbers.")}</s-banner>
              )}
            </s-stack>
          </s-section>
        </div>
    </AppPage>
  );
}
