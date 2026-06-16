import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  getCampaign,
  listCustomersForCampaign,
  formatGmv,
} from "../models/campaign.server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Box,
  Tabs,
  Divider,
  ProgressBar,
  Icon,
  IndexTable,
  useIndexResourceState,
  Banner,
  Tooltip,
  EmptyState,
  ButtonGroup,
} from "@shopify/polaris";
import {
  EditIcon,
  DuplicateIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  CashDollarIcon,
  CartIcon,
  PackageIcon,
  EmailIcon,
  CheckIcon,
  AlertCircleIcon,
  ClockIcon,
  ChartVerticalIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";

const TRIGGER_LABEL: Record<string, string> = {
  STOCK: "Stock = 0",
  DATE: "Date range",
  MANUAL: "Manual",
};
const PAYMENT_LABEL: Record<string, string> = {
  PAY_NOW: "Pay now",
  DEPOSIT: "Deposit + balance",
  PAY_LATER: "Pay later",
};
const CART_LABEL: Record<string, string> = {
  SPLIT: "Hard split",
  WARNING: "Warning only",
};
const PAYMENT_STATUS_LABEL: Record<
  string,
  "Deposit paid" | "Balance pending" | "Balance paid" | "Balance failed" | "Refunded"
> = {
  DEPOSIT_PAID: "Deposit paid",
  BALANCE_PENDING: "Balance pending",
  BALANCE_PAID: "Balance paid",
  BALANCE_FAILED: "Balance failed",
  REFUNDED: "Refunded",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const campaign = await getCampaign(session.shop, id);
  if (!campaign) throw new Response("Not found", { status: 404 });

  const preorders = await listCustomersForCampaign(session.shop, id);

  const cohort = campaign.cohort;
  const unitsTarget = cohort?.unitsTarget ?? Math.max(campaign.unitsSold, 1);

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      product:
        campaign.productMode === "ALL"
          ? "All products"
          : campaign.productMode === "COLLECTION"
            ? `Collection · ${campaign.collectionId ?? "—"}`
            : (campaign.productIds[0] ?? campaign.name),
      trigger: TRIGGER_LABEL[campaign.triggerType] ?? campaign.triggerType,
      payment: PAYMENT_LABEL[campaign.paymentMode] ?? campaign.paymentMode,
      cartMode: CART_LABEL[campaign.cartMode] ?? "Hard split",
      unitsSold: campaign.unitsSold,
      unitsTarget,
      gmv: formatGmv(campaign.gmvCents),
      depositCollected: formatGmv(campaign.depositCollectedCents),
      balancePending: formatGmv(campaign.balancePendingCents),
      shipDate: cohort?.shipDate
        ? cohort.shipDate.toISOString().slice(0, 10)
        : "TBD",
      status: ((): "Live" | "Paused" | "Scheduled" | "Ended" | "Draft" => {
        switch (campaign.status) {
          case "LIVE":
            return "Live";
          case "PAUSED":
            return "Paused";
          case "SCHEDULED":
            return "Scheduled";
          case "ENDED":
            return "Ended";
          default:
            return "Draft";
        }
      })(),
      createdAt: campaign.createdAt.toISOString().slice(0, 10),
      updatedAt: relativeTime(campaign.updatedAt),
      cohortId: cohort?.id ?? "—",
      discount: campaign.discountEnabled
        ? `${campaign.discountAmount}${campaign.discountKind === "PERCENT" ? "%" : ""} off preorder`
        : "No discount",
    },
    customers: preorders.map((p) => ({
      id: p.id,
      name: p.customerName ?? p.customerEmail,
      email: p.customerEmail,
      units: p.units,
      amount: formatGmv(Math.round(p.amount * 100)),
      paymentStatus:
        PAYMENT_STATUS_LABEL[p.paymentStatus] ?? "Deposit paid",
      orderId: p.orderRef ?? "—",
      orderedAt: p.createdAt.toISOString().slice(0, 10),
    })),
  };
};

