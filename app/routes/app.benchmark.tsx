/**
 * Pilot benchmark (§3.5) — the recovered-demand scorecard vs the incumbent.
 * Read-only metrics from benchmark.server + a saved incumbent baseline so the
 * pilot can prove the waitlist→purchase lift and the zero-incident bar.
 */
import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  TextField,
  Divider,
  Box,
  Banner,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { getBenchmark } from "../services/benchmark.server";
import { saveSettingsSection } from "../models/settings.server";
import { formatGmv } from "../models/campaign.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return getBenchmark(session.shop);
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

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { t } = useLocale();
  return (
    <Card>
      <BlockStack gap="100">
        <Text as="p" variant="bodySm" tone="subdued">{t(label)}</Text>
        <Text as="p" variant="heading2xl">{value}</Text>
        {sub ? <Text as="p" variant="bodySm" tone="subdued">{sub}</Text> : null}
      </BlockStack>
    </Card>
  );
}

export default function BenchmarkPage() {
  const { t } = useLocale();
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [name, setName] = useState(data.incumbent.name);
  const [rate, setRate] = useState(
    data.incumbent.conversionRate == null ? "" : String((data.incumbent.conversionRate * 100).toFixed(1)),
  );

  const lift = data.liftPoints;
  const liftTone: "success" | "critical" | undefined =
    lift == null || lift === 0 ? undefined : lift > 0 ? "success" : "critical";
  const liftText = lift == null ? "—" : `${lift > 0 ? "+" : ""}${lift} pts`;
  const clean = data.reliability.oversellIncidents === 0 && data.reliability.untaggedOrders === 0;

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
      ["preorder_gmv", formatGmv(Math.round(data.preorder.gmv * 100))],
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
    <Page
      title={t("Pilot benchmark")}
      subtitle={t("Recovered demand vs the incumbent — the validation-gate scorecard.")}
      secondaryActions={[{ content: t("Export CSV"), onAction: exportCsv }]}
    >
      <BlockStack gap="500">
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Metric
            label="Waitlist conversion"
            value={pctText(data.waitlist.conversionRate)}
            sub={`${data.waitlist.converted} / ${data.waitlist.sent} ${t("notified")}`}
          />
          <Metric label="Units captured" value={data.preorder.units.toLocaleString()} sub={t("pre-orders")} />
          <Metric label="GMV captured" value={formatGmv(Math.round(data.preorder.gmv * 100))} sub={t("pre-order value")} />
        </InlineGrid>

        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{t("Beat the incumbent")}</Text>
                  <Badge tone={liftTone}>
                    {`${t("Lift")} ${liftText}`}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("Enter the incumbent's waitlist→purchase rate to compute Encore's lift. The gate: Encore beats this baseline.")}
                </Text>
                <Divider />
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="save_baseline" />
                  <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                    <TextField
                      label={t("Incumbent app")}
                      name="incumbentName"
                      value={name}
                      onChange={setName}
                      autoComplete="off"
                      placeholder="e.g. Globo / Notify Me"
                    />
                    <TextField
                      label={t("Incumbent conversion rate (%)")}
                      name="incumbentConversionRate"
                      value={rate}
                      onChange={setRate}
                      type="number"
                      suffix="%"
                      autoComplete="off"
                    />
                    <Box paddingBlockStart="600">
                      <Button submit variant="primary" loading={fetcher.state !== "idle"}>
                        {t("Save baseline")}
                      </Button>
                    </Box>
                  </InlineGrid>
                </fetcher.Form>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{t("Zero-incident proof")}</Text>
                <Divider />
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd">{t("Oversell incidents")}</Text>
                  <Badge tone={data.reliability.oversellIncidents === 0 ? "success" : "critical"}>
                    {String(data.reliability.oversellIncidents)}
                  </Badge>
                </InlineStack>
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd">{t("Untagged orders")}</Text>
                  <Badge tone={data.reliability.untaggedOrders === 0 ? "success" : "critical"}>
                    {String(data.reliability.untaggedOrders)}
                  </Badge>
                </InlineStack>
                {!clean && (
                  <Banner tone="critical">{t("A reliability incident is open — resolve before the gate.")}</Banner>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
