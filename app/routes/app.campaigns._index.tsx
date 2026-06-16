import { useState, useCallback, useMemo } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
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
  EmptyState,
  IndexTable,
  IndexFilters,
  useSetIndexFiltersMode,
  ChoiceList,
  RangeSlider,
  TextField,
  Tooltip,
  useIndexResourceState,
  Banner,
} from "@shopify/polaris";
import type { TabProps } from "@shopify/polaris";
import { PlusIcon } from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { listCampaigns, formatGmv } from "../models/campaign.server";
import { useLocale } from "../lib/i18n";

// ---------- View-model types ----------
type CampaignStatus = "Live" | "Scheduled" | "Paused" | "Draft" | "Ended";
type PaymentMode = "Pay now" | "Deposit + balance" | "Pay later" | "MOQ gated";
type CartMode = "Hard split" | "Warning only";

type Campaign = {
  id: string;
  name: string;
  product: string;
  trigger: string;
  payment: PaymentMode;
  cartMode: CartMode;
  unitsSold: number;
  unitsTarget: number | null;
  gmv: string;
  shipDate: string;
  status: CampaignStatus;
  updatedAt: string;
};

// ---------- Mappers (DB enums → display strings) ----------
const TRIGGER_LABEL: Record<string, string> = {
  STOCK: "Stock = 0",
  DATE: "Date range",
  MANUAL: "Manual",
};
const PAYMENT_LABEL: Record<string, PaymentMode> = {
  PAY_NOW: "Pay now",
  DEPOSIT: "Deposit + balance",
  PAY_LATER: "Pay later",
};
const CART_LABEL: Record<string, CartMode> = {
  SPLIT: "Hard split",
  WARNING: "Warning only",
};
const STATUS_LABEL: Record<string, CampaignStatus> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  LIVE: "Live",
  PAUSED: "Paused",
  ENDED: "Ended",
};