function relativeTime(d: Date) {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// ---------- View-model types ----------
type CampaignDetail = {
  id: string;
  name: string;
  product: string;
  trigger: string;
  payment: string;
  cartMode: string;
  unitsSold: number;
  unitsTarget: number;
  gmv: string;
  depositCollected: string;
  balancePending: string;
  shipDate: string;
  status: "Live" | "Paused" | "Scheduled" | "Ended" | "Draft";
  createdAt: string;
  updatedAt: string;
  cohortId: string;
  discount: string;
};

type Customer = {
  id: string;
  name: string;
  email: string;
  units: number;
  amount: string;
  paymentStatus:
    | "Deposit paid"
    | "Balance pending"
    | "Balance paid"
    | "Balance failed"
    | "Refunded";
  orderId: string;
  orderedAt: string;
};

const ACTIVITY = [
  {
    icon: CartIcon,
    text: "Cart split: 1 in-stock + 1 preorder",
    detail: "Customer #4821 — $214 total",
    time: "2 min ago",
  },
  {
    icon: CashDollarIcon,
    text: "Deposit captured",
    detail: "12 customers — $648",
    time: "1 hr ago",
  },
  {
    icon: AlertCircleIcon,
    text: "Balance capture failed",
    detail: "Sarah Patel — retry scheduled in 1 day",
    time: "3 hr ago",
  },
  {
    icon: EmailIcon,
    text: "Cohort update sent",
    detail: "412 customers notified of ship date",
    time: "Yesterday",
  },
  {
    icon: CheckIcon,
    text: "Preorder published",
    detail: "By kanwartalha009@gmail.com",
    time: "April 18",
  },
];

// ---------- Helpers ----------
function statusToTone(
  status: CampaignDetail["status"],
): "success" | "warning" | "info" | "critical" | undefined {
  switch (status) {
    case "Live":
      return "success";
    case "Scheduled":
      return "info";
    case "Paused":
      return "warning";
    case "Ended":
      return "critical";
  }
}

function paymentStatusTone(
  s: Customer["paymentStatus"],
): "success" | "warning" | "critical" | "info" | "attention" | undefined {
  switch (s) {
    case "Deposit paid":
      return "info";
    case "Balance pending":
      return "attention";
    case "Balance paid":
      return "success";
    case "Balance failed":
      return "critical";
    case "Refunded":
      return "warning";
  }
}

// ---------- Page ----------
export default function CampaignDetail() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  const { campaign: c, customers: CUSTOMERS } =
    useLoaderData<typeof loader>();
  const id = c.id;

  const [tabIndex, setTabIndex] = useState(0);
  const tabs = [
    { id: "overview", content: t("Overview"), panelID: "overview-panel" },
    { id: "customers", content: `Customers (${CUSTOMERS.length})`, panelID: "customers-panel" },
    { id: "activity", content: t("Activity"), panelID: "activity-panel" },
    { id: "settings", content: t("Settings"), panelID: "settings-panel" },
  ];

  const progressPct = Math.min(
    100,
    Math.round((c.unitsSold / c.unitsTarget) * 100),
  );

  // ---------- Action helpers ----------
  const submitMutation = (
    intent: string,
    opts: { redirectTo?: string } = {},
  ) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("id", id);
    if (opts.redirectTo) fd.set("redirectTo", opts.redirectTo);
    fetcher.submit(fd, {
      method: "post",
      action: "/app/campaigns/actions",
    });
  };
  const handlePauseResume = () =>
    submitMutation(c.status === "Paused" ? "resume" : "pause", {
      redirectTo: `/app/campaigns/${id}`,
    });
  const handleDuplicate = () => submitMutation("duplicate");
  const handleEnd = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "End this campaign? Existing preorders are kept; new ones are blocked.",
      )
    )
      return;
    submitMutation("end", { redirectTo: `/app/campaigns/${id}` });
  };
  const handleMarkCohortReady = () => {
    submitMutation("set_cohort_ready", { redirectTo: `/app/campaigns/${id}` });
    shopify.toast.show("Cohort marked ready to ship");
  };
  const handleEmailCohort = () =>
    shopify.toast.show("Demo: would email all customers in this cohort");
  const handleCaptureBalances = () =>
    shopify.toast.show("Demo: would capture balances for all DEPOSIT_PAID rows");
  const handleViewStorefront = () => {
    if (typeof window !== "undefined") {
      window.open("/", "_blank", "noopener");
    }
  };

  return (
    <Page
      backAction={{ content: t("Preorders"), url: "/app/campaigns" }}
      title={c.name}
      titleMetadata={<Badge tone={statusToTone(c.status)}>{c.status}</Badge>}
      subtitle={`${c.product} · Cohort ${c.cohortId} · Updated ${c.updatedAt}`}
      primaryAction={{
        content: t("Edit preorder"),
        icon: EditIcon,
        onAction: () => navigate(`/app/campaigns/${id}/edit`),
      }}
      secondaryActions={[
        {
          content: c.status === "Paused" ? "Resume" : "Pause",
          icon: c.status === "Paused" ? PlayCircleIcon : PauseCircleIcon,
          onAction: handlePauseResume,
        },
        {
          content: t("Duplicate"),
          icon: DuplicateIcon,
          onAction: handleDuplicate,
        },
        {
          content: t("End preorder"),
          destructive: true,
          onAction: handleEnd,
        },
      ]}
    >
      <BlockStack gap="500">
        {c.status === "Paused" && (
          <Banner tone="warning" title={t("Preorder is paused")}>
            <Text as="span">{t("No new preorders are being accepted. Existing preorders are not affected.")}</Text>
          </Banner>
        )}

        {/* KPI tiles */}
        <Layout>
          <Layout.Section variant="oneThird">
            <KpiTile
              icon={CashDollarIcon}
              label={t("Total GMV")}
              value={c.gmv}
              sub={`across ${c.unitsSold} units`}
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <KpiTile
              icon={CashDollarIcon}
              label={t("Deposit collected")}
              value={c.depositCollected}
              sub="20% of total"
              tone="info"
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <KpiTile
              icon={ClockIcon}
              label={t("Balance pending")}
              value={c.balancePending}
              sub={`auto-charge ${c.shipDate}`}
              tone="attention"
            />
          </Layout.Section>
        </Layout>

        {/* Tabs container */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={tabIndex} onSelect={setTabIndex}>
            <Box padding="400">
              {tabIndex === 0 && (
                <OverviewTab
                  campaign={c}
                  progressPct={progressPct}
                  onMarkCohortReady={handleMarkCohortReady}
                  onEmailCohort={handleEmailCohort}
                  onCaptureBalances={handleCaptureBalances}
                  onViewStorefront={handleViewStorefront}
                />
              )}
              {tabIndex === 1 && <CustomersTab customers={CUSTOMERS} />}
              {tabIndex === 2 && <ActivityTab />}
              {tabIndex === 3 && <SettingsTab campaign={c} />}
            </Box>
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}

// ---------- Sub-components ----------
function KpiTile({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof CashDollarIcon;
  label: string;
  value: string;
  sub: string;
  tone?: "info" | "attention";
}) {
  const { t } = useLocale();
  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="p" variant="bodySm" tone="subdued">
            {label}
          </Text>
          <Icon source={icon} tone="subdued" />
        </InlineStack>
        <InlineStack gap="200" blockAlign="center">
          <Text as="p" variant="heading2xl">
            {value}
          </Text>
          {tone && (
            <Badge tone={tone}>
              {tone === "info" ? "Collected" : "Pending"}
            </Badge>
          )}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {sub}
        </Text>
      </BlockStack>
    </Card>
  );
}

