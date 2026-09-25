/**
 * Orders table — one row per Shopify order that carries preorder lines.
 * Shared by the campaign detail "Orders" tab and the /app/orders page.
 * Polaris web components (`<s-table>`); client-safe, rows arrive pre-formatted.
 */
import { useNavigate } from "react-router";
import { useLocale } from "../lib/i18n";
import { prettyDate } from "../lib/format";

export type OrderRowView = {
  id: string;
  orderRef: string;
  shopifyUrl: string | null;
  campaignId: string;
  campaignName: string;
  customerName: string;
  customerEmail: string;
  units: number;
  amount: string;
  paymentStatus: string; // raw enum — translated here
  shipDate: string; // YYYY-MM-DD or "TBD"
  placedAt: string; // YYYY-MM-DD
};

const STATUS_LABEL: Record<string, string> = {
  DEPOSIT_PAID: "Deposit paid",
  BALANCE_PENDING: "Awaiting payment",
  BALANCE_PAID: "Paid",
  BALANCE_FAILED: "Payment failed",
  REFUNDED: "Refunded",
};

function tone(s: string): "success" | "warning" | "critical" | "info" | "caution" | "auto" {
  switch (s) {
    case "BALANCE_PAID":
      return "success";
    case "DEPOSIT_PAID":
      return "info";
    case "BALANCE_PENDING":
      return "caution";
    case "BALANCE_FAILED":
      return "critical";
    case "REFUNDED":
      return "warning";
    default:
      return "auto";
  }
}

export function OrdersTable({
  orders,
  showCampaign = false,
}: {
  orders: OrderRowView[];
  showCampaign?: boolean;
}) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();

  if (orders.length === 0) {
    return (
      <s-box padding="large">
        <s-empty-state heading={t("No orders yet")}>
          <s-paragraph slot="subheading">
            {t("Orders appear here the moment a shopper checks out with a preorder item.")}
          </s-paragraph>
        </s-empty-state>
      </s-box>
    );
  }

  return (
    <s-table>
      <s-table-header-row>
        <s-table-header listSlot="primary">{t("Order")}</s-table-header>
        <s-table-header listSlot="secondary">{t("Customer")}</s-table-header>
        {showCampaign && <s-table-header listSlot="kicker">{t("Preorder")}</s-table-header>}
        <s-table-header format="numeric">{t("Units")}</s-table-header>
        <s-table-header format="currency">{t("Amount")}</s-table-header>
        <s-table-header listSlot="inline">{t("Payment")}</s-table-header>
        <s-table-header>{t("Ships")}</s-table-header>
      </s-table-header-row>
      <s-table-body>
        {orders.map((o) => (
          <s-table-row key={o.id}>
            <s-table-cell>
              {/* Order number opens the order in Shopify (Shopify list convention);
                  the placed date sits under it. */}
              <s-stack direction="block" gap="none">
                {o.shopifyUrl ? (
                  <s-link href={o.shopifyUrl} target="_blank" accessibilityLabel={`${t("Open in Shopify")}: ${o.orderRef}`}>
                    <s-text type="strong">{o.orderRef}</s-text>
                  </s-link>
                ) : (
                  <s-text type="strong">{o.orderRef}</s-text>
                )}
                <s-text color="subdued" fontSize="small">
                  {prettyDate(o.placedAt, locale)}
                </s-text>
              </s-stack>
            </s-table-cell>
            <s-table-cell>
              <s-stack direction="block" gap="none">
                <s-text>{o.customerName}</s-text>
                <s-text color="subdued" fontSize="small">
                  {o.customerEmail}
                </s-text>
              </s-stack>
            </s-table-cell>
            {showCampaign && (
              <s-table-cell>
                <s-link
                  href={`/app/campaigns/${o.campaignId}`}
                  onClick={(e: Event) => {
                    e.preventDefault();
                    navigate(`/app/campaigns/${o.campaignId}`);
                  }}
                >
                  {o.campaignName || "—"}
                </s-link>
              </s-table-cell>
            )}
            <s-table-cell>{o.units}</s-table-cell>
            <s-table-cell>{o.amount}</s-table-cell>
            <s-table-cell>
              <s-badge tone={tone(o.paymentStatus)}>{t(STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus)}</s-badge>
            </s-table-cell>
            <s-table-cell>{o.shipDate === "TBD" ? t("TBD") : prettyDate(o.shipDate, locale)}</s-table-cell>
          </s-table-row>
        ))}
      </s-table-body>
    </s-table>
  );
}

/** Loader-side helper: turn a server OrderRow into the view shape. */
export function orderAdminUrl(shop: string, numericId: string | null): string | null {
  if (!numericId) return null;
  const handle = shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${handle}/orders/${numericId}`;
}
