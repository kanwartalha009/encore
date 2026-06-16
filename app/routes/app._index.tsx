import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { getDashboard } from "../models/dashboard.server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  ProgressBar,
  Divider,
  Box,
  Icon,
  EmptyState,
  Link,
  Banner,
  Tooltip,
  IndexTable,
  useIndexResourceState,
} from "@shopify/polaris";
import {
  PlusIcon,
  CartIcon,
  CashDollarIcon,
  PackageIcon,
  EmailIcon,
  ArrowRightIcon,
  ChartVerticalIcon,
  ClockIcon,
  CheckIcon,
  AlertCircleIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";

// ---------- View-model helpers ----------
type Cohort = {
  id: string;
  name: string;
  shipDate: string;
  unitsSold: number;
  unitsForecast: number;
  gmv: string;
  status: "On track" | "At risk" | "Ready to ship";
};

type CampaignRow = {
  id: string;
  product: string;
  trigger: string;
  payment: string;
  units: string;
  shipDate: string;
  status: "Live" | "Scheduled" | "Paused" | "Ended" | "Draft";
};

const KPI_ICONS = [
  CashDollarIcon,
  ChartVerticalIcon,
  PackageIcon,
  EmailIcon,
] as const;

// Activity feed is event-log driven; until we wire that up, surface a small
// curated list so the panel isn't empty on first install.
const FALLBACK_ACTIVITY = [
  {
    icon: CheckIcon,
    text: "Welcome to Preorder Novafied",
    detail: "Create your first campaign to start capturing preorders.",
    time: "now",
  },
];

// ---------- Loader / headers ----------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const data = await getDashboard(session.shop);
  return data;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// ---------- Helpers ----------
function statusToTone(
  status: Cohort["status"] | CampaignRow["status"],
): "success" | "warning" | "info" | "attention" | undefined {
  switch (status) {
    case "On track":
    case "Live":
      return "success";
    case "At risk":
    case "Paused":
      return "warning";
    case "Ready to ship":
      return "attention";
    case "Scheduled":
      return "info";
    case "Draft":
    case "Ended":
    default:
      return undefined;
  }
}

// ---------- Sub-components ----------
function KpiCard({
  label,
  value,
  delta,
  deltaTone,
  icon,
  sub,
}: {
  label: string;
  value: string;
  delta: string;
  deltaTone: "success" | "critical" | "subdued";
  icon: typeof CashDollarIcon;
  sub: string;
}) {
  const { t } = useLocale();
  const deltaColor =
    deltaTone === "success"
      ? "success"
      : deltaTone === "critical"
        ? "critical"
        : "subdued";

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" variant="bodySm" tone="subdued">{t(label)}</Text>
          <Box>
            <Icon source={icon} tone="subdued" />
          </Box>
        </InlineStack>
        <Text as="p" variant="heading2xl">
          {value}
        </Text>
        <InlineStack gap="200" blockAlign="center">
          <Text as="span" variant="bodySm" tone={deltaColor as never}>
            {delta}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">{t(sub)}</Text>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function ReliabilityStat({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert: boolean;
}) {
  const { t } = useLocale();
  return (
    <BlockStack gap="100">
      <InlineStack gap="150" blockAlign="center">
        <Icon
          source={alert ? AlertCircleIcon : CheckIcon}
          tone={alert ? "critical" : "success"}
        />
        <Text as="span" variant="headingLg">
          {value}
        </Text>
      </InlineStack>
      <Text as="span" variant="bodySm" tone="subdued">
        {t(label)}
      </Text>
    </BlockStack>
  );
}