function OverviewTab({
  campaign,
  progressPct,
  onMarkCohortReady,
  onEmailCohort,
  onCaptureBalances,
  onViewStorefront,
}: {
  campaign: CampaignDetail;
  progressPct: number;
  onMarkCohortReady: () => void;
  onEmailCohort: () => void;
  onCaptureBalances: () => void;
  onViewStorefront: () => void;
}) {
  const { t } = useLocale();
  return (
    <Layout>
      <Layout.Section>
        <BlockStack gap="500">
          {/* Cohort progress */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">{t("Cohort progress")}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Units pre-sold toward the {campaign.unitsTarget}-unit
                    target for cohort {campaign.cohortId}.
                  </Text>
                </BlockStack>
                <Badge tone="info">{`${progressPct}%`}</Badge>
              </InlineStack>
              <ProgressBar progress={progressPct} tone="primary" />
              <InlineStack align="space-between">
                <Text as="span" variant="bodySm" tone="subdued">
                  {campaign.unitsSold.toLocaleString()} of{" "}
                  {campaign.unitsTarget.toLocaleString()} units
                </Text>
                <Text as="span" variant="bodySm" tone="subdued">
                  {campaign.unitsTarget - campaign.unitsSold} units remaining
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Forecast card */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="h2" variant="headingMd">{t("Forecast")}</Text>
                    <Badge tone="attention">Wedge</Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">{t("Projected end-of-cohort units based on current run rate.")}</Text>
                </BlockStack>
                <Tooltip content={t("Auto-recalculated every 15 min.")}>
                  <Icon source={ChartVerticalIcon} tone="subdued" />
                </Tooltip>
              </InlineStack>
              <InlineStack gap="600" wrap={false}>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">{t("Run rate")}</Text>
                  <Text as="p" variant="headingLg">{t("18 units / day")}</Text>
                </BlockStack>
                <Divider borderColor="border" />
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">{t("Projected at ship date")}</Text>
                  <Text as="p" variant="headingLg">{t("584 units")}</Text>
                </BlockStack>
                <Divider borderColor="border" />
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">{t("Confidence")}</Text>
                  <Text as="p" variant="headingLg">{t("±42 units")}</Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Funnel */}
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("Conversion funnel")}</Text>
              <Divider />
              <FunnelRow
                step="Storefront views"
                value="12,481"
                pct={100}
                tone="success"
              />
              <FunnelRow
                step="Preorder CTA clicks"
                value="892"
                pct={7.1}
                tone="primary"
              />
              <FunnelRow
                step="Checkouts started"
                value="478"
                pct={3.8}
                tone="primary"
              />
              <FunnelRow
                step="Preorders captured"
                value="412"
                pct={3.3}
                tone="success"
              />
              <FunnelRow
                step="Balance paid (so far)"
                value="184"
                pct={1.5}
                tone="highlight"
              />
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>

      <Layout.Section variant="oneThird">
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("Configuration")}</Text>
              <Divider />
              <SummaryRow label={t("Trigger")} value={campaign.trigger} />
              <SummaryRow label={t("Payment")} value={campaign.payment} />
              <SummaryRow label={t("Cart")} value={campaign.cartMode} />
              <SummaryRow label={t("Discount")} value={campaign.discount} />
              <SummaryRow label={t("Ship date")} value={campaign.shipDate} />
              <SummaryRow label={t("Created")} value={campaign.createdAt} />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">{t("Quick actions")}</Text>
              <Divider />
              <ButtonGroup>
                <Button icon={PackageIcon} onClick={onMarkCohortReady}>{t("Mark cohort ready")}</Button>
                <Button icon={EmailIcon} onClick={onEmailCohort}>{t("Email cohort")}</Button>
              </ButtonGroup>
              <Button icon={CashDollarIcon} onClick={onCaptureBalances}>{t("Capture balances now")}</Button>
              <Button icon={CartIcon} onClick={onViewStorefront}>{t("View on storefront")}</Button>
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>
    </Layout>
  );
}

