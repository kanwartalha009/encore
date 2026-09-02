import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate, useSearchParams } from "react-router";
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
  Banner,
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
  ClockIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { statusToTone, relativeTime } from "../lib/format";
import ConfirmModal from "../components/ConfirmModal";
import { getShopCurrency } from "../models/shop.server";

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
  const { admin, session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const currency = await getShopCurrency(admin, session.shop);
  const campaign = await getCampaign(session.shop, id);
  if (!campaign) throw new Response("Not found", { status: 404 });

  const preorders = await listCustomersForCampaign(session.shop, id);

  const cohort = campaign.cohort;
  // Honest target: null when the merchant never set one (no fake 100% bars).
  const unitsTarget = cohort?.unitsTarget ?? null;

  // Real run rate: units sold per day since launch. Null (rendered "—") when
  // nothing sold yet or the preorder is younger than one day.
  const launchedAt = campaign.startDate ?? campaign.createdAt;
  const daysSinceLaunch = (Date.now() - launchedAt.getTime()) / 86_400_000;
  const runRate =
    campaign.unitsSold > 0 && daysSinceLaunch >= 1
      ? Math.round((campaign.unitsSold / daysSinceLaunch) * 10) / 10
      : null;
  let projectedSellOut: string | null = null;
  if (runRate && unitsTarget != null) {
    const remaining = unitsTarget - campaign.unitsSold;
    if (remaining > 0) {
      projectedSellOut = new Date(
        Date.now() + (remaining / runRate) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
    }
  }

  return {
    shopDomain: session.shop,
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
      runRate,
      projectedSellOut,
      paymentMode: campaign.paymentMode,
      depositKind: campaign.depositKind,
      depositAmount: campaign.depositAmount,
      // Shopify only auto-charges the balance when the deferred selling plan
      // is actually live — never claim it otherwise.
      autoCharge: campaign.sellingPlanStatus === "DEFERRED",
      gmv: formatGmv(campaign.gmvCents, currency),
      depositCollected: formatGmv(campaign.depositCollectedCents, currency),
      balancePending: formatGmv(campaign.balancePendingCents, currency),
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
      updatedAt: campaign.updatedAt.toISOString(),
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
      amount: formatGmv(Math.round(p.amount * 100), currency),
      paymentStatus:
        PAYMENT_STATUS_LABEL[p.paymentStatus] ?? "Deposit paid",
      orderId: p.orderRef ?? "—",
      orderedAt: p.createdAt.toISOString().slice(0, 10),
    })),
  };
};

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
  unitsTarget: number | null;
  runRate: number | null;
  projectedSellOut: string | null;
  paymentMode: string;
  depositKind: string;
  depositAmount: number;
  autoCharge: boolean;
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

