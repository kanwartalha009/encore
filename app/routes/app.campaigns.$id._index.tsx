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
  CashDollarIcon,
  CartIcon,
  PackageIcon,
  ClockIcon,
  ChartLineIcon,
  SettingsIcon,
  WandIcon,
} from "@shopify/polaris-icons";
import { PageHero, StatCard, SectionHead, ProgressRing, IconTile } from "../components/ui";
import { Tabs, badgeTone, flag, useLinkProps } from "../components/wc";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { statusToTone, relativeTime, displayOrderRef } from "../lib/format";
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
      orderId: displayOrderRef(p.orderRef) || "—",
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
  const link = useLinkProps();
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
    { id: "overview", content: t("Overview") },
    { id: "orders", content: `${t("Orders")} (${ORDERS.length})` },
    { id: "customers", content: `${t("Customers")} (${CUSTOMERS.length})` },
    { id: "activity", content: t("Activity") },
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
  type ActionIcon = "pause-circle" | "play-circle" | "duplicate" | "delete";
  const act = (
    intent: string,
    content: string,
    extra: { icon?: ActionIcon; destructive?: boolean; onAction: () => void },
  ) => ({
    content,
    loading: busy && pendingIntent === intent,
    disabled: busy && pendingIntent !== intent,
    ...extra,
  });
  const secondaryActions = [
    ...(c.status === "Live" || c.status === "Scheduled"
      ? [act("pause", t("Pause"), { icon: "pause-circle", onAction: () => run("pause", here) })]
      : []),
    ...(c.status === "Paused"
      ? [act("resume", t("Resume"), { icon: "play-circle", onAction: () => run("resume", here) })]
      : []),
    ...(c.status === "Ended"
      ? [act("publish", t("Reactivate"), { icon: "play-circle", onAction: () => run("publish", here) })]
      : []),
    ...(c.status === "Draft"
      ? [act("publish", t("Publish"), { icon: "play-circle", onAction: () => run("publish", here) })]
      : []),
    act("duplicate", t("Duplicate"), { icon: "duplicate", onAction: handleDuplicate }),
    ...(c.status === "Live" || c.status === "Scheduled" || c.status === "Paused"
      ? [act("end", t("End preorder"), { destructive: true, onAction: handleEnd })]
      : []),
    ...(c.status === "Paused" || c.status === "Ended" || c.status === "Draft"
      ? [act("delete", t("Delete"), { destructive: true, icon: "delete", onAction: () => setConfirmDeleteOpen(true) })]
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
    <s-page inlineSize="large">
      <s-button slot="breadcrumb-actions" icon="arrow-left" accessibilityLabel={t("Preorders")} {...link("/app/campaigns")} />
      <div className="encore-stack">
        <PageHero
          icon={CartIcon}
          tone={c.status === "Live" ? "emerald" : c.status === "Paused" ? "amber" : c.status === "Ended" ? "slate" : "violet"}
          title={c.name}
          badge={<s-badge tone={badgeTone(statusToTone(c.status))}>{t(c.status)}</s-badge>}
          sub={`${c.product} · ${t("Updated")} ${relativeTime(c.updatedAt, locale)}`}
          actions={
            <>
              {secondaryActions.map((a) => (
                <s-button
                  key={a.content}
                  icon={a.icon}
                  tone={a.destructive ? "critical" : "auto"}
                  loading={flag(a.loading)}
                  disabled={flag(a.disabled)}
                  onClick={a.onAction}
                >
                  {a.content}
                </s-button>
              ))}
              <s-button variant="primary" icon="edit" disabled={flag(busy)} onClick={() => navigate(`/app/campaigns/${id}/edit`)}>
                {t("Edit preorder")}
              </s-button>
            </>
          }
        />
        {showWelcome && (
          <s-banner tone="success" heading={t("Your first preorder is live!")} dismissible onDismiss={dismissWelcome}>
            {t(
              "Shoppers on the selected products can now preorder. Add the Encore blocks in your theme editor if you haven't yet, then place a test order to see it end to end.",
            )}
          </s-banner>
        )}
        {c.status === "Paused" && (
          <s-banner tone="warning" heading={t("Preorder is paused")}>
            {t("No new preorders are being accepted. Existing preorders are not affected.")}
          </s-banner>
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
        <s-section padding="none">
          <Tabs tabs={tabs} selected={tabIndex} onSelect={setTabIndex} />
          <s-box padding={tabIndex === 1 || tabIndex === 2 ? "none" : "base"}>
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
          </s-box>
        </s-section>
      </div>
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
    </s-page>
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
    <div className="encore-layout">
      <div className="encore-stack">
        {/* Cohort progress */}
        <s-section>
          <s-stack direction="block" gap="base">
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
                <s-progress value={progressPct} max={100} accessibilityLabel={`${progressPct}%`} />
                <div className="encore-row-between">
                  <s-text color="subdued" fontSize="small">
                    {campaign.unitsSold.toLocaleString()} of {campaign.unitsTarget.toLocaleString()} units
                  </s-text>
                  <s-text color="subdued" fontSize="small">
                    {campaign.unitsTarget - campaign.unitsSold} units remaining
                  </s-text>
                </div>
              </>
            ) : (
              <s-text fontSize="large" fontWeight="semibold">
                {campaign.unitsSold.toLocaleString()} {t("units sold")}
              </s-text>
            )}
          </s-stack>
        </s-section>

        {/* Sales pace — real numbers from this preorder's own orders */}
        <s-section>
          <s-stack direction="block" gap="base">
            <SectionHead icon={ChartLineIcon} tone="teal" title={t("Sales pace")} sub={t("avg units/day since launch")} />
            <s-stack direction="inline" gap="large-200">
              <s-stack direction="block" gap="none">
                <s-text color="subdued" fontSize="small">{t("Run rate")}</s-text>
                <s-text fontSize="large" fontWeight="semibold">
                  {campaign.runRate != null ? `${campaign.runRate} ${t("units / day")}` : "—"}
                </s-text>
              </s-stack>
              {campaign.projectedSellOut && (
                <s-stack direction="block" gap="none">
                  <s-text color="subdued" fontSize="small">{t("Projected sell-out")}</s-text>
                  <s-text fontSize="large" fontWeight="semibold">{campaign.projectedSellOut}</s-text>
                </s-stack>
              )}
            </s-stack>
            <s-text color="subdued" fontSize="small">
              {campaign.runRate != null
                ? t("Based on orders recorded for this preorder since launch.")
                : t("Updates automatically as preorders come in.")}
            </s-text>
          </s-stack>
        </s-section>
      </div>

      <div className="encore-stack">
        <s-section>
          <s-stack direction="block" gap="base">
            <SectionHead icon={SettingsIcon} tone="slate" title={t("Configuration")} />
            <s-divider />
            <SummaryRow label={t("Trigger")} value={campaign.trigger} />
            <SummaryRow label={t("Payment")} value={campaign.payment} />
            <SummaryRow label={t("Cart")} value={campaign.cartMode} />
            <SummaryRow label={t("Discount")} value={campaign.discount} />
            <SummaryRow label={t("Ship date")} value={campaign.shipDate} />
            <SummaryRow label={t("Created")} value={campaign.createdAt} />
          </s-stack>
        </s-section>

        <s-section>
          <s-stack direction="block" gap="base">
            <SectionHead icon={WandIcon} tone="amber" title={t("Quick actions")} />
            <s-divider />
            <s-stack direction="block" gap="small">
              <s-button icon="package" onClick={onMarkCohortReady} inlineSize="fill">
                {t("Mark cohort ready")}
              </s-button>
              <s-button icon="cart" onClick={onViewStorefront} inlineSize="fill">
                {t("View on storefront")}
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </div>
    </div>
  );
}