function FunnelRow({
  step,
  value,
  pct,
  tone,
}: {
  step: string;
  value: string;
  pct: number;
  tone: "primary" | "success" | "highlight" | "critical";
}) {
  const { t } = useLocale();
  return (
    <BlockStack gap="100">
      <InlineStack align="space-between">
        <Text as="span" variant="bodyMd">
          {step}
        </Text>
        <InlineStack gap="200">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {value}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            ({pct.toFixed(1)}%)
          </Text>
        </InlineStack>
      </InlineStack>
      <ProgressBar progress={pct} size="small" tone={tone} />
    </BlockStack>
  );
}

function CustomersTab({ customers }: { customers: Customer[] }) {
  const { t } = useLocale();
  const shopify = useAppBridge();
  const resourceName = { singular: "customer", plural: "customers" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(customers.map((c) => ({ id: c.id })) as never);

  const handleEmail = () =>
    shopify.toast.show(
      `Demo: would email ${selectedResources.length} customer${selectedResources.length === 1 ? "" : "s"}`,
    );
  const handleRetryBalance = () =>
    shopify.toast.show(
      `Demo: would retry balance capture for ${selectedResources.length} order${selectedResources.length === 1 ? "" : "s"}`,
    );
  const handleRefund = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Refund deposits for ${selectedResources.length} order${selectedResources.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    shopify.toast.show(`Demo: would refund ${selectedResources.length} deposits`);
  };

  if (customers.length === 0) {
    return (
      <EmptyState
        heading={t("No preorders yet")}
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>{t("Customers will appear here as they place preorders.")}</p>
      </EmptyState>
    );
  }

  const rows = customers.map((c, i) => (
    <IndexTable.Row
      id={c.id}
      key={c.id}
      position={i}
      selected={selectedResources.includes(c.id)}
    >
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            {c.name}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {c.email}
          </Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>{c.orderId}</IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="end" numeric>
          {c.units}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="end" numeric>
          {c.amount}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={paymentStatusTone(c.paymentStatus)}>
          {c.paymentStatus}
        </Badge>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {c.orderedAt}
        </Text>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <IndexTable
      resourceName={resourceName}
      itemCount={customers.length}
      selectedItemsCount={
        allResourcesSelected ? "All" : selectedResources.length
      }
      onSelectionChange={handleSelectionChange}
      promotedBulkActions={[
        { content: t("Email selected"), onAction: handleEmail },
        { content: t("Retry balance capture"), onAction: handleRetryBalance },
      ]}
      bulkActions={[{ content: t("Refund deposit"), onAction: handleRefund }]}
      headings={[
        { title: t("Customer") },
        { title: t("Order") },
        { title: t("Units"), alignment: "end" },
        { title: t("Amount"), alignment: "end" },
        { title: t("Payment status") },
        { title: t("Ordered") },
      ]}
    >
      {rows}
    </IndexTable>
  );
}

function ActivityTab() {
  const { t } = useLocale();
  return (
    <BlockStack gap="400">
      {ACTIVITY.map((a, i) => (
        <InlineStack key={i} gap="300" blockAlign="start" wrap={false}>
          <Box
            background="bg-surface-secondary"
            padding="200"
            borderRadius="200"
          >
            <Icon source={a.icon} tone="subdued" />
          </Box>
          <BlockStack gap="050">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {a.text}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {a.detail}
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

function SettingsTab({ campaign }: { campaign: CampaignDetail }) {
  const { t } = useLocale();
  return (
    <BlockStack gap="500">
      <Banner tone="info">
        <Text as="span">
          Read-only view of this campaign's configuration. Use{" "}
          <strong>Edit preorder</strong> to make changes.
        </Text>
      </Banner>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">{t("Trigger")}</Text>
              <SummaryRow label={t("Type")} value={campaign.trigger} />
              <SummaryRow label={t("Cohort ID")} value={campaign.cohortId} />
              <SummaryRow label={t("Ship date")} value={campaign.shipDate} />
            </BlockStack>
          </Card>
        </Layout.Section>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">{t("Payment")}</Text>
              <SummaryRow label={t("Mode")} value={campaign.payment} />
              <SummaryRow label={t("Discount")} value={campaign.discount} />
              <SummaryRow label={t("Cart")} value={campaign.cartMode} />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </BlockStack>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="span" variant="bodyMd">
        {value}
      </Text>
    </InlineStack>
  );
}
