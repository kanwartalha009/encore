import { useState, useCallback, useMemo } from "react";
import { Tabs, badgeTone, flag, isChecked, val, vals, useLinkProps } from "../components/wc";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppPage, ProductThumb } from "../components/ui";

import { authenticate } from "../shopify.server";
import { listCampaigns, formatGmv } from "../models/campaign.server";
import { useLocale } from "../lib/i18n";
import { prettyDate, statusToTone, relativeTime } from "../lib/format";
import { getShopCurrency } from "../models/shop.server";
import { getProductThumbs } from "../models/product-thumbs.server";
import ConfirmModal from "../components/ConfirmModal";

// ---------- View-model types ----------
type CampaignStatus = "Live" | "Scheduled" | "Paused" | "Draft" | "Ended";
type PaymentMode =
  | "Pay now"
  | "Deposit + balance"
  | "Pay later"
  | "Minimum to confirm";
type CartMode = "Ships separately" | "Mixed cart allowed";

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
  thumb: string | null;
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
  SPLIT: "Ships separately",
  WARNING: "Mixed cart allowed",
};
const STATUS_LABEL: Record<string, CampaignStatus> = {
  DRAFT: "Draft",
  SCHEDULED: "Scheduled",
  LIVE: "Live",
  PAUSED: "Paused",
  ENDED: "Ended",
};

// ---------- Loader / headers ----------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const currency = await getShopCurrency(admin, session.shop);
  const rows = await listCampaigns(session.shop);
  const thumbs = await getProductThumbs(
    admin,
    rows.map((r) => r.productIds[0]).filter((x): x is string => !!x),
  );

  const campaigns: Campaign[] = rows.map((r) => {
    const isMoqGated = r.moqEnabled;
    const payment: PaymentMode = isMoqGated
      ? "Minimum to confirm"
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
      cartMode: CART_LABEL[r.cartMode] ?? "Ships separately",
      unitsSold: r.unitsSold,
      unitsTarget: r.unitsTarget,
      gmv: formatGmv(r.gmvCents, currency),
      shipDate: r.shipDate ? r.shipDate.toISOString().slice(0, 10) : "TBD",
      status: STATUS_LABEL[r.status] ?? "Draft",
      updatedAt: r.updatedAt.toISOString(),
      thumb: r.productIds[0] ? (thumbs[r.productIds[0]] ?? null) : null,
    };
  });

  return { campaigns };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// ---------- Helpers ----------
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
    case "Minimum to confirm":
      return "success";
  }
}

