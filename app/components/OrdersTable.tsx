/**
 * Orders table — one row per Shopify order that carries preorder lines.
 * Shared by the campaign detail "Orders" tab and the /app/orders page.
 * Client-safe: no `.server` imports; rows arrive pre-formatted from loaders.
 */
import { Badge, BlockStack, Button, EmptyState, IndexTable, InlineStack, Text } from "@shopify/polaris";
import { ExternalIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router";
import { useLocale } from "../lib/i18n";

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

function tone(s: string): "success" | "warning" | "critical" | "info" | "attention" | undefined {
  switch (s) {
    case "BALANCE_PAID":
      return "success";
    case "DEPOSIT_PAID":
      return "info";
    case "BALANCE_PENDING":
      return "attention";
    case "BALANCE_FAILED":
      return "critical";
    case "REFUNDED":
      return "warning";
    default:
      return undefined;
  }
}

export function OrdersTable({
  orders,
  showCampaign = false,
}: {
  orders: OrderRowView[];
  showCampaign?: boolean;
}) {
  const { t } = useLocale();
  const navigate = useNavigate();

  if (orders.length === 0) {
    return (
      <EmptyState
        heading={t("No orders yet")}
        image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
      >
        <p>{t("Orders appear here the moment a shopper checks out with a preorder item.")}</p>
      </EmptyState>
    );
  }

  const headings = [
    { title: t("Order") },
    { title: t("Customer") },
    ...(showCampaign ? [{ title: t("Preorder") }] : []),
    { title: t("Units"), alignment: "end" as const },
    { title: t("Amount"), alignment: "end" as const },
    { title: t("Payment") },
    { title: t("Ships") },
    { title: t("Placed") },
    { title: "" },
  ];

  return (
    <IndexTable
      resourceName={{ singular: t("order"), plural: t("orders") }}
      itemCount={orders.length}
      selectable={false}
      headings={headings as never}
    >
      {orders.map((o, i) => (
        <IndexTable.Row id={o.id} key={o.id} position={i}>
          <IndexTable.Cell>
            <Text as="span" variant="bodyMd" fontWeight="semibold">
              {o.orderRef}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <BlockStack gap="050">
              <Text as="span" variant="bodyMd">
                {o.customerName}
              </Text>
              <Text as="span" variant="bodySm" tone="subdued">
                {o.customerEmail}
              </Text>
            </BlockStack>
          </IndexTable.Cell>
          {showCampaign && (
            <IndexTable.Cell>
              <Button variant="plain" onClick={() => navigate(`/app/campaigns/${o.campaignId}`)}>
                {o.campaignName || "—"}
              </Button>
            </IndexTable.Cell>
          )}
          <IndexTable.Cell>
            <Text as="span" alignment="end" numeric>
              {o.units}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" alignment="end" numeric>
              {o.amount}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Badge tone={tone(o.paymentStatus)}>{t(STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus)}</Badge>
          </IndexTable.Cell>
          <IndexTable.Cell>{o.shipDate === "TBD" ? t("TBD") : o.shipDate}</IndexTable.Cell>
          <IndexTable.Cell>
            <Text as="span" variant="bodySm" tone="subdued">
              {o.placedAt}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            {o.shopifyUrl && (
              <InlineStack align="end">
                <Button variant="plain" icon={ExternalIcon} url={o.shopifyUrl} external>
                  {t("Open in Shopify")}
                </Button>
              </InlineStack>
            )}
          </IndexTable.Cell>
        </IndexTable.Row>
      ))}
    </IndexTable>
  );
}

/** Loader-side helper: turn a server OrderRow into the view shape. */
export function orderAdminUrl(shop: string, numericId: string | null): string | null {
  if (!numericId) return null;
  const handle = shop.replace(/\.myshopify\.com$/, "");
  return `https://admin.shopify.com/store/${handle}/orders/${numericId}`;
}
