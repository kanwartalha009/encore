/**
 * Insights hub (E1) — one nav destination that consolidates Demand, Benchmark,
 * Low-stock and Cohorts as tabs. Each tab shows the headline metric + opens the
 * full screen. The four original routes stay reachable (no feature loss); the nav
 * simply stops listing them separately.
 *
 * Trap-safe: `.server` model functions are used only in the loader; the component
 * reads `useLoaderData` + Polaris + i18n.
 */
import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Card,
  Tabs,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  InlineGrid,
  Divider,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { rollupDemand } from "../models/demand.server";
import { listCohorts } from "../models/cohorts.server";
import { getBenchmark } from "../services/benchmark.server";
import { getSettings } from "../models/settings.server";
import { getShopCurrency } from "../models/shop.server";
import { formatMoney } from "../lib/format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const [demand, benchmark, cohorts, settings, currency] = await Promise.all([
    rollupDemand(shop),
    getBenchmark(shop),
    listCohorts(shop),
    getSettings(shop),
    getShopCurrency(admin, shop),
  ]);
  const ls = settings.lowStock as Record<string, unknown>;
  return {
    demand: { signals: demand.length },
    benchmark: {
      conversionRate: benchmark.waitlist.conversionRate,
      lift: benchmark.liftPoints,
      units: benchmark.preorder.units,
      gmv: benchmark.preorder.gmv,
    },
    cohorts: { count: cohorts.length },
    lowStock: {
      enabled: ls.enabled === true,
      threshold:
        typeof ls.threshold === "number" ? ls.threshold : Number(ls.threshold ?? 10),
    },
    currency,
  };
};

export const headers: HeadersFunction = (h) => boundary.headers(h);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <BlockStack gap="050">
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
      <Text as="p" variant="headingLg">{value}</Text>
    </BlockStack>
  );
}

/** First-run teaching state for a tab: heading + one line + one action. */
function TabTeachingState({
  heading,
  body,
  actionLabel,
  actionUrl,
}: {
  heading: string;
  body: string;
  actionLabel: string;
  actionUrl: string;
}) {
  return (
    <BlockStack gap="200">
      <Text as="h3" variant="headingSm">{heading}</Text>
      <Text as="p" tone="subdued">{body}</Text>
      <InlineStack>
        <Button variant="primary" url={actionUrl}>{actionLabel}</Button>
      </InlineStack>
    </BlockStack>
  );
}

export default function InsightsPage() {
  const { t, locale } = useLocale();
  const d = useLoaderData<typeof loader>();
  const [selected, setSelected] = useState(0);

  const tabs = [
    { id: "demand", content: t("Demand") },
    { id: "benchmark", content: t("Benchmark") },
    { id: "lowstock", content: t("nav.lowstock") },
    { id: "cohorts", content: t("Cohorts") },
  ];

  const conv =
    d.benchmark.conversionRate == null
      ? "—"
      : `${(d.benchmark.conversionRate * 100).toFixed(1)}%`;
  const lift = d.benchmark.lift == null ? "—" : `${d.benchmark.lift} pts`;

  return (
    <Page title={t("Insights")} subtitle={t("Demand, recovery, cohorts and low-stock in one place.")}>
      <Card>
        <Tabs tabs={tabs} selected={selected} onSelect={setSelected}>
          <BlockStack gap="400">
            {selected === 0 && (
              <>
                {d.demand.signals === 0 ? (
                  <TabTeachingState
                    heading={t("No demand signals yet")}
                    body={t("Demand appears once shoppers view preorder products and join waitlists.")}
                    actionLabel={t("Create a preorder")}
                    actionUrl="/app/campaigns/new"
                  />
                ) : (
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                    <Stat label={t("Demand signals")} value={d.demand.signals.toLocaleString()} />
                  </InlineGrid>
                )}
                <Divider />
                <InlineStack align="end">
                  <Button url="/app/demand">{t("Open full view")}</Button>
                </InlineStack>
              </>
            )}
            {selected === 1 && (
              <>
                {d.benchmark.conversionRate == null &&
                d.benchmark.units === 0 &&
                d.benchmark.gmv === 0 ? (
                  <TabTeachingState
                    heading={t("Your benchmark starts with your first preorders")}
                    body={t("This scorecard fills in after your first preorders and back-in-stock alerts convert to orders.")}
                    actionLabel={t("Create a preorder")}
                    actionUrl="/app/campaigns/new"
                  />
                ) : (
                  <InlineGrid columns={{ xs: 1, sm: 4 }} gap="400">
                    <Stat label={t("Waitlist conversion")} value={conv} />
                    <Stat label={t("Lift")} value={lift} />
                    <Stat label={t("Units captured")} value={d.benchmark.units.toLocaleString()} />
                    <Stat
                      label={t("GMV captured")}
                      value={formatMoney(Math.round(d.benchmark.gmv * 100), d.currency, locale)}
                    />
                  </InlineGrid>
                )}
                <Divider />
                <InlineStack align="end">
                  <Button url="/app/benchmark">{t("Open full view")}</Button>
                </InlineStack>
              </>
            )}
            {selected === 2 && (
              <>
                {!d.lowStock.enabled ? (
                  <TabTeachingState
                    heading={t("Low-stock alerts are off")}
                    body={t("Turn them on and set a threshold to show shoppers when a product is almost gone.")}
                    actionLabel={t("Set your threshold")}
                    actionUrl="/app/low-stock"
                  />
                ) : (
                  <InlineStack gap="300" blockAlign="center">
                    <Badge tone="success">{t("On")}</Badge>
                    <Text as="span" variant="bodyMd">
                      {`${t("Shows when stock ≤")} ${d.lowStock.threshold}`}
                    </Text>
                  </InlineStack>
                )}
                <Divider />
                <InlineStack align="end">
                  <Button url="/app/low-stock">{t("Open full view")}</Button>
                </InlineStack>
              </>
            )}
            {selected === 3 && (
              <>
                {d.cohorts.count === 0 ? (
                  <TabTeachingState
                    heading={t("No cohorts yet")}
                    body={t("Cohorts group preorders by ship date — your first one appears when a preorder goes live.")}
                    actionLabel={t("Create a preorder")}
                    actionUrl="/app/campaigns/new"
                  />
                ) : (
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                    <Stat label={t("Active cohorts")} value={d.cohorts.count.toLocaleString()} />
                  </InlineGrid>
                )}
                <Divider />
                <InlineStack align="end">
                  <Button url="/app/cohorts">{t("Open full view")}</Button>
                </InlineStack>
              </>
            )}
          </BlockStack>
        </Tabs>
      </Card>
    </Page>
  );
}
