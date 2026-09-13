import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { getDashboard } from "../models/dashboard.server";
import { getShopCurrency } from "../models/shop.server";
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
  EmptyState,
  Banner,
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
  CheckIcon,
  AlertCircleIcon,
  ClockIcon,
  NotificationIcon,
  ChartLineIcon,
  SettingsIcon,
  ShieldCheckMarkIcon,
  OrderIcon,
  DeliveryIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { statusToTone } from "../lib/format";
import {
  StatCard,
  QuickAction,
  SectionHead,
  ProgressRing,
  IconTile,
  Reveal,
  Hero,
  HeroButton,
  type TileTone,
} from "../components/ui";

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
const KPI_TONES: TileTone[] = ["emerald", "violet", "amber", "sky"];

// Activity feed is event-log driven; until we wire that up, surface a small
// curated list so the panel isn't empty on first install.
const FALLBACK_ACTIVITY = [
  {
    icon: CheckIcon,
    text: "Welcome to Encore",
    detail: "Create your first preorder to start capturing revenue.",
    time: "now",
  },
];

// ---------- Loader / headers ----------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // A6: money renders in the SHOP's currency, not a hardcoded USD.
  const currency = await getShopCurrency(admin, session.shop);
  const data = await getDashboard(session.shop, currency);
  return data;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// ---------- Helpers ----------
// ---------- Sub-components ----------
function ReliabilityStat({
  label,
  value,
  alert,
  icon,
}: {
  label: string;
  value: string;
  alert: boolean;
  icon: typeof CashDollarIcon;
}) {
  const { t } = useLocale();
  return (
    <InlineStack gap="300" blockAlign="center">
      <IconTile icon={alert ? AlertCircleIcon : icon} tone={alert ? "rose" : "emerald"} />
      <BlockStack gap="050">
        <Text as="span" variant="headingLg">
          {value}
        </Text>
        <Text as="span" variant="bodySm" tone="subdued">
          {t(label)}
        </Text>
      </BlockStack>
    </InlineStack>
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
        <SectionHead
          icon={ShieldCheckMarkIcon}
          tone={r.clean ? "emerald" : "rose"}
          title={t("Reliability")}
          sub={t("The 'must never' guarantees — measured, not estimated.")}
          action={
            <Badge tone={r.clean ? "success" : "critical"}>
              {r.clean ? t("All clear") : t("Needs attention")}
            </Badge>
          }
        />
        <Divider />
        <InlineStack gap="1200" blockAlign="center" wrap>
          <ReliabilityStat
            label="Oversell incidents"
            value={String(r.oversellIncidents)}
            alert={r.oversellIncidents > 0}
            icon={ShieldCheckMarkIcon}
          />
          <ReliabilityStat
            label="Untagged orders"
            value={String(r.untaggedOrders)}
            alert={r.untaggedOrders > 0}
            icon={OrderIcon}
          />
          <ReliabilityStat
            label="Waitlist delivery"
            value={delivery}
            alert={r.waitlistFailed > 0}
            icon={EmailIcon}
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
    Math.round((cohort.unitsSold / Math.max(1, cohort.unitsForecast)) * 100),
  );
  const ringTone: TileTone =
    cohort.status === "At risk" ? "amber" : cohort.status === "Ready to ship" ? "emerald" : "violet";
  return (
    <InlineStack gap="400" blockAlign="center" wrap={false}>
      <ProgressRing percent={pct} tone={ringTone} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <BlockStack gap="150">
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
          <Text as="span" variant="bodySm" tone="subdued">
            {cohort.unitsSold.toLocaleString()} / {cohort.unitsForecast.toLocaleString()} {t("units")}
          </Text>
        </BlockStack>
      </div>
    </InlineStack>
  );
}

type ActivityItem = {
  icon: typeof CashDollarIcon;
  text: string;
  detail: string;
  time: string;
};

const ACTIVITY_TONES: TileTone[] = ["violet", "teal", "amber", "sky", "rose", "emerald"];

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const { t } = useLocale();
  return (
    <BlockStack gap="400">
      {items.map((a, i) => (
        <Reveal key={`${a.text}-${i}`} index={i}>
          <InlineStack gap="300" blockAlign="start" wrap={false}>
            <IconTile icon={a.icon} tone={ACTIVITY_TONES[i % ACTIVITY_TONES.length]} size="sm" />
            <BlockStack gap="050">
              <Text as="p" variant="bodyMd" fontWeight="medium">
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
        </Reveal>
      ))}
    </BlockStack>
  );
}

