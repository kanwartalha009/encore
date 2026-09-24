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
  IndexTable,
  Banner,
  EmptyState,
} from "@shopify/polaris";
import {
  EditIcon,
  DuplicateIcon,
  PauseCircleIcon,
  PlayCircleIcon,
  DeleteIcon,
  CashDollarIcon,
  CartIcon,
  PackageIcon,
  ClockIcon,
  ChartLineIcon,
  SettingsIcon,
  WandIcon,
} from "@shopify/polaris-icons";
import { PageHero, StatCard, SectionHead, ProgressRing, IconTile } from "../components/ui";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { statusToTone, relativeTime } from "../lib/format";
import ConfirmModal from "../components/ConfirmModal";
import { getShopCurrency } from "../models/shop.server";
import { getCampaignOrdersAndActivity } from "../models/orders-view.server";
import { OrdersTable, orderAdminUrl, type OrderRowView } from "../components/OrdersTable";

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
  SPLIT: "Ships separately",
  WARNING: "Mixed cart allowed",
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

  const [preorders, { orders, activity }] = await Promise.all([
    listCustomersForCampaign(session.shop, id),
    getCampaignOrdersAndActivity(session.shop, id),
  ]);

  // Human product label for the subtitle (was a raw gid://…/Product/123).
  let productLabel: string | null = null;
  if (campaign.productMode === "SPECIFIC" && campaign.productIds.length) {
    try {
      const gids = campaign.productIds
        .slice(0, 5)
        .map((p) => (String(p).startsWith("gid://") ? String(p) : `gid://shopify/Product/${p}`));
      const res = await admin.graphql(
        `#graphql
        query EncoreCampaignProductTitles($ids: [ID!]!) {
          nodes(ids: $ids) { ... on Product { id title } }
        }`,
        { variables: { ids: gids } },
      );
      const body = (await res.json()) as { data?: { nodes?: ({ title?: string } | null)[] } };
      const titles = (body.data?.nodes ?? []).map((n) => n?.title).filter((t): t is string => !!t);
      const extra = campaign.productIds.length - titles.length;
      if (titles.length) productLabel = titles.join(" · ") + (extra > 0 ? ` +${extra}` : "");
    } catch {
      productLabel = null; // fall through to the count below
    }
  }

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
            : (productLabel ??
              (campaign.productIds.length
                ? `${campaign.productIds.length} product${campaign.productIds.length === 1 ? "" : "s"}`
                : campaign.name)),
      trigger: TRIGGER_LABEL[campaign.triggerType] ?? campaign.triggerType,
      payment: PAYMENT_LABEL[campaign.paymentMode] ?? campaign.paymentMode,
      cartMode: CART_LABEL[campaign.cartMode] ?? "Ships separately",
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
      awaitingPayment: campaign.awaitingPaymentCount,
      // Cohort date first, the campaign's own ship date otherwise — a live
      // preorder with a ship date must never read "TBD".
      shipDate: (cohort?.shipDate ?? campaign.shipDate)
        ? (cohort?.shipDate ?? campaign.shipDate)!.toISOString().slice(0, 10)
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
    orders: orders.map<OrderRowView>((o) => ({
      id: o.id,
      orderRef: o.orderRef,
      shopifyUrl: orderAdminUrl(session.shop, o.shopifyOrderNumericId),
      campaignId: o.campaignId,
      campaignName: o.campaignName,
      customerName: o.customerName,
      customerEmail: o.customerEmail,
      units: o.units,
      amount: formatGmv(Math.round(o.amount * 100), currency),
      paymentStatus: o.paymentStatus,
      shipDate: o.shipDate ? o.shipDate.toISOString().slice(0, 10) : "TBD",
      placedAt: o.placedAt.toISOString().slice(0, 10),
    })),
    activity: activity.map((a) => ({
      id: a.id,
      kind: a.kind,
      text: a.text,
      detail: a.detail,
      at: a.at.toISOString(),
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
  awaitingPayment: number;
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
  const { campaign: c, customers: CUSTOMERS, shopDomain, orders: ORDERS, activity: ACTIVITY } =
    useLoaderData<typeof loader>();
  const id = c.id;

  const [tabIndex, setTabIndex] = useState(0);
  const tabs = [
    { id: "overview", content: t("Overview"), panelID: "overview-panel" },
    { id: "orders", content: `${t("Orders")} (${ORDERS.length})`, panelID: "orders-panel" },
    { id: "customers", content: `${t("Customers")} (${CUSTOMERS.length})`, panelID: "customers-panel" },
    { id: "activity", content: t("Activity"), panelID: "activity-panel" },
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
  // Which mutation is in flight — drives the button spinner so the merchant
  // sees the system working (Shopify round-trips take 1–3 s).
  const [pendingIntent, setPendingIntent] = useState<string | null>(null);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    if (!busy) setPendingIntent(null);
  }, [busy]);
  const run = (intent: string, opts: { redirectTo?: string } = {}) => {
    setPendingIntent(intent);
    submitMutation(intent, opts);
  };
  const here = { redirectTo: `/app/campaigns/${id}` };
  const handleDuplicate = () => run("duplicate");
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const handleEnd = () => setConfirmEndOpen(true);

  // State-aware actions (what a merchant can do NEXT from each status):
  //   Live / Scheduled → Pause · End
  //   Paused           → Resume · End · Delete
  //   Ended            → Reactivate · Delete
  //   Draft            → Publish · Delete
  // Duplicate and Edit are always available.
  const act = (intent: string, content: string, extra: Record<string, unknown> = {}) => ({
    content,
    loading: busy && pendingIntent === intent,
    disabled: busy && pendingIntent !== intent,
    ...extra,
  });
  const secondaryActions = [
    ...(c.status === "Live" || c.status === "Scheduled"
      ? [act("pause", t("Pause"), { icon: PauseCircleIcon, onAction: () => run("pause", here) })]
      : []),
    ...(c.status === "Paused"
      ? [act("resume", t("Resume"), { icon: PlayCircleIcon, onAction: () => run("resume", here) })]
      : []),
    ...(c.status === "Ended"
      ? [act("publish", t("Reactivate"), { icon: PlayCircleIcon, onAction: () => run("publish", here) })]
      : []),
    ...(c.status === "Draft"
      ? [act("publish", t("Publish"), { icon: PlayCircleIcon, onAction: () => run("publish", here) })]
      : []),
    act("duplicate", t("Duplicate"), { icon: DuplicateIcon, onAction: handleDuplicate }),
    ...(c.status === "Live" || c.status === "Scheduled" || c.status === "Paused"
      ? [act("end", t("End preorder"), { destructive: true, onAction: handleEnd })]
      : []),
    ...(c.status === "Paused" || c.status === "Ended" || c.status === "Draft"
      ? [act("delete", t("Delete"), { destructive: true, icon: DeleteIcon, onAction: () => setConfirmDeleteOpen(true) })]
      : []),
  ];
  // Toast only once the mutation actually completed (fetcher back to idle).
  const [pendingToast, setPendingToast] = useState<string | null>(null);
  useEffect(() => {
    if (pendingToast && fetcher.state === "idle") {
      shopify.toast.show(pendingToast);
      setPendingToast(null);
    }
  }, [pendingToast, fetcher.state, shopify]);
  const handleMarkCohortReady = () => {
    run("set_cohort_ready", here);
    setPendingToast(t("Cohort marked ready to ship"));
  };
  const handleViewStorefront = () => {
    if (typeof window !== "undefined") {
      window.open(`https://${shopDomain}`, "_blank", "noopener");
    }
  };

  return (
    <Page backAction={{ content: t("Preorders"), url: "/app/campaigns" }}>
      <BlockStack gap="500">
        <PageHero
          icon={CartIcon}
          tone={c.status === "Live" ? "emerald" : c.status === "Paused" ? "amber" : c.status === "Ended" ? "slate" : "violet"}
          title={c.name}
          badge={<Badge tone={statusToTone(c.status)}>{t(c.status)}</Badge>}
          sub={`${c.product} · ${t("Updated")} ${relativeTime(c.updatedAt, locale)}`}
          actions={
            <>
              {secondaryActions.map((a) => (
                <Button
                  key={a.content}
                  icon={(a as { icon?: typeof EditIcon }).icon}
                  tone={(a as { destructive?: boolean }).destructive ? "critical" : undefined}
                  loading={a.loading}
                  disabled={a.disabled}
                  onClick={(a as { onAction?: () => void }).onAction}
                >
                  {a.content}
                </Button>
              ))}
              <Button variant="primary" icon={EditIcon} disabled={busy} onClick={() => navigate(`/app/campaigns/${id}/edit`)}>
                {t("Edit preorder")}
              </Button>
            </>
          }
        />
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
        <div className="encore-grid encore-grid--3">
          <StatCard
            index={1}
            icon={CashDollarIcon}
            tone="emerald"
            label={t("Total GMV")}
            value={c.gmv}
            sub={`${t("across")} ${c.unitsSold} ${t("units")}`}
          />
          <StatCard
            index={2}
            icon={CashDollarIcon}
            tone="sky"
            label={c.paymentMode === "DEPOSIT" ? t("Deposit collected") : t("Collected")}
            value={c.depositCollected}
            delta={c.paymentMode === "DEPOSIT" ? t("Collected") : undefined}
            sub={
              c.paymentMode === "DEPOSIT"
                ? c.depositKind === "PERCENT"
                  ? `${c.depositAmount}% ${t("of total")}`
                  : t("Fixed deposit per unit")
                : c.awaitingPayment > 0
                  ? `${c.awaitingPayment} ${c.awaitingPayment === 1 ? t("order awaiting payment") : t("orders awaiting payment")}`
                  : t("Customers pay in full at checkout")
            }
          />
          <StatCard
            index={3}
            icon={ClockIcon}
            tone="amber"
            label={c.paymentMode === "PAY_NOW" ? t("Awaiting payment") : t("Balance pending")}
            value={c.balancePending}
            delta={c.paymentMode === "PAY_NOW" ? undefined : t("Pending")}
            sub={
              // Pay-now preorders have no balance plan — only orders Shopify
              // has not marked paid yet (cash on delivery, pending gateways).
              c.paymentMode === "PAY_NOW"
                ? c.awaitingPayment > 0
                  ? t("Unpaid or cash-on-delivery orders")
                  : t("No balance — pay-now preorder")
                : c.autoCharge && c.shipDate !== "TBD"
                  ? `${t("auto-charge")} ${c.shipDate}`
                  : `${t("balance due")} ${c.shipDate}`
            }
          />
        </div>

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
              {tabIndex === 1 && <OrdersTable orders={ORDERS} />}
              {tabIndex === 2 && <CustomersTab customers={CUSTOMERS} />}
              {tabIndex === 3 && <ActivityTab items={ACTIVITY} />}
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
          run("end", here);
        }}
        onCancel={() => setConfirmEndOpen(false)}
      />
      <ConfirmModal
        open={confirmDeleteOpen}
        title={t("Delete preorder")}
        message={t("Delete this preorder? This cannot be undone. Shopify orders already placed are not affected.")}
        confirmLabel={t("Delete")}
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          run("delete", { redirectTo: "/app/campaigns" });
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </Page>
  );
}