function CustomersTab({ customers }: { customers: Customer[] }) {
  const { t } = useLocale();

  if (customers.length === 0) {
    return (
      <s-box padding="large">
        <s-empty-state heading={t("No preorders yet")}>
          <s-paragraph slot="subheading">{t("Customers will appear here as they place preorders.")}</s-paragraph>
        </s-empty-state>
      </s-box>
    );
  }

  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">{t("Customer")}</s-table-header>
        <s-table-header listSlot="kicker">{t("Order")}</s-table-header>
        <s-table-header format="numeric">{t("Units")}</s-table-header>
        <s-table-header format="currency">{t("Amount")}</s-table-header>
        <s-table-header listSlot="inline">{t("Payment status")}</s-table-header>
        <s-table-header>{t("Ordered")}</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {customers.map((c) => (
          <s-table-row key={c.id}>
            <s-table-cell>
              <s-stack direction="block" gap="none">
                <s-text type="strong">{c.name}</s-text>
                <s-text color="subdued" fontSize="small">
                  {c.email}
                </s-text>
              </s-stack>
            </s-table-cell>
            <s-table-cell>{c.orderId}</s-table-cell>
            <s-table-cell>{c.units}</s-table-cell>
            <s-table-cell>{c.amount}</s-table-cell>
            <s-table-cell>
              <s-badge tone={badgeTone(paymentStatusTone(c.paymentStatus))}>{c.paymentStatus}</s-badge>
            </s-table-cell>
            <s-table-cell>
              <s-text color="subdued" fontSize="small">
                {c.orderedAt}
              </s-text>
            </s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
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
      <s-empty-state heading={t("Nothing has happened yet")}>
        <s-paragraph slot="subheading">
          {t("Orders, payments, refunds and reminders for this preorder will show up here as they happen.")}
        </s-paragraph>
      </s-empty-state>
    );
  }
  return (
    <s-stack direction="block" gap="base">
      {items.map((a) => (
        <s-stack key={a.id} direction="inline" gap="base" alignItems="start">
          <IconTile icon={ACTIVITY_ICON[a.kind]} tone={ACTIVITY_TONE[a.kind]} size="sm" />
          <s-stack direction="block" gap="none">
            <s-text fontWeight="medium">{t(a.text)}</s-text>
            <s-text color="subdued" fontSize="small">
              {a.detail}
            </s-text>
            <s-text color="subdued" fontSize="small">
              {relativeTime(a.at, locale)}
            </s-text>
          </s-stack>
        </s-stack>
      ))}
    </s-stack>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="encore-row-between">
      <s-text color="subdued" fontSize="small">
        {label}
      </s-text>
      <s-text>{value}</s-text>
    </div>
  );
}
