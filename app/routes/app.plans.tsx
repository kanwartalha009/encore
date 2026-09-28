/**
 * Plans & billing (/app/plans). Since 2026-09-28 Encore uses Shopify App
 * Pricing: prices, trials and plan changes live on Shopify's own plan page
 * (every "Choose plan" / "Change plan" button opens it). This page shows the
 * current plan (synced from the Partner API — app-pricing.server), this
 * month's usage, and each plan's limits from the Nova catalog.
 */
import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppPage } from "../components/ui";
import { flag } from "../components/wc";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { getPlans, getPlanOverride } from "../services/plans.server";
import { getUsage } from "../services/usage.server";
import { getBillingState } from "../services/billing.server";
import { syncPlan, pricingConfigured } from "../services/app-pricing.server";
import { planSelectionUrl } from "../lib/admin-url.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Fresh plan on this page (the merchant may just have changed it).
  if (pricingConfigured()) await syncPlan(admin, session.shop, { force: true });
  const [plans, usage, billing, override] = await Promise.all([
    getPlans(),
    getUsage(session.shop),
    getBillingState(session.shop),
    getPlanOverride(session.shop),
  ]);
  return {
    plans,
    usage,
    billing,
    comped: override.type === "FREE",
    manageUrl: planSelectionUrl(session.shop),
  };
};

export const headers: HeadersFunction = (h) => boundary.headers(h);

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);

export default function PlansPage() {
  const { t } = useLocale();
  const { plans, usage, billing, comped, manageUrl } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [interval, setInterval] = useState<"EVERY_30_DAYS" | "ANNUAL">("EVERY_30_DAYS");
  // Shopify's plan page is outside the app iframe: App Bridge routes "_top".
  const openPlans = () => window.open(manageUrl, "_top");
  const onPlan = billing?.status === "ACTIVE" || billing?.status === "TRIAL";

  const limitText = (n: number | null) => (n == null ? t("Unlimited") : n.toLocaleString());
  const usageBar = (used: number, limit: number | null) =>
    limit == null ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  return (
    <AppPage heading={t("Plans & billing")} intro={t("Limits reset monthly. Save 20% on annual.")}>
        {comped && <s-banner tone="success">{t("Your plan is comped — no charge.")}</s-banner>}

        <s-section>
          <s-stack direction="block" gap="base">
            <div className="encore-row-between">
              <s-heading>{t("This month's usage")}</s-heading>
              <s-stack direction="inline" gap="small-200" alignItems="center">
                {billing?.planCode && onPlan ? (
                  <s-badge tone={billing.status === "TRIAL" ? "info" : "success"}>
                    {`${billing.planCode.toUpperCase()} · ${billing.status === "TRIAL" ? t("Free trial") : t("Active")}`}
                  </s-badge>
                ) : (
                  <s-badge>{t("No plan")}</s-badge>
                )}
                <s-button variant="secondary" onClick={openPlans}>
                  {onPlan ? t("Change plan") : t("Choose plan")}
                </s-button>
              </s-stack>
            </div>
            <s-divider />
            <div className="encore-layout encore-layout--equal">
              <s-stack direction="block" gap="small-200">
                <div className="encore-row-between">
                  <s-text>{t("Preorders")}</s-text>
                  <s-text>{`${usage.preorders.toLocaleString()} / ${limitText(usage.preorderLimit)}`}</s-text>
                </div>
                <s-progress value={usageBar(usage.preorders, usage.preorderLimit)} max={100} tone={usage.preorderOver ? "critical" : "auto"} accessibilityLabel={t("Preorders")} />
              </s-stack>
              <s-stack direction="block" gap="small-200">
                <div className="encore-row-between">
                  <s-text>{t("Notify-me events")}</s-text>
                  <s-text>{`${usage.notify.toLocaleString()} / ${limitText(usage.notifyLimit)}`}</s-text>
                </div>
                <s-progress value={usageBar(usage.notify, usage.notifyLimit)} max={100} tone={usage.notifyOver ? "critical" : "auto"} accessibilityLabel={t("Notify-me events")} />
              </s-stack>
            </div>
            {(usage.preorderOver || usage.notifyOver) && (
              <s-banner tone="warning">
                {t("You've hit a monthly limit — new preorders / notify-me signups pause until you upgrade or the month resets. Existing orders are unaffected.")}
              </s-banner>
            )}
          </s-stack>
        </s-section>

        {plans.length === 0 ? (
          <s-section heading={t("Plans couldn't be loaded")}>
            <s-stack direction="block" gap="small">
              <s-paragraph color="subdued">
                {t("This is usually a brief connection hiccup — your store and settings are unaffected. Try again in a moment.")}
              </s-paragraph>
              <s-stack direction="inline">
                <s-button variant="primary" onClick={() => revalidator.revalidate()} loading={flag(revalidator.state !== "idle")}>
                  {t("Try again")}
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        ) : (
          <>
            <s-stack direction="inline" justifyContent="center">
              <s-button-group gap="none">
                <s-press-button pressed={flag(interval === "EVERY_30_DAYS")} onClick={() => setInterval("EVERY_30_DAYS")}>
                  {t("Monthly")}
                </s-press-button>
                <s-press-button pressed={flag(interval === "ANNUAL")} onClick={() => setInterval("ANNUAL")}>
                  {t("Annual (-20%)")}
                </s-press-button>
              </s-button-group>
            </s-stack>

            <div className="encore-grid encore-grid--3">
              {plans.map((p) => {
                const minor = interval === "ANNUAL" ? p.amountAnnual : p.amountMonthly;
                const current = billing?.planCode === p.code && onPlan;
                return (
                  <s-section key={p.code}>
                    <s-stack direction="block" gap="base">
                      <div className="encore-row-between">
                        <s-heading>{p.name}</s-heading>
                        {current && <s-badge tone="success">{t("Current")}</s-badge>}
                      </div>
                      <s-text fontSize="large-100" fontWeight="bold">
                        {money(minor, p.currency)}
                        <s-text color="subdued" fontSize="small">
                          {interval === "ANNUAL" ? t("/yr") : t("/mo")}
                        </s-text>
                      </s-text>
                      {interval === "ANNUAL" && (
                        <s-text color="subdued" fontSize="small">
                          {`${money(Math.round(p.amountAnnual / 12), p.currency)} ${t("/mo billed yearly")}`}
                        </s-text>
                      )}
                      <s-divider />
                      <s-stack direction="block" gap="small-200">
                        <s-text>{`${limitText(p.preorderLimit)} ${t("preorders / mo")}`}</s-text>
                        <s-text>{`${limitText(p.notifyLimit)} ${t("notify-me / mo")}`}</s-text>
                        {p.trialDays > 0 && (
                          <s-text color="subdued" fontSize="small">{`${p.trialDays}-${t("day free trial")}`}</s-text>
                        )}
                      </s-stack>
                      <s-button
                        variant={current ? "secondary" : "primary"}
                        disabled={flag(current)}
                        onClick={openPlans}
                      >
                        {current ? t("Current plan") : t("Choose plan")}
                      </s-button>
                    </s-stack>
                  </s-section>
                );
              })}
            </div>
          </>
        )}

        <s-paragraph color="subdued" fontSize="small">
          {t("Billed through Shopify. Choose, change or cancel your plan on Shopify's plan page any time; usage resets monthly.")}
        </s-paragraph>
    </AppPage>
  );
}