// ---------- Page ----------
export default function CampaignsIndex() {
  const navigate = useNavigate();
  const link = useLinkProps();
  const { t, locale } = useLocale();
  const { campaigns: CAMPAIGNS } = useLoaderData<typeof loader>();

  // Status views (Shopify "saved views" pattern) + filters
  const [selectedTab, setSelectedTab] = useState(0);
  // Status counts live on the tabs (Shopify saved-views pattern).
  const countOf = (s: CampaignStatus) => CAMPAIGNS.filter((c) => c.status === s).length;
  const withCount = (label: string, n: number) => (n > 0 ? `${label} ${n}` : label);
  const tabs = [
    { id: "all", content: withCount(t("All"), CAMPAIGNS.length) },
    { id: "live", content: withCount(t("Live"), countOf("Live")) },
    { id: "scheduled", content: withCount(t("Scheduled"), countOf("Scheduled")) },
    { id: "paused", content: withCount(t("Paused"), countOf("Paused")) },
    { id: "ended", content: withCount(t("Ended"), countOf("Ended")) },
  ];

  const [queryValue, setQueryValue] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<string[]>([]);
  const [cartModeFilter, setCartModeFilter] = useState<string[]>([]);
  const [unitsRange, setUnitsRange] = useState<[number, number]>([0, 1000]);
  const [filtersOpen, setFiltersOpen] = useState(false);

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
      if (queryValue && !`${c.name} ${c.product}`.toLowerCase().includes(queryValue.toLowerCase())) return false;
      if (paymentFilter.length && !paymentFilter.includes(c.payment)) return false;
      if (cartModeFilter.length && !cartModeFilter.includes(c.cartMode)) return false;
      if (c.unitsSold < unitsRange[0] || c.unitsSold > unitsRange[1]) return false;
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTab, queryValue, paymentFilter, cartModeFilter, unitsRange, CAMPAIGNS]);

  const activeFilters =
    (paymentFilter.length ? 1 : 0) + (cartModeFilter.length ? 1 : 0) + (unitsRange[0] !== 0 || unitsRange[1] !== 1000 ? 1 : 0);

  // Selection (bulk actions)
  const [selected, setSelected] = useState<string[]>([]);
  const visibleIds = filteredCampaigns.map((c) => c.id);
  const selectedVisible = selected.filter((id) => visibleIds.includes(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const toggleAll = () => setSelected(allSelected ? [] : visibleIds);
  const toggleOne = (id: string, on: boolean) =>
    setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  // Bulk action handler — fires the campaign mutations resource route.
  const fetcher = useFetcher();
  const bulkBusy = fetcher.state !== "idle";
  const submitBulk = (intent: string) => {
    if (selectedVisible.length === 0) return;
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("ids", JSON.stringify(selectedVisible));
    fd.set("redirectTo", "/app/campaigns");
    fetcher.submit(fd, { method: "post", action: "/app/campaigns/actions" });
    setSelected([]);
  };
  const [confirmEndOpen, setConfirmEndOpen] = useState(false);

  // Rows
  const rows = filteredCampaigns.map((c) => {
    const progressLabel = c.unitsTarget != null ? `${c.unitsSold} / ${c.unitsTarget}` : `${c.unitsSold}`;
    const linkId = `campaign-link-${c.id}`;
    return (
      <s-table-row key={c.id} clickDelegate={linkId}>
        <s-table-cell>
          <s-checkbox
            label={c.name}
            labelAccessibilityVisibility="exclusive"
            checked={flag(selectedVisible.includes(c.id))}
            onChange={(e) => toggleOne(c.id, isChecked(e))}
          />
        </s-table-cell>
        <s-table-cell>
          <div className="encore-cell-product">
            <ProductThumb src={c.thumb} alt={c.name} size={32} />
            <s-stack direction="block" gap="none">
              <s-link id={linkId} {...link(`/app/campaigns/${c.id}`)}>
                <s-text type="strong">{c.name}</s-text>
              </s-link>
              <s-text color="subdued" fontSize="small">
                {[c.product && c.product !== c.name ? c.product : null, t(c.trigger), t(c.cartMode)]
                  .filter(Boolean)
                  .join(" · ")}
              </s-text>
            </s-stack>
          </div>
        </s-table-cell>
        <s-table-cell>
          <s-badge tone={badgeTone(statusToTone(c.status))}>{t(c.status)}</s-badge>
        </s-table-cell>
        <s-table-cell>
          <s-badge tone={badgeTone(paymentBadgeTone(c.payment))}>{t(c.payment)}</s-badge>
        </s-table-cell>
        <s-table-cell>{progressLabel}</s-table-cell>
        <s-table-cell>{c.gmv}</s-table-cell>
        <s-table-cell>{prettyDate(c.shipDate, locale)}</s-table-cell>
        <s-table-cell>
          <s-text color="subdued" fontSize="small">
            {relativeTime(c.updatedAt, locale)}
          </s-text>
        </s-table-cell>
      </s-table-row>
    );
  });

  return (
    <AppPage
      heading={t("Preorders")}
      primaryAction={
        <s-button variant="primary" icon="plus" onClick={() => navigate("/app/campaigns/new")}>
          {t("New preorder")}
        </s-button>
      }
      secondaryActions={[
        <s-button key="cohorts" onClick={() => navigate("/app/cohorts")}>{t("Cohorts")}</s-button>,
        <s-button key="settings" onClick={() => navigate("/app/settings")}>{t("Settings")}</s-button>,
      ]}
    >
        {CAMPAIGNS.length === 0 ? (
          <s-section>
            <s-empty-state heading={t("Set up your first preorder in 30 seconds")}>
              <s-paragraph slot="subheading">
                {t("Pick the variants you want to pre-sell, set how many units, pick a ship date — that's it. Customers pay in full at checkout by default.")}
              </s-paragraph>
              <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/campaigns/new")}>
                {t("New preorder")}
              </s-button>
              <s-button slot="secondary-actions" {...link("/app/help")}>
                {t("Get help")}
              </s-button>
            </s-empty-state>
          </s-section>
        ) : (
          <>
            <s-section padding="none">
              <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />

              {/* Filters bar */}
              <s-box padding="base">
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" gap="base" alignItems="end">
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <s-search-field
                        label={t("Search preorders by name or product")}
                        labelAccessibilityVisibility="exclusive"
                        placeholder={t("Search preorders by name or product")}
                        value={queryValue}
                        onInput={(e) => setQueryValue(val(e))}
                      />
                    </div>
                    <s-button icon="filter" onClick={() => setFiltersOpen((o) => !o)}>
                      {activeFilters > 0 ? `${t("Filters")} (${activeFilters})` : t("Filters")}
                    </s-button>
                    {(activeFilters > 0 || queryValue) && (
                      <s-button variant="tertiary" onClick={handleFiltersClearAll}>
                        {t("Clear filters")}
                      </s-button>
                    )}
                  </s-stack>

                  {filtersOpen && (
                    <s-box padding="base" background="subdued" borderRadius="base">
                      <s-grid gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="large">
                        <s-choice-list label={t("Payment mode")} multiple name="payment" onChange={(e) => setPaymentFilter(vals(e))}>
                          {["Pay now", "Deposit + balance", "Pay later", "Minimum to confirm"].map((v) => (
                            <s-choice key={v} value={v} selected={flag(paymentFilter.includes(v))}>
                              {t(v)}
                            </s-choice>
                          ))}
                        </s-choice-list>
                        <s-choice-list label={t("Cart behavior")} multiple name="cartMode" onChange={(e) => setCartModeFilter(vals(e))}>
                          {["Ships separately", "Mixed cart allowed"].map((v) => (
                            <s-choice key={v} value={v} selected={flag(cartModeFilter.includes(v))}>
                              {t(v)}
                            </s-choice>
                          ))}
                        </s-choice-list>
                        <s-stack direction="block" gap="small">
                          <s-text type="strong">{t("Units sold")}</s-text>
                          <s-grid gridTemplateColumns="1fr 1fr" gap="small">
                            <s-number-field
                              label={t("Min")}
                              min={0}
                              value={String(unitsRange[0])}
                              onChange={(e) => setUnitsRange([Math.max(0, Number(val(e)) || 0), unitsRange[1]])}
                            />
                            <s-number-field
                              label={t("Max")}
                              min={0}
                              value={String(unitsRange[1])}
                              onChange={(e) => setUnitsRange([unitsRange[0], Math.max(unitsRange[0], Number(val(e)) || 0)])}
                            />
                          </s-grid>
                        </s-stack>
                      </s-grid>
                    </s-box>
                  )}

                  {/* Bulk actions */}
                  {selectedVisible.length > 0 && (
                    <s-stack direction="inline" gap="small" alignItems="center">
                      <s-text type="strong">{`${selectedVisible.length} ${t("selected")}`}</s-text>
                      <s-button onClick={() => submitBulk("pause")} loading={flag(bulkBusy)}>
                        {t("Pause")}
                      </s-button>
                      <s-button onClick={() => submitBulk("resume")} loading={flag(bulkBusy)}>
                        {t("Resume")}
                      </s-button>
                      <s-button onClick={() => submitBulk("duplicate")} loading={flag(bulkBusy)}>
                        {t("Duplicate")}
                      </s-button>
                      <s-button tone="critical" onClick={() => setConfirmEndOpen(true)}>
                        {t("End preorder")}
                      </s-button>
                    </s-stack>
                  )}
                </s-stack>
              </s-box>

              {filteredCampaigns.length === 0 ? (
                <s-box padding="large">
                  <s-empty-state heading={t("No preorders match your filters")}>
                    <s-paragraph slot="subheading">
                      {t("Try a different search term or clear the active filters to see more preorders.")}
                    </s-paragraph>
                    <s-button slot="primary-action" onClick={handleFiltersClearAll}>
                      {t("Clear filters")}
                    </s-button>
                  </s-empty-state>
                </s-box>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header>
                      <s-checkbox
                        label={t("Select all")}
                        labelAccessibilityVisibility="exclusive"
                        checked={flag(allSelected)}
                        onChange={toggleAll}
                      />
                    </s-table-header>
                    <s-table-header listSlot="primary">{t("Preorder")}</s-table-header>
                    <s-table-header listSlot="inline">{t("Status")}</s-table-header>
                    <s-table-header listSlot="kicker">{t("Payment")}</s-table-header>
                    <s-table-header format="numeric">{t("Units")}</s-table-header>
                    <s-table-header format="currency">{t("GMV")}</s-table-header>
                    <s-table-header listSlot="secondary">{t("Ship date")}</s-table-header>
                    <s-table-header>{t("Updated")}</s-table-header>
                  </s-table-header-row>
                  <s-table-body>{rows}</s-table-body>
                </s-table>
              )}
            </s-section>
          </>
        )}
      <ConfirmModal
        open={confirmEndOpen}
        title={t("End preorder")}
        message={
          selectedVisible.length === 1
            ? t("End this preorder? Existing customer orders are kept; new ones are blocked.")
            : t("End the selected preorders? Existing customer orders are kept; new ones are blocked.")
        }
        confirmLabel={t("End preorder")}
        onConfirm={() => {
          setConfirmEndOpen(false);
          submitBulk("end");
        }}
        onCancel={() => setConfirmEndOpen(false)}
      />
    </AppPage>
  );
}
