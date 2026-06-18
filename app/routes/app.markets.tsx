import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  ChoiceList,
  Checkbox,
  Banner,
  IndexTable,
  EmptyState,
  TextField,
  Box,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  getMarketRule,
  reconcileMarkets,
  saveMarketRule,
  type MarketRow,
  type MarketRuleData,
  type PerMarketOverride,
} from "../models/markets.server";
import { marketExperience } from "../lib/markets-shared";
import { useLocale } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Reconcile markets ↔ locations (writes the snapshot + reconcile time), then
  // read the fresh rule.
  const { markets, usingDemo } = await reconcileMarkets(admin, session.shop);
  const rule = await getMarketRule(session.shop);
  return { markets, rule, usingDemo };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const scope = String(fd.get("scope") ?? "ALL");
  let markets: string[] = [];
  let overrides: Record<string, { shipDate?: string }> = {};
  try {
    markets = JSON.parse(String(fd.get("markets") ?? "[]"));
  } catch {
    markets = [];
  }
  try {
    overrides = JSON.parse(String(fd.get("overrides") ?? "{}"));
  } catch {
    overrides = {};
  }
  await saveMarketRule(session.shop, { scope, markets, perMarketOverrides: overrides });
  return Response.json({ ok: true });
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

function expTone(e: "Buy" | "Preorder" | "Off"): "success" | "attention" | undefined {
  if (e === "Buy") return "success";
  if (e === "Preorder") return "attention";
  return undefined;
}

export default function MarketsPage() {
  const { markets, rule, usingDemo } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const { t } = useLocale();
  const submit = useSubmit();

  const [scope, setScope] = useState<string>(rule.scope);
  const [selected, setSelected] = useState<string[]>(rule.markets);
  const [overrides, setOverrides] = useState<Record<string, PerMarketOverride>>(
    rule.perMarketOverrides ?? {},
  );

  const effectiveRule: MarketRuleData = {
    scope: scope === "SPECIFIC" ? "SPECIFIC" : "ALL",
    markets: selected,
    perMarketOverrides: overrides,
    marketSnapshot: rule.marketSnapshot,
    lastReconciledAt: rule.lastReconciledAt,
  };

  const toggleMarket = (id: string, on: boolean) =>
    setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((m) => m !== id)));

  const setOverride = (id: string, shipDate: string) =>
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], shipDate } }));

  const setForce = (id: string, forcePreorder: boolean) =>
    setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], forcePreorder } }));

  const save = () => {
    submit(
      { scope, markets: JSON.stringify(selected), overrides: JSON.stringify(overrides) },
      { method: "post" },
    );
    shopify.toast.show(t("Market rules saved"));
  };

  const conflicts = markets.filter(
    (m) => marketExperience(m, effectiveRule) === "Buy" && (scope === "ALL" || selected.includes(m.id)),
  ).length;

  if (markets.length <= 1) {
    return (
      <Page title={t("Per-market rules")}>
        <Card>
          <EmptyState
            heading={t("You sell in one market")}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>{t("Per-market rules aren't needed yet — they appear once you add a second Shopify market.")}</p>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  const rows = markets.map((m: MarketRow, i) => {
    const exp = marketExperience(m, effectiveRule);
    return (
      <IndexTable.Row id={m.id} key={m.id} position={i}>
        <IndexTable.Cell>
          <InlineStack gap="150" blockAlign="center">
            <Text as="span" variant="bodyMd" fontWeight="semibold">{m.name}</Text>
            {m.primary && <Badge>{t("Primary")}</Badge>}
          </InlineStack>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" tone="subdued">
            {m.stock != null
              ? `${m.stock} ${t("in stock")}`
              : effectiveRule.marketSnapshot[m.id]?.fulfillable
                ? t("Served by a location")
                : t("No serving location")}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Badge tone={expTone(exp)}>
            {exp === "Buy" ? t("Buy") : exp === "Preorder" ? t("Preorder") : t("Not offered")}
          </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Checkbox
            label={t("Force preorder")}
            labelHidden
            checked={!!overrides[m.id]?.forcePreorder}
            onChange={(on) => setForce(m.id, on)}
          />
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Box maxWidth="160px">
            <TextField
              label={t("Ship-date override")}
              labelHidden
              type="date"
              value={overrides[m.id]?.shipDate ?? ""}
              onChange={(v) => setOverride(m.id, v)}
              autoComplete="off"
              disabled={exp !== "Preorder"}
            />
          </Box>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      title={t("Per-market rules")}
      subtitle={t("Run a product as in-stock in one market and preorder in another — reconciled to real inventory.")}
      primaryAction={{ content: t("Save market rules"), onAction: save }}
    >
      <BlockStack gap="500">
        {usingDemo && (
          <Banner tone="info" onDismiss={() => {}}>
            <Text as="span">{t("Showing sample markets — connect a dev store with multiple Shopify Markets to see live data.")}</Text>
          </Banner>
        )}

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("Scope")}</Text>
            <ChoiceList
              title={t("Where is preorder offered?")}
              titleHidden
              choices={[
                { label: t("All markets"), value: "ALL" },
                { label: t("Specific markets"), value: "SPECIFIC" },
              ]}
              selected={[scope]}
              onChange={(v) => setScope(v[0] ?? "ALL")}
            />
            {scope === "SPECIFIC" && (
              <BlockStack gap="200">
                {markets.map((m) => (
                  <Checkbox
                    key={m.id}
                    label={m.name}
                    checked={selected.includes(m.id)}
                    onChange={(on) => toggleMarket(m.id, on)}
                  />
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>

        <Card padding="0">
          <Box padding="400">
            <Text as="h2" variant="headingMd">{t("Market × inventory")}</Text>
          </Box>
          <IndexTable
            resourceName={{ singular: "market", plural: "markets" }}
            itemCount={markets.length}
            selectable={false}
            headings={[
              { title: t("Market") },
              { title: t("Sellable stock") },
              { title: t("Shopper sees") },
              { title: t("Force preorder") },
              { title: t("Ship-date override") },
            ]}
          >
            {rows}
          </IndexTable>
        </Card>

        <Banner tone={conflicts > 0 ? "warning" : "success"}>
          <Text as="span">
            {conflicts > 0
              ? t("Some scoped markets have sellable stock — Encore shows Buy there, never preorder.")
              : t("Encore never shows preorder in a market that has sellable stock; it auto-reconciles when inventory changes.")}
            {rule.lastReconciledAt
              ? ` ${t("Last reconciled")}: ${new Date(rule.lastReconciledAt).toLocaleString()}.`
              : ""}
          </Text>
        </Banner>
      </BlockStack>
    </Page>
  );
}