// ---------- Sub-components ----------

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
              <SectionHead
                icon={PackageIcon}
                tone="violet"
                title={t("Cohort progress")}
                sub={
                  campaign.unitsTarget != null
                    ? `${t("Units sold toward this cohort's goal of")} ${campaign.unitsTarget} ${t("units")}.`
                    : t("Units sold for this cohort so far.")
                }
                action={progressPct != null ? <ProgressRing percent={progressPct} tone="violet" /> : undefined}
              />
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
              <SectionHead icon={ChartLineIcon} tone="teal" title={t("Sales pace")} sub={t("avg units/day since launch")} />
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
                {campaign.runRate != null
                  ? t("Based on orders recorded for this preorder since launch.")
                  : t("Updates automatically as preorders come in.")}
              </Text>
            </BlockStack>
          </Card>
        </BlockStack>
      </Layout.Section>

      <Layout.Section variant="oneThird">
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="300">
              <SectionHead icon={SettingsIcon} tone="slate" title={t("Configuration")} />
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
              <SectionHead icon={WandIcon} tone="amber" title={t("Quick actions")} />
              <Divider />
              <BlockStack gap="200">
                <Button icon={PackageIcon} onClick={onMarkCohortReady} fullWidth textAlign="left">{t("Mark cohort ready")}</Button>
                <Button icon={CartIcon} onClick={onViewStorefront} fullWidth textAlign="left">{t("View on storefront")}</Button>
              </BlockStack>
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

