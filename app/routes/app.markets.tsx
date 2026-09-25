import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppPage } from "../components/ui";
import { badgeTone, flag, isChecked, val, vals } from "../components/wc";
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
      <AppPage heading={t("Per-market rules")} breadcrumb={{ label: t("nav.settings"), to: "/app/settings" }}>
          <s-section>
            <s-empty-state heading={t("You sell in one market")}>
              <s-paragraph slot="subheading">
                {t("Per-market rules aren't needed yet — they appear once you add a second Shopify market.")}
              </s-paragraph>
            </s-empty-state>
          </s-section>
      </AppPage>
    );
  }

  const rows = markets.map((m: MarketRow) => {
    const exp = marketExperience(m, effectiveRule);
    return (
      <s-table-row key={m.id}>
        <s-table-cell>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text type="strong">{m.name}</s-text>
            {m.primary && <s-badge>{t("Primary")}</s-badge>}
          </s-stack>
        </s-table-cell>
        <s-table-cell>
          <s-text color="subdued">
            {m.stock != null
              ? `${m.stock} ${t("in stock")}`
              : effectiveRule.marketSnapshot[m.id]?.fulfillable
                ? t("Served by a location")
                : t("No serving location")}
          </s-text>
        </s-table-cell>
        <s-table-cell>
          <s-badge tone={badgeTone(expTone(exp))}>
            {exp === "Buy" ? t("Buy") : exp === "Preorder" ? t("Preorder") : t("Not offered")}
          </s-badge>
        </s-table-cell>
        <s-table-cell>
          <s-checkbox
            label={t("Force preorder")}
            labelAccessibilityVisibility="exclusive"
            checked={flag(!!overrides[m.id]?.forcePreorder)}
            onChange={(e) => setForce(m.id, isChecked(e))}
          />
        </s-table-cell>
        <s-table-cell>
          <div style={{ maxWidth: 180 }}>
            <s-date-field
              label={t("Ship-date override")}
              labelAccessibilityVisibility="exclusive"
              value={overrides[m.id]?.shipDate ?? ""}
              onChange={(e) => setOverride(m.id, val(e))}
              disabled={flag(exp !== "Preorder")}
            />
          </div>
        </s-table-cell>
      </s-table-row>
    );
  });

  return (
    <AppPage
      heading={t("Per-market rules")}
      breadcrumb={{ label: t("nav.settings"), to: "/app/settings" }}
      intro={t("Run a product as in-stock in one market and preorder in another — reconciled to real inventory.")}
      primaryAction={
        <s-button variant="primary" onClick={save}>
          {t("Save market rules")}
        </s-button>
      }
    >
        {usingDemo && (
          <s-banner tone="info">
            {t("Showing sample markets — connect a dev store with multiple Shopify Markets to see live data.")}
          </s-banner>
        )}

        <s-section heading={t("Scope")}>
          <s-stack direction="block" gap="base">
            <s-choice-list label={t("Where is preorder offered?")} labelAccessibilityVisibility="exclusive" name="scope" onChange={(e) => setScope(vals(e)[0] ?? "ALL")}>
              <s-choice value="ALL" selected={flag(scope === "ALL")}>
                {t("All markets")}
              </s-choice>
              <s-choice value="SPECIFIC" selected={flag(scope === "SPECIFIC")}>
                {t("Specific markets")}
              </s-choice>
            </s-choice-list>
            {scope === "SPECIFIC" && (
              <s-stack direction="block" gap="small">
                {markets.map((m) => (
                  <s-checkbox
                    key={m.id}
                    label={m.name}
                    checked={flag(selected.includes(m.id))}
                    onChange={(e) => toggleMarket(m.id, isChecked(e))}
                  />
                ))}
              </s-stack>
            )}
          </s-stack>
        </s-section>

        <s-section heading={t("Market × inventory")} padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header listSlot="primary">{t("Market")}</s-table-header>
              <s-table-header listSlot="secondary">{t("Sellable stock")}</s-table-header>
              <s-table-header listSlot="inline">{t("Shopper sees")}</s-table-header>
              <s-table-header>{t("Force preorder")}</s-table-header>
              <s-table-header>{t("Ship-date override")}</s-table-header>
            </s-table-header-row>
            <s-table-body>{rows}</s-table-body>
          </s-table>
        </s-section>

        <s-banner tone={conflicts > 0 ? "warning" : "success"}>
          {conflicts > 0
            ? t("Some scoped markets have sellable stock — Encore shows Buy there, never preorder.")
            : t("Encore never shows preorder in a market that has sellable stock; it auto-reconciles when inventory changes.")}
          {rule.lastReconciledAt ? ` ${t("Last reconciled")}: ${new Date(rule.lastReconciledAt).toLocaleString()}.` : ""}
        </s-banner>
    </AppPage>
  );
}