function CampaignsTable({ campaigns }: { campaigns: CampaignRow[] }) {
  const { t } = useLocale();
  const resourceName = { singular: t("preorder"), plural: t("preorders") };
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
  const [welcomeDismissed, setWelcomeDismissed] = useState(true); // avoid SSR flash
  useEffect(() => {
    try {
      setWelcomeDismissed(localStorage.getItem("encore_welcome_dismissed") === "1");
    } catch {
      setWelcomeDismissed(false);
    }
  }, []);
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

  const liveCount = CAMPAIGNS.filter((c) => c.status === "Live").length;
  return (
    <Page fullWidth={false}>
      <BlockStack gap="500">
        <Hero
          eyebrow={t("Encore")}
          title={t("Preorders, cohorts, and back-in-stock at a glance.")}
          sub={t("Sell what isn't on the shelf yet — every preorder tagged, capped and tracked through to fulfillment.")}
          actions={
            <>
              <HeroButton primary icon={PlusIcon} onClick={() => navigate("/app/campaigns/new")}>
                {t("New preorder")}
              </HeroButton>
              <HeroButton icon={ClockIcon} onClick={() => navigate("/app/cohorts?view=cohorts")}>
                {t("Cohorts")}
              </HeroButton>
              <HeroButton icon={NotificationIcon} onClick={() => navigate("/app/waitlist")}>
                {t("Back in stock")}
              </HeroButton>
            </>
          }
          stats={[
            { value: String(liveCount), label: t("live now") },
            { value: KPIS[2]?.value ?? "0", label: t("units pre-sold") },
            { value: KPIS[3]?.value ?? "0", label: t("on waitlists") },
          ]}
        />

        {/* Quick actions */}
        <div className="encore-grid encore-grid--3">
          <QuickAction index={1} icon={CartIcon} tone="violet" title={t("Preorders")} sub={t("Create, pause, end, duplicate")} onClick={() => navigate("/app/campaigns")} />
          <QuickAction index={2} icon={ChartLineIcon} tone="teal" title={t("Insights")} sub={t("Demand, cohorts, low stock")} onClick={() => navigate("/app/insights")} />
          <QuickAction index={3} icon={SettingsIcon} tone="amber" title={t("Settings")} sub={t("Design, cart, notifications")} onClick={() => navigate("/app/settings")} />
        </div>

        {/* Platform sync (Nova outbox). These are internal messages — install
            confirmation, billing sync — that the merchant cannot act on, so the
            tone is informational and never asks them to "contact support". */}
        {data.outboxAlert && (
          <Banner title={t("Platform sync is catching up")} tone="info">
            <p>
              {t("Encore's connection to its platform backend is retrying in the background")}
              {" ("}
              {[
                data.outboxAlert.stuck > 0 ? `${data.outboxAlert.stuck} ${t("pending")}` : "",
                data.outboxAlert.dead > 0 ? `${data.outboxAlert.dead} ${t("paused")}` : "",
              ].filter(Boolean).join(", ")}
              {"). "}
              {t("Your store, preorders and checkout are not affected — no action needed.")}
            </p>
          </Banner>
        )}
        {/* Onboarding banner — dismissible, persisted per browser (R0.3). */}
        {!welcomeDismissed && (
        <Banner
          title={t("Welcome to Encore")}
          tone="info"
          onDismiss={() => {
            setWelcomeDismissed(true);
            try { localStorage.setItem("encore_welcome_dismissed", "1"); } catch { /* private mode */ }
          }}
          action={{
            content: t("Set up your first preorder"),
            onAction: () => navigate("/app/onboarding"),
          }}
          secondaryAction={{
            content: t("Get help"),
            onAction: () => navigate("/app/help"),
          }}
        >
          <p>{t("Preorders are set up at the variant level. Pick variants, set units, set a ship date — that's it. Customers pay full at checkout by default; toggle deposit or pay-later inside any preorder.")}</p>
        </Banner>
        )}

        {/* KPI tiles */}
        <div className="encore-grid encore-grid--4">
          {KPIS.map((kpi, i) => (
            <StatCard
              key={kpi.label}
              index={4 + i}
              label={t(kpi.label)}
              value={kpi.value}
              delta={kpi.delta}
              deltaTone={kpi.deltaTone}
              sub={t(kpi.sub)}
              icon={kpi.icon}
              tone={KPI_TONES[i] ?? "violet"}
            />
          ))}
        </div>

        {/* Reliability bar — §8 'must never' guarantees, from real audits */}
        <Reveal index={8}>
          <ReliabilityBar r={data.reliability} />
        </Reveal>

        {/* Cohorts + activity */}
        <Reveal index={9}>
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <SectionHead
                  icon={DeliveryIcon}
                  tone="violet"
                  title={t("Active cohorts")}
                  sub={t("Group of preorders sharing a ship date.")}
                  action={
                    <Button variant="plain" onClick={() => navigate("/app/cohorts")} icon={ArrowRightIcon}>
                      {t("View all")}
                    </Button>
                  }
                />
                <Divider />
                {COHORTS.length === 0 ? (
                  <BlockStack gap="200">
                    <Text as="p" tone="subdued">
                      {t("Cohorts group preorders by ship date — your first one appears when a preorder goes live.")}
                    </Text>
                    <InlineStack>
                      <Button size="slim" onClick={() => navigate("/app/onboarding")}>
                        {t("Start setup")}
                      </Button>
                    </InlineStack>
                  </BlockStack>
                ) : (
                  <BlockStack gap="500">
                    {COHORTS.map((c, i) => (
                      <BlockStack key={c.id} gap="500">
                        <CohortRow cohort={c} />
                        {i < COHORTS.length - 1 && <Divider />}
                      </BlockStack>
                    ))}
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                <SectionHead icon={ClockIcon} tone="sky" title={t("Recent activity")} />
                <Divider />
                <ActivityFeed items={ACTIVITY} />
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        </Reveal>

        {/* Campaigns table */}
        <Reveal index={10}>
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <Box padding="400">
                <SectionHead
                  icon={CartIcon}
                  tone="violet"
                  title={t("Preorders")}
                  sub={t("Variant-level preorder rules.")}
                  action={
                    <Button variant="primary" icon={PlusIcon} onClick={() => navigate("/app/campaigns/new")}>
                      {t("New preorder")}
                    </Button>
                  }
                />
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
        </Reveal>
      </BlockStack>
    </Page>
  );
}