const ACTIVITY_ICON: Record<ActivityItem["kind"], typeof CartIcon> = {
  order: CartIcon,
  paid: CashDollarIcon,
  failed: ClockIcon,
  refunded: CashDollarIcon,
  reminder: ClockIcon,
  campaign: WandIcon,
};
const ACTIVITY_TONE: Record<ActivityItem["kind"], "violet" | "teal" | "amber" | "rose" | "sky" | "emerald"> = {
  order: "violet",
  paid: "emerald",
  failed: "rose",
  refunded: "amber",
  reminder: "sky",
  campaign: "teal",
};

type ActivityItem = {
  id: string;
  kind: "order" | "paid" | "failed" | "refunded" | "reminder" | "campaign";
  text: string;
  detail: string;
  at: string;
};

/** Real timeline derived from orders and payment timestamps (no event log). */
function ActivityTab({ items }: { items: ActivityItem[] }) {
  const { t, locale } = useLocale();
  if (items.length === 0) {
    return (
      <EmptyState
        heading={t("Nothing has happened yet")}
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>{t("Orders, payments, refunds and reminders for this preorder will show up here as they happen.")}</p>
      </EmptyState>
    );
  }
  return (
    <BlockStack gap="400">
      {items.map((a) => (
        <InlineStack key={a.id} gap="300" blockAlign="start" wrap={false}>
          <IconTile icon={ACTIVITY_ICON[a.kind]} tone={ACTIVITY_TONE[a.kind]} size="sm" />
          <BlockStack gap="050">
            <Text as="p" variant="bodyMd" fontWeight="medium">
              {t(a.text)}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {a.detail}
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              {relativeTime(a.at, locale)}
            </Text>
          </BlockStack>
        </InlineStack>
      ))}
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