function ReliabilityBar({
  r,
}: {
  r: {
    oversellIncidents: number;
    untaggedOrders: number;
    waitlistDeliveryRate: number | null;
    waitlistFailed: number;
    clean: boolean;
  };
}) {
  const { t } = useLocale();
  const delivery =
    r.waitlistDeliveryRate == null
      ? "—"
      : `${Math.round(r.waitlistDeliveryRate * 100)}%`;
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <BlockStack gap="050">
            <Text as="h2" variant="headingMd">
              {t("Reliability")}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t("The 'must never' guarantees — measured, not estimated.")}
            </Text>
          </BlockStack>
          <Badge tone={r.clean ? "success" : "critical"}>
            {r.clean ? t("All clear") : t("Needs attention")}
          </Badge>
        </InlineStack>
        <Divider />
        <InlineStack gap="1200" blockAlign="center">
          <ReliabilityStat
            label="Oversell incidents"
            value={String(r.oversellIncidents)}
            alert={r.oversellIncidents > 0}
          />
          <ReliabilityStat
            label="Untagged orders"
            value={String(r.untaggedOrders)}
            alert={r.untaggedOrders > 0}
          />
          <ReliabilityStat
            label="Waitlist delivery"
            value={delivery}
            alert={r.waitlistFailed > 0}
          />
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function CohortRow({ cohort }: { cohort: Cohort }) {
  const { t } = useLocale();
  const pct = Math.min(
    100,
    Math.round((cohort.unitsSold / cohort.unitsForecast) * 100),
  );
  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="050">
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {cohort.name}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {cohort.shipDate} · {cohort.gmv} {t("pre-sold")}
          </Text>
        </BlockStack>
        <Badge tone={statusToTone(cohort.status)}>{t(cohort.status)}</Badge>
      </InlineStack>
      <ProgressBar progress={pct} size="small" tone="primary" />
      <InlineStack align="space-between">
        <Text as="span" variant="bodySm" tone="subdued">
          {cohort.unitsSold.toLocaleString()} / {cohort.unitsForecast.toLocaleString()} {t("units")}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {pct}%
        </Text>
      </InlineStack>
    </BlockStack>
  );
}

type ActivityItem = {
  icon: typeof CashDollarIcon;
  text: string;
  detail: string;
  time: string;
};

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const { t } = useLocale();
  if (items.length === 0) return null;
  return (
    <BlockStack gap="300">
      {items.map((a, i) => (
        <InlineStack key={i} gap="300" blockAlign="start" wrap={false}>
          <Box
            background="bg-surface-secondary"
            padding="150"
            borderRadius="200"
          >
            <Icon source={a.icon} tone="subdued" />
          </Box>
          <BlockStack gap="050">
            <Text as="p" variant="bodyMd">
              {t(a.text)}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {t(a.detail)}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {a.time}
            </Text>
          </BlockStack>
        </InlineStack>
      ))}
    </BlockStack>
  );
}

function CampaignsTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const { t } = useLocale();
  const resourceName = { singular: "campaign", plural: "campaigns" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(campaigns.map((c) => ({ id: c.id })) as never);

  const rows = campaigns.map((c, index) => (
    <IndexTable.Row
      id={c.id}
      key={c.id}
      position={index}
      selected={selectedResources.includes(c.id)}
    >
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd" fontWeight="semibold">
          {c.product}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>{t(c.trigger)}</IndexTable.Cell>
      <IndexTable.Cell>{t(c.payment)}</IndexTable.Cell>
      <IndexTable.Cell>{c.units}</IndexTable.Cell>
      <IndexTable.Cell>{c.shipDate}</IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={statusToTone(c.status)}>{t(c.status)}</Badge>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <IndexTable
      resourceName={resourceName}
      itemCount={campaigns.length}
      selectedItemsCount={
        allResourcesSelected ? "All" : selectedResources.length
      }
      onSelectionChange={handleSelectionChange}
      headings={[
        { title: t("Product") },
        { title: t("Trigger") },
        { title: t("Payment") },
        { title: t("Units") },
        { title: t("Ship date") },
        { title: t("Status") },
      ]}
    >
      {rows}
    </IndexTable>
  );
}

// ---------- Page ----------
export default function DashboardIndex() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const data = useLoaderData<typeof loader>();
  const KPIS = data.kpis.map((k, i) => ({
    ...k,
    icon: KPI_ICONS[i] ?? CashDollarIcon,
  }));
  const COHORTS: Cohort[] = data.cohorts.map((c) => ({
    id: c.id,
    name: c.name,
    shipDate: c.shipDate,
    unitsSold: c.unitsSold,
    unitsForecast: c.unitsTarget,
    gmv: c.gmv,
    status: c.status,
  }));
  const CAMPAIGNS: CampaignRow[] = data.campaigns;
  const ACTIVITY = data.activity.length
    ? data.activity.map((a) => ({
        icon: CheckIcon,
        text: a.text,
        detail: a.detail,
        time: a.time,
      }))
    : FALLBACK_ACTIVITY;

  return (
    <Page
      title="Preorder Novafied"
      subtitle={t("Preorders, cohorts, and back-in-stock at a glance.")}
      primaryAction={{
        content: t("New preorder"),
        icon: PlusIcon,
        onAction: () => navigate("/app/campaigns/new"),
      }}
      secondaryActions={[
        {
          content: t("Cohorts"),
          onAction: () => navigate("/app/cohorts?view=cohorts"),
        },
        {
          content: t("Back in stock"),
          onAction: () => navigate("/app/waitlist"),
        },
        {
          content: t("Settings"),
          onAction: () => navigate("/app/settings"),
        },
      ]}
    >
      <BlockStack gap="500">
        {/* Onboarding banner — shown only on fresh installs in real impl */}
        <Banner
          title={t("Welcome to Preorder Novafied")}
          tone="info"
          onDismiss={() => {}}
          action={{
            content: t("Set up your first preorder"),
            onAction: () => navigate("/app/campaigns/new"),
          }}
          secondaryAction={{
            content: t("Read the docs"),
            url: "https://docs.preordernovafied.app",
            external: true,
          }}
        >
          <p>{t("Preorders are set up at the variant level. Pick variants, set units, set a ship date — that's it. Customers pay full at checkout by default; toggle deposit or pay-later inside any preorder.")}</p>
        </Banner>

        {/* KPI tiles */}
        <Layout>
          {KPIS.map((kpi) => (
            <Layout.Section key={kpi.label} variant="oneThird">
              <KpiCard {...kpi} />
            </Layout.Section>
          ))}
        </Layout>

        {/* Reliability bar — §8 'must never' guarantees, from real audits */}
        <ReliabilityBar r={data.reliability} />

        {/* Cohorts + activity */}
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd">{t("Active cohorts")}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{t("Group of preorders sharing a ship date.")}</Text>
                  </BlockStack>
                  <Button
                    variant="plain"
                    onClick={() => navigate("/app/cohorts")}
                    icon={ArrowRightIcon}>{t("View all")}</Button>
                </InlineStack>
                <Divider />
                <BlockStack gap="500">
                  {COHORTS.map((c, i) => (
                    <BlockStack key={c.id} gap="500">
                      <CohortRow cohort={c} />
                      {i < COHORTS.length - 1 && <Divider />}
                    </BlockStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{t("Recent activity")}</Text>
                  <Tooltip content={t("Auto-refreshes every 60 seconds.")}>
                    <Icon source={ClockIcon} tone="subdued" />
                  </Tooltip>
                </InlineStack>
                <Divider />
                <ActivityFeed items={ACTIVITY} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Campaigns table */}
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd">{t("Preorders")}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{t("Variant-level preorder rules.")}</Text>
                  </BlockStack>
                  <Button
                    variant="primary"
                    icon={PlusIcon}
                    onClick={() => navigate("/app/campaigns/new")}>{t("New preorder")}</Button>
                </InlineStack>
              </Box>
              <Divider />
              {CAMPAIGNS.length === 0 ? (
                <Box padding="600">
                  <EmptyState
                    heading={t("No preorders yet")}
                    action={{
                      content: t("Set up your first preorder"),
                      onAction: () => navigate("/app/campaigns/new"),
                    }}
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>{t("Pre-sell upcoming launches, capture demand on sold-out SKUs, or build a back-in-stock waitlist.")}</p>
                  </EmptyState>
                </Box>
              ) : (
                <CampaignsTable campaigns={CAMPAIGNS} />
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