// ---------- Helpers ----------
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
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const fetcher = useFetcher();
  // Onboarding hand-off: /app/onboarding redirects here with ?welcome=1.
  const [searchParams, setSearchParams] = useSearchParams();
  const [showWelcome, setShowWelcome] = useState(searchParams.get("welcome") === "1");
  const dismissWelcome = () => {
    setShowWelcome(false);
    searchParams.delete("welcome");
    setSearchParams(searchParams, { replace: true });
  };
  const { campaign: c, customers: CUSTOMERS, shopDomain } =
    useLoaderData<typeof loader>();
  const id = c.id;

  const [tabIndex, setTabIndex] = useState(0);
  const tabs = [
    { id: "overview", content: t("Overview"), panelID: "overview-panel" },
    { id: "customers", content: `Customers (${CUSTOMERS.length})`, panelID: "customers-panel" },
    { id: "activity", content: t("Activity"), panelID: "activity-panel" },
    { id: "settings", content: t("Settings"), panelID: "settings-panel" },
  ];

  // Only meaningful when the merchant actually set a target.
  const progressPct =
    c.unitsTarget != null && c.unitsTarget > 0
      ? Math.min(100, Math.round((c.unitsSold / c.unitsTarget) * 100))
      : null;

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
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const handleEnd = () => setConfirmEndOpen(true);
  // Toast only once the mutation actually completed (fetcher back to idle).
  const [pendingToast, setPendingToast] = useState<string | null>(null);
  useEffect(() => {
    if (pendingToast && fetcher.state === "idle") {
      shopify.toast.show(pendingToast);
      setPendingToast(null);
    }
  }, [pendingToast, fetcher.state, shopify]);
  const handleMarkCohortReady = () => {
    submitMutation("set_cohort_ready", { redirectTo: `/app/campaigns/${id}` });
    setPendingToast(t("Cohort marked ready to ship"));
  };
  const handleViewStorefront = () => {
    if (typeof window !== "undefined") {
      window.open(`https://${shopDomain}`, "_blank", "noopener");
    }
  };

  return (
    <Page
      backAction={{ content: t("Preorders"), url: "/app/campaigns" }}
      title={c.name}
      titleMetadata={<Badge tone={statusToTone(c.status)}>{t(c.status)}</Badge>}
      subtitle={`${c.product} · ${t("Updated")} ${relativeTime(c.updatedAt, locale)}`}
      primaryAction={{
        content: t("Edit preorder"),
        icon: EditIcon,
        onAction: () => navigate(`/app/campaigns/${id}/edit`),
      }}
      secondaryActions={[
        {
          content: c.status === "Paused" ? t("Resume") : t("Pause"),
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
        {showWelcome && (
          <Banner
            tone="success"
            title={t("Your first preorder is live!")}
            onDismiss={dismissWelcome}
          >
            <Text as="p">
              {t(
                "Shoppers on the selected products can now preorder. Add the Encore blocks in your theme editor if you haven't yet, then place a test order to see it end to end.",
              )}
            </Text>
          </Banner>
        )}
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
              sub={
                c.paymentMode === "DEPOSIT"
                  ? c.depositKind === "PERCENT"
                    ? `${c.depositAmount}% ${t("of total")}`
                    : t("Fixed deposit per unit")
                  : undefined
              }
              tone="info"
            />
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <KpiTile
              icon={ClockIcon}
              label={t("Balance pending")}
              value={c.balancePending}
              sub={
                // Pay-now preorders never have a balance — claim nothing.
                c.paymentMode === "PAY_NOW"
                  ? undefined
                  : c.autoCharge && c.shipDate !== "TBD"
                    ? `${t("auto-charge")} ${c.shipDate}`
                    : `${t("balance due")} ${c.shipDate}`
              }
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
      <ConfirmModal
        open={confirmEndOpen}
        title={t("End preorder")}
        message={t("End this preorder? Shoppers will no longer see it.")}
        confirmLabel={t("End preorder")}
        onConfirm={() => {
          setConfirmEndOpen(false);
          submitMutation("end", { redirectTo: `/app/campaigns/${id}` });
        }}
        onCancel={() => setConfirmEndOpen(false)}
      />
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
  sub?: string;
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
        {sub && (
          <Text as="p" variant="bodySm" tone="subdued">
            {sub}
          </Text>
        )}
      </BlockStack>
    </Card>
  );
}

function OverviewTab({
  campaign,
  progressPct,
  onMarkCohortReady,
  onViewStorefront,
}: {
  campaign: CampaignDetail;
  progressPct: number | null;
  onMarkCohortReady: () => void;
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
                    {campaign.unitsTarget != null ? (
                      <>
                        {t("Units sold toward this cohort's goal of")}{" "}
                        {campaign.unitsTarget} {t("units")}.
                      </>
                    ) : (
                      <>{t("Units sold for this cohort so far.")}</>
                    )}
                  </Text>
                </BlockStack>
                {progressPct != null && (
                  <Badge tone="info">{`${progressPct}%`}</Badge>
                )}
              </InlineStack>
              {campaign.unitsTarget != null && progressPct != null ? (
                <>
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
                </>
              ) : (
                <Text as="p" variant="headingLg">
                  {campaign.unitsSold.toLocaleString()} {t("units sold")}
                </Text>
              )}
            </BlockStack>
          </Card>

          {/* Sales pace — real numbers from this preorder's own orders */}
          <Card>
            <BlockStack gap="400">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">{t("Sales pace")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{t("avg units/day since launch")}</Text>
              </BlockStack>
              <InlineStack gap="600" wrap={false}>
                <BlockStack gap="050">
                  <Text as="p" variant="bodySm" tone="subdued">{t("Run rate")}</Text>
                  <Text as="p" variant="headingLg">
                    {campaign.runRate != null
                      ? `${campaign.runRate} ${t("units / day")}`
                      : "—"}
                  </Text>
                </BlockStack>
                {campaign.projectedSellOut && (
                  <>
                    <Divider borderColor="border" />
                    <BlockStack gap="050">
                      <Text as="p" variant="bodySm" tone="subdued">{t("Projected sell-out")}</Text>
                      <Text as="p" variant="headingLg">{campaign.projectedSellOut}</Text>
                    </BlockStack>
                  </>
                )}
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {t("Conversion analytics coming soon.")}
              </Text>
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
                <Button icon={CartIcon} onClick={onViewStorefront}>{t("View on storefront")}</Button>
              </ButtonGroup>
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>
    </Layout>
  );
}

function CustomersTab({ customers }: { customers: Customer[] }) {
  const { t } = useLocale();
  const resourceName = { singular: t("customer"), plural: t("customers") };

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
    <IndexTable.Row id={c.id} key={c.id} position={i}>
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
      selectable={false}
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
    <BlockStack gap="200">
      <Text as="h2" variant="headingMd">
        {t("Activity")}
      </Text>
      <Text as="p" tone="subdued">
        {t(
          "Activity tracking is coming soon — you'll see orders, notifications and payment events here.",
        )}
      </Text>
    </BlockStack>
  );
}

function SettingsTab({ campaign }: { campaign: CampaignDetail }) {
  const { t } = useLocale();
  return (
    <BlockStack gap="500">
      <Banner tone="info">
        <Text as="span">
          {t("Read-only view of this preorder's configuration.")}{" "}
          {t("Use")} <strong>{t("Edit preorder")}</strong>{" "}
          {t("to make changes.")}
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
