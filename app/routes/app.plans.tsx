/**
 * Plans & billing (/app/plans). Plans + pricing + limits come from Nova
 * (plans.server). Monthly / Annual toggle (annual = 20% off). Subscribe creates a
 * Shopify app subscription (billing.server) and redirects to Shopify's approval.
 */
import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { CreditCardIcon } from "@shopify/polaris-icons";
import { PageHero } from "../components/ui";
import { flag } from "../components/wc";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { getPlans } from "../services/plans.server";
import { getUsage } from "../services/usage.server";
import { getBillingState, createSubscription } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [plans, usage, billing] = await Promise.all([
    getPlans(),
    getUsage(session.shop),
    getBillingState(session.shop),
  ]);
  return { plans, usage, billing };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const fd = await request.formData();
  const planCode = String(fd.get("planCode") ?? "");
  const interval = String(fd.get("interval") ?? "EVERY_30_DAYS") === "ANNUAL"
    ? "ANNUAL"
    : "EVERY_30_DAYS";
  const appUrl = process.env.SHOPIFY_APP_URL || "https://encore.nova-platform.localhost:3003";
  const returnUrl = `${appUrl.replace(/\/$/, "")}/app/plans?billing=active`;

  const r = await createSubscription(admin, session.shop, planCode, interval, returnUrl);
  return r;
};

export const headers: HeadersFunction = (h) => boundary.headers(h);

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency }).format(minor / 100);

export default function PlansPage() {
  const { t } = useLocale();
  const { plans, usage, billing } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const [interval, setInterval] = useState<"EVERY_30_DAYS" | "ANNUAL">("EVERY_30_DAYS");

  // On subscribe, Shopify returns a top-level approval URL.
  useEffect(() => {
    const url = (fetcher.data as { confirmationUrl?: string } | undefined)?.confirmationUrl;
    if (url) {
      // Embedded apps cannot set window.top.location cross-origin; App Bridge
      // patches window.open so "_top" performs the top-level redirect.
      window.open(url, "_top");
    }
  }, [fetcher.data]);

  const subscribing = fetcher.state !== "idle";
  const err = (fetcher.data as { error?: string } | undefined)?.error;
  const comped = (fetcher.data as { comped?: boolean } | undefined)?.comped;

  const limitText = (n: number | null) => (n == null ? t("Unlimited") : n.toLocaleString());
  const usageBar = (used: number, limit: number | null) =>
    limit == null ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  return (
    <s-page inlineSize="large">
      <div className="encore-stack">
        <PageHero icon={CreditCardIcon} tone="emerald" title={t("Plans & billing")} sub={t("Limits reset monthly. Save 20% on annual.")} />
        {err && <s-banner tone="critical">{err}</s-banner>}
        {comped && <s-banner tone="success">{t("Your plan is comped — no charge.")}</s-banner>}

        <s-section>
          <s-stack direction="block" gap="base">
            <div className="encore-row-between">
              <s-heading>{t("This month's usage")}</s-heading>
              {billing?.planCode ? (
                <s-badge tone={billing.status === "ACTIVE" ? "success" : "caution"}>
                  {`${billing.planCode.toUpperCase()} · ${billing.status ?? "—"}`}
                </s-badge>
              ) : (
                <s-badge>{t("No plan")}</s-badge>
              )}
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
                const current = billing?.planCode === p.code && billing?.status === "ACTIVE";
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
                        disabled={flag(current || subscribing)}
                        loading={flag(subscribing)}
                        onClick={() => {
                          const data = new FormData();
                          data.set("planCode", p.code);
                          data.set("interval", interval);
                          fetcher.submit(data, { method: "post" });
                        }}
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
          {t("Billed through Shopify. Cancel or change plans any time; usage resets monthly.")}
        </s-paragraph>
      </div>
    </s-page>
  );
}
