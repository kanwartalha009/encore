/**
 * Customer Account block: the signed-in shopper's Encore pre-orders + waitlist.
 *
 * Pulls data from the app's /customer/portal endpoint, authenticated with the
 * customer-account session token. Shows ship date + balance-due per pre-order
 * and restock status per waitlist item. Fails closed (renders nothing) so it can
 * never break the customer's Orders page.
 */
import {
  reactExtension,
  BlockStack,
  InlineLayout,
  Card,
  Text,
  Badge,
  Divider,
  Spinner,
  useApi,
  useTranslate,
} from "@shopify/ui-extensions-react/customer-account";
import { useEffect, useState } from "react";

// Matches application_url in shopify.app.toml; the CLI rewrites it per env.
const APP_URL = "https://encore.nova-platform.localhost:3003";

export default reactExtension("customer-account.order-index.block.render", () => (
  <Preorders />
));

type PreorderRow = {
  product: string;
  orderRef: string;
  units: number;
  shipDate: string;
  amountPaid: number;
  balanceDue: number;
  paymentStatus: string;
};
type WaitRow = { product: string; variant: string; productId: string; status: string };

function Preorders() {
  const { sessionToken, i18n } = useApi();
  const translate = useTranslate();
  const [loading, setLoading] = useState(true);
  const [preorders, setPreorders] = useState<PreorderRow[]>([]);
  const [waitlist, setWaitlist] = useState<WaitRow[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await sessionToken.get();
        const res = await fetch(`${APP_URL}/customer/portal`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        const data = (await res.json()) as {
          preorders?: PreorderRow[];
          waitlist?: WaitRow[];
        };
        if (!active) return;
        setPreorders(data.preorders ?? []);
        setWaitlist(data.waitlist ?? []);
      } catch {
        // Fail closed — never block the Orders page.
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [sessionToken]);

  if (loading) return <Spinner accessibilityLabel={translate("loading")} />;
  if (preorders.length === 0 && waitlist.length === 0) return null;

  return (
    <BlockStack spacing="loose">
      {preorders.length > 0 && (
        <Card padding>
          <BlockStack spacing="base">
            <Text emphasis="bold">{translate("preorders.title")}</Text>
            {preorders.map((p, i) => (
              <BlockStack spacing="tight" key={`${p.orderRef}-${i}`}>
                {i > 0 && <Divider />}
                <InlineLayout columns={["fill", "auto"]}>
                  <Text>
                    {p.product}
                    {p.orderRef ? ` · ${p.orderRef}` : ""}
                  </Text>
                  <Badge tone={p.balanceDue > 0 ? "warning" : "success"}>
                    {p.balanceDue > 0
                      ? translate("preorders.balanceDue", {
                          amount: i18n.formatCurrency(p.balanceDue),
                        })
                      : translate("preorders.paid")}
                  </Badge>
                </InlineLayout>
                <Text appearance="subdued" size="small">
                  {p.shipDate
                    ? translate("preorders.ships", { date: p.shipDate })
                    : translate("preorders.shipTba")}
                </Text>
              </BlockStack>
            ))}
          </BlockStack>
        </Card>
      )}

      {waitlist.length > 0 && (
        <Card padding>
          <BlockStack spacing="base">
            <Text emphasis="bold">{translate("waitlist.title")}</Text>
            {waitlist.map((w, i) => (
              <BlockStack spacing="tight" key={`${w.productId}-${i}`}>
                {i > 0 && <Divider />}
                <InlineLayout columns={["fill", "auto"]}>
                  <Text>
                    {w.product}
                    {w.variant ? ` · ${w.variant}` : ""}
                  </Text>
                  <Badge tone={w.status === "AVAILABLE" ? "success" : "info"}>
                    {w.status === "AVAILABLE"
                      ? translate("waitlist.available")
                      : translate("waitlist.waiting")}
                  </Badge>
                </InlineLayout>
              </BlockStack>
            ))}
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}