function relativeTime(d: Date) {
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months > 1 ? "s" : ""} ago`;
}

// ---------- Loader / headers ----------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const rows = await listCampaigns(session.shop);

  const campaigns: Campaign[] = rows.map((r) => {
    const isMoqGated = r.moqEnabled;
    const payment: PaymentMode = isMoqGated
      ? "MOQ gated"
      : (PAYMENT_LABEL[r.paymentMode] ?? "Pay now");
    return {
      id: r.id,
      name: r.name,
      product:
        r.productMode === "ALL"
          ? "All products"
          : r.productMode === "COLLECTION"
            ? `Collection · ${r.collectionId ?? "—"}`
            : (r.productIds[0]
                ? r.cohortName ?? r.name
                : r.name),
      trigger: TRIGGER_LABEL[r.triggerType] ?? r.triggerType,
      payment,
      cartMode: CART_LABEL[r.cartMode] ?? "Hard split",
      unitsSold: r.unitsSold,
      unitsTarget: r.unitsTarget,
      gmv: formatGmv(r.gmvCents),
      shipDate: r.shipDate ? r.shipDate.toISOString().slice(0, 10) : "TBD",
      status: STATUS_LABEL[r.status] ?? "Draft",
      updatedAt: relativeTime(r.updatedAt),
    };
  });

  return { campaigns };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// ---------- Helpers ----------
function statusToTone(
  status: CampaignStatus,
): "success" | "warning" | "info" | "attention" | "critical" | undefined {
  switch (status) {
    case "Live":
      return "success";
    case "Scheduled":
      return "info";
    case "Paused":
      return "warning";
    case "Draft":
      return "attention";
    case "Ended":
      return "critical";
    default:
      return undefined;
  }
}

function paymentBadgeTone(
  payment: PaymentMode,
): "success" | "info" | "attention" | undefined {
  switch (payment) {
    case "Pay now":
      return undefined;
    case "Deposit + balance":
      return "info";
    case "Pay later":
      return "attention";
    case "MOQ gated":
      return "success";
  }
}

// ---------- Page ----------
export default function CampaignsIndex() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const { campaigns: CAMPAIGNS } = useLoaderData<typeof loader>();

  // Tab + filters state (Shopify "saved views" pattern)
  const [selectedTab, setSelectedTab] = useState(0);
  const tabs: TabProps[] = [
    { id: "all", content: t("All"), panelID: "all-panel" },
    { id: "live", content: t("Live"), panelID: "live-panel" },
    { id: "scheduled", content: t("Scheduled"), panelID: "scheduled-panel" },
    { id: "paused", content: t("Paused"), panelID: "paused-panel" },
    { id: "ended", content: t("Ended"), panelID: "ended-panel" },
  ];

  const [queryValue, setQueryValue] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<string[]>([]);
  const [cartModeFilter, setCartModeFilter] = useState<string[]>([]);
  const [unitsRange, setUnitsRange] = useState<[number, number]>([0, 1000]);

  const { mode, setMode } = useSetIndexFiltersMode();

  const handleFiltersClearAll = useCallback(() => {
    setQueryValue("");
    setPaymentFilter([]);
    setCartModeFilter([]);
    setUnitsRange([0, 1000]);
  }, []);

  // Apply tab + filters to data
  const filteredCampaigns = useMemo(() => {
    const tabKey = tabs[selectedTab]?.id;
    return CAMPAIGNS.filter((c) => {
      if (tabKey === "live" && c.status !== "Live") return false;
      if (tabKey === "scheduled" && c.status !== "Scheduled") return false;
      if (tabKey === "paused" && c.status !== "Paused") return false;
      if (tabKey === "ended" && c.status !== "Ended") return false;
      if (
        queryValue &&
        !`${c.name} ${c.product}`
          .toLowerCase()
          .includes(queryValue.toLowerCase())
      )
        return false;
      if (paymentFilter.length && !paymentFilter.includes(c.payment))
        return false;
      if (cartModeFilter.length && !cartModeFilter.includes(c.cartMode))
        return false;
      if (c.unitsSold < unitsRange[0] || c.unitsSold > unitsRange[1])
        return false;
      return true;
    });
  }, [
    selectedTab,
    queryValue,
    paymentFilter,
    cartModeFilter,
    unitsRange,
    tabs,
    CAMPAIGNS,
  ]);

  const filters = [
    {
      key: "payment",
      label: t("Payment mode"),
      filter: (
        <ChoiceList
          title={t("Payment mode")}
          titleHidden
          choices={[
            { label: t("Pay now"), value: "Pay now" },
            { label: t("Deposit + balance"), value: "Deposit + balance" },
            { label: t("Pay later"), value: "Pay later" },
            { label: t("MOQ gated"), value: "MOQ gated" },
          ]}
          selected={paymentFilter}
          onChange={setPaymentFilter}
          allowMultiple
        />
      ),
      shortcut: true,
    },
    {
      key: "cartMode",
      label: t("Cart behavior"),
      filter: (
        <ChoiceList
          title={t("Cart behavior")}
          titleHidden
          choices={[
            { label: t("Hard split"), value: "Hard split" },
            { label: t("Warning only"), value: "Warning only" },
          ]}
          selected={cartModeFilter}
          onChange={setCartModeFilter}
          allowMultiple
        />
      ),
    },
    {
      key: "units",
      label: t("Units sold"),
      filter: (
        <RangeSlider
          label={t("Units sold")}
          labelHidden
          value={unitsRange}
          min={0}
          max={1000}
          step={10}
          onChange={(v) => setUnitsRange(v as [number, number])}
          output
        />
      ),
    },
  ];

  const appliedFilters: {
    key: string;
    label: string;
    onRemove: () => void;
  }[] = [];
  if (paymentFilter.length) {
    appliedFilters.push({
      key: "payment",
      label: `${t("Payment")}: ${paymentFilter.join(", ")}`,
      onRemove: () => setPaymentFilter([]),
    });
  }
  if (cartModeFilter.length) {
    appliedFilters.push({
      key: "cartMode",
      label: `${t("Cart")}: ${cartModeFilter.join(", ")}`,
      onRemove: () => setCartModeFilter([]),
    });
  }
  if (unitsRange[0] !== 0 || unitsRange[1] !== 1000) {
    appliedFilters.push({
      key: "units",
      label: `${t("Units")}: ${unitsRange[0]}–${unitsRange[1]}`,
      onRemove: () => setUnitsRange([0, 1000]),
    });
  }

  // Selection
  const resourceName = { singular: "preorder", plural: "preorders" };
  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(
      filteredCampaigns.map((c) => ({ id: c.id })) as never,
    );

  // Bulk action handler — fires the campaign mutations resource route.
  const fetcher = useFetcher();
  const submitBulk = (intent: string) => {
    if (selectedResources.length === 0) return;
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("ids", JSON.stringify(selectedResources));
    fd.set("redirectTo", "/app/campaigns");
    fetcher.submit(fd, {
      method: "post",
      action: "/app/campaigns/actions",
    });
  };
  const promotedBulkActions = [
    { content: t("Pause"), onAction: () => submitBulk("pause") },
    { content: t("Resume"), onAction: () => submitBulk("resume") },
    { content: t("Duplicate"), onAction: () => submitBulk("duplicate") },
    {
      content: t("End preorder"),
      onAction: () => {
        if (
          typeof window !== "undefined" &&
          !window.confirm(
            `End ${selectedResources.length} preorder${selectedResources.length === 1 ? "" : "s"}? Existing customer orders are kept; new ones are blocked.`,
          )
        )
          return;
        submitBulk("end");
      },
    },
  ];

  // Rows
  const rows = filteredCampaigns.map((c, index) => {
    const progressLabel =
      c.unitsTarget != null
        ? `${c.unitsSold} / ${c.unitsTarget}`
        : `${c.unitsSold}`;
    return (
      <IndexTable.Row
        id={c.id}
        key={c.id}
        position={index}
        selected={selectedResources.includes(c.id)}
        onClick={() => navigate(`/app/campaigns/${c.id}`)}
      >
        <IndexTable.Cell>
          <BlockStack gap="050">
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {c.name}
            </Text>
            <Text as="span" variant="bodySm" tone="subdued">
              {c.product}
            </Text>
          </BlockStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={statusToTone(c.status)}>{t(c.status)}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{t(c.trigger)}</IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={paymentBadgeTone(c.payment)}>{t(c.payment)}</Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Tooltip content={c.cartMode === "Hard split" ? t("Splits mixed carts into two orders") : t("Shows warning only")}>
            <Text as="span" variant="bodySm">{t(c.cartMode)}</Text>
          </Tooltip>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" alignment="end" numeric>
            {progressLabel}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" alignment="end" numeric>
            {c.gmv}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{c.shipDate}</IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {c.updatedAt}
          </Text>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title={t("Preorders")}
      subtitle={t("Variant-level preorder rules with units, ship date, and payment.")}
      primaryAction={{
        content: t("New preorder"),
        icon: PlusIcon,
        onAction: () => navigate("/app/campaigns/new"),
      }}
      secondaryActions={[
        { content: t("Cohorts"), onAction: () => navigate("/app/cohorts") },
        { content: t("Settings"), onAction: () => navigate("/app/settings") },
      ]}
    >
      <BlockStack gap="400">
        {filteredCampaigns.length === 0 && CAMPAIGNS.length === 0 ? (
          <Layout>
            <Layout.Section>
              <Card>
                <EmptyState
                  heading={t("Set up your first preorder in 30 seconds")}
                  action={{
                    content: t("New preorder"),
                    onAction: () => navigate("/app/campaigns/new"),
                  }}
                  secondaryAction={{
                    content: t("Read the docs"),
                    url: "https://docs.preordernovafied.app",
                    external: true,
                  }}
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>{t("Pick the variants you want to pre-sell, set how many units, pick a ship date — that's it. Customers pay in full at checkout by default.")}</p>
                </EmptyState>
              </Card>
            </Layout.Section>
          </Layout>
        ) : (
          <>
            <Banner tone="info" onDismiss={() => {}}>
              <Text as="span" variant="bodyMd">
                <Text as="span" variant="bodyMd" fontWeight="semibold">{t("Tip:")}</Text>{" "}{t("Click any row to drill into the cohort, customers, and balance status.")}
              </Text>
            </Banner>

            <Card padding="0">
              <IndexFilters
                queryValue={queryValue}
                queryPlaceholder={t("Search preorders by name or product")}
                onQueryChange={setQueryValue}
                onQueryClear={() => setQueryValue("")}
                tabs={tabs}
                selected={selectedTab}
                onSelect={setSelectedTab}
                canCreateNewView={false}
                filters={filters}
                appliedFilters={appliedFilters}
                onClearAll={handleFiltersClearAll}
                mode={mode}
                setMode={setMode}
              />
              <IndexTable
                resourceName={resourceName}
                itemCount={filteredCampaigns.length}
                selectedItemsCount={
                  allResourcesSelected ? "All" : selectedResources.length
                }
                onSelectionChange={handleSelectionChange}
                promotedBulkActions={promotedBulkActions}
                headings={[
                  { title: t("Preorder") },
                  { title: t("Status") },
                  { title: t("Trigger") },
                  { title: t("Payment") },
                  { title: t("Cart") },
                  { title: t("Units"), alignment: "end" },
                  { title: t("GMV"), alignment: "end" },
                  { title: t("Ship date") },
                  { title: t("Updated") },
                ]}
              >
                {rows}
              </IndexTable>
              {filteredCampaigns.length === 0 && (
                <Box padding="600">
                  <EmptyState
                    heading={t("No preorders match your filters")}
                    action={{
                      content: t("Clear filters"),
                      onAction: handleFiltersClearAll,
                    }}
                    image=""
                  >
                    <p>{t("Try a different search term or clear the active filters to see more preorders.")}</p>
                  </EmptyState>
                </Box>
              )}
            </Card>
          </>
        )}
      </BlockStack>
    </Page>
  );
}

// Suppress unused-warning for TextField (placeholder for future search-by-id input)
void TextField;
