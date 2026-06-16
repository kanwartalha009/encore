/**
 * Plans & billing (/app/plans). Plans + pricing + limits come from Nova
 * (plans.server). Monthly / Annual toggle (annual = 20% off). Subscribe creates a
 * Shopify app subscription (billing.server) and redirects to Shopify's approval.
 */
import { useEffect, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  ButtonGroup,
  ProgressBar,
  Divider,
  Box,
  Banner,
} from "@shopify/polaris";

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
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);

export default function PlansPage() {
  const { t } = useLocale();
  const { plans, usage, billing } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [interval, setInterval] = useState<"EVERY_30_DAYS" | "ANNUAL">("EVERY_30_DAYS");

  // On subscribe, Shopify returns a top-level approval URL.
  useEffect(() => {
    const url = (fetcher.data as { confirmationUrl?: string } | undefined)?.confirmationUrl;
    if (url) {
      if (window.top) window.top.location.href = url;
      else window.location.href = url;
    }
  }, [fetcher.data]);

  const subscribing = fetcher.state !== "idle";
  const err = (fetcher.data as { error?: string } | undefined)?.error;
  const comped = (fetcher.data as { comped?: boolean } | undefined)?.comped;

  const limitText = (n: number | null) => (n == null ? t("Unlimited") : n.toLocaleString());
  const usageBar = (used: number, limit: number | null) =>
    limit == null ? 0 : Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  return (
    <Page
      title={t("Plans & billing")}
      subtitle={t("Limits reset monthly. Save 20% on annual.")}
    >
      <BlockStack gap="500">
        {err && <Banner tone="critical">{err}</Banner>}
        {comped && <Banner tone="success">{t("Your plan is comped — no charge.")}</Banner>}

        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{t("This month's usage")}</Text>
              {billing?.planCode ? (
                <Badge tone={billing.status === "ACTIVE" ? "success" : "attention"}>
                  {`${billing.planCode.toUpperCase()} · ${billing.status ?? "—"}`}
                </Badge>
              ) : (
                <Badge>{t("No plan")}</Badge>
              )}
            </InlineStack>
            <Divider />
            <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
              <BlockStack gap="100">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd">{t("Pre-orders")}</Text>
                  <Text as="span" variant="bodyMd">{`${usage.preorders.toLocaleString()} / ${limitText(usage.preorderLimit)}`}</Text>
                </InlineStack>
                <ProgressBar progress={usageBar(usage.preorders, usage.preorderLimit)} size="small" tone={usage.preorderOver ? "critical" : "primary"} />
              </BlockStack>
              <BlockStack gap="100">
                <InlineStack align="space-between">
                  <Text as="span" variant="bodyMd">{t("Notify-me events")}</Text>
                  <Text as="span" variant="bodyMd">{`${usage.notify.toLocaleString()} / ${limitText(usage.notifyLimit)}`}</Text>
                </InlineStack>
                <ProgressBar progress={usageBar(usage.notify, usage.notifyLimit)} size="small" tone={usage.notifyOver ? "critical" : "primary"} />
              </BlockStack>
            </InlineGrid>
            {(usage.preorderOver || usage.notifyOver) && (
              <Banner tone="warning">
                {t("You've hit a monthly limit — new pre-orders / notify-me signups pause until you upgrade or the month resets. Existing orders are unaffected.")}
              </Banner>
            )}
          </BlockStack>
        </Card>

        <InlineStack align="center">
          <ButtonGroup variant="segmented">
            <Button pressed={interval === "EVERY_30_DAYS"} onClick={() => setInterval("EVERY_30_DAYS")}>
              {t("Monthly")}
            </Button>
            <Button pressed={interval === "ANNUAL"} onClick={() => setInterval("ANNUAL")}>
              {t("Annual (-20%)")}
            </Button>
          </ButtonGroup>
        </InlineStack>

        <Layout>
          {plans.map((p) => {
            const minor = interval === "ANNUAL" ? p.amountAnnual : p.amountMonthly;
            const current = billing?.planCode === p.code && billing?.status === "ACTIVE";
            return (
              <Layout.Section key={p.code} variant="oneThird">
                <Card>
                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h3" variant="headingMd">{p.name}</Text>
                      {current && <Badge tone="success">{t("Current")}</Badge>}
                    </InlineStack>
                    <Text as="p" variant="heading2xl">
                      {money(minor, p.currency)}
                      <Text as="span" variant="bodySm" tone="subdued">
                        {interval === "ANNUAL" ? t("/yr") : t("/mo")}
                      </Text>
                    </Text>
                    {interval === "ANNUAL" && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {`${money(Math.round(p.amountAnnual / 12), p.currency)} ${t("/mo billed yearly")}`}
                      </Text>
                    )}
                    <Divider />
                    <BlockStack gap="100">
                      <Text as="p" variant="bodyMd">{`${limitText(p.preorderLimit)} ${t("pre-orders / mo")}`}</Text>
                      <Text as="p" variant="bodyMd">{`${limitText(p.notifyLimit)} ${t("notify-me / mo")}`}</Text>
                      {p.trialDays > 0 && (
                        <Text as="p" variant="bodySm" tone="subdued">{`${p.trialDays}-${t("day free trial")}`}</Text>
                      )}
                    </BlockStack>
                    <Button
                      variant={current ? "secondary" : "primary"}
                      disabled={current || subscribing}
                      loading={subscribing}
                      onClick={() => {
                        const data = new FormData();
                        data.set("planCode", p.code);
                        data.set("interval", interval);
                        fetcher.submit(data, { method: "post" });
                      }}
                    >
                      {current ? t("Current plan") : t("Choose plan")}
                    </Button>
                  </BlockStack>
                </Card>
              </Layout.Section>
            );
          })}
        </Layout>

        <Box paddingBlockStart="200">
          <Text as="p" variant="bodySm" tone="subdued">
            {t("Plans, pricing, and limits are managed by your Nova platform admin.")}
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}
