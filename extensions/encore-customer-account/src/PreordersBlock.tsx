/**
 * Customer Account block: the signed-in shopper's Encore pre-orders + waitlist.
 *
 * API 2025-10 (Preact + Polaris web components — the react wrapper ended at
 * 2025-07). Pulls data from the app's /customer/portal endpoint, authenticated
 * with the customer-account session token. Shows ship date + balance-due per
 * pre-order and restock status per waitlist item. Fails closed (renders
 * nothing) so it can never break the customer's Orders page.
 */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";

// The app's public URL. NOTE: the Shopify CLI does NOT rewrite this constant on
// deploy (it only updates application_url/redirect_urls in shopify.app.toml).
// ⇒ DEPLOY STEP: set this to the production application_url before `deploy`.
// See DEPLOY-CHECKLIST.md ("Production URLs").
const APP_URL = "https://encore-production-7c8f.up.railway.app";

export default async () => {
  render(<Preorders />, document.body);
};

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
  const t = (key: string, vars?: Record<string, unknown>) =>
    shopify.i18n.translate(key, vars);
  const [loading, setLoading] = useState(true);
  const [preorders, setPreorders] = useState<PreorderRow[]>([]);
  const [waitlist, setWaitlist] = useState<WaitRow[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const token = await shopify.sessionToken.get();
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
  }, []);

  if (loading) return <s-spinner accessibilityLabel={t("loading")} />;
  if (preorders.length === 0 && waitlist.length === 0) return null;

  return (
    <s-stack direction="block" gap="large">
      {preorders.length > 0 && (
        <s-section heading={t("preorders.title")}>
          <s-stack direction="block" gap="base">
            {preorders.map((p, i) => (
              <s-stack direction="block" gap="small" key={`${p.orderRef}-${i}`}>
                {i > 0 && <s-divider />}
                <s-grid gridTemplateColumns="1fr auto" gap="base">
                  <s-text>
                    {p.product}
                    {p.orderRef ? ` · ${p.orderRef}` : ""}
                  </s-text>
                  <s-badge tone={p.balanceDue > 0 ? "warning" : "success"}>
                    {p.balanceDue > 0
                      ? t("preorders.balanceDue", {
                          amount: shopify.i18n.formatCurrency(p.balanceDue),
                        })
                      : t("preorders.paid")}
                  </s-badge>
                </s-grid>
                <s-text color="subdued">
                  {p.shipDate
                    ? t("preorders.ships", { date: p.shipDate })
                    : t("preorders.shipTba")}
                </s-text>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}

      {waitlist.length > 0 && (
        <s-section heading={t("waitlist.title")}>
          <s-stack direction="block" gap="base">
            {waitlist.map((w, i) => (
              <s-stack direction="block" gap="small" key={`${w.productId}-${i}`}>
                {i > 0 && <s-divider />}
                <s-grid gridTemplateColumns="1fr auto" gap="base">
                  <s-text>
                    {w.product}
                    {w.variant ? ` · ${w.variant}` : ""}
                  </s-text>
                  <s-badge tone={w.status === "AVAILABLE" ? "success" : "info"}>
                    {w.status === "AVAILABLE"
                      ? t("waitlist.available")
                      : t("waitlist.waiting")}
                  </s-badge>
                </s-grid>
              </s-stack>
            ))}
          </s-stack>
        </s-section>
      )}
    </s-stack>
  );
}
