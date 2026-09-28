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
import { marketExperience, marketStockWording } from "../lib/markets-shared";
import {
  invalidateShopStock,
  marketStockSummary,
  syncMarketBlocksSafe,
} from "../models/market-stock.server";
import { useLocale } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // Reconcile markets ↔ locations (writes the snapshot + reconcile time), then
  // read the fresh rule.
  const { markets, unreadable } = await reconcileMarkets(admin, session.shop);
  const rule = await getMarketRule(session.shop);
  // Real per-market stock for the preorder items (first few live products):
  // how many are sellable at each market's own locations.
  const stock =
    !unreadable && markets.length > 1
      ? await marketStockSummary(admin, session.shop, rule, markets.map((m) => m.id))
      : null;
  return { markets, rule, unreadable, stock };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
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
  // Scope / forced markets / locations changed → recompute where preorder
  // variants are sold out (checkout guard) and drop cached storefront stock.
  invalidateShopStock(session.shop);
  await syncMarketBlocksSafe(admin, session.shop, { reconcile: true });
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
  const { markets, rule, unreadable, stock } = useLoaderData<typeof loader>();
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

  if (unreadable) {
    return (
      <AppPage heading={t("Per-market rules")} breadcrumb={{ label: t("nav.settings"), to: "/app/settings" }}>
          <s-banner tone="warning" heading={t("Couldn't read your markets")}>
            {t("Shopify didn't return your markets or locations just now. Your saved market rules still apply. Refresh the page to try again.")}
          </s-banner>
      </AppPage>
    );
  }

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
    // What a shopper here gets for a preorder item, by its stock at this
    // market's own locations (same decision the storefront and checkout use).
    const wording = marketStockWording(m, effectiveRule);
    return (
      <s-table-row key={m.id}>
        <s-table-cell>
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text type="strong">{m.name}</s-text>
            {m.primary && <s-badge>{t("Primary")}</s-badge>}
          </s-stack>
        </s-table-cell>
        <s-table-cell>
          <s-stack direction="block" gap="small-300">
            <s-text color="subdued">
              {m.stock != null
                ? `${m.stock} ${t("in stock")}`
                : effectiveRule.marketSnapshot[m.id]?.fulfillable
                  ? t("Served by a location")
                  : t("No serving location")}
            </s-text>
            {stock?.summary[m.id] && stock.summary[m.id].total > 0 && (
              <s-text color="subdued">
                {t("{n} of {total} preorder items in stock here")
                  .replace("{n}", String(stock.summary[m.id].inStock))
                  .replace("{total}", String(stock.summary[m.id].total))}
              </s-text>
            )}
          </s-stack>
        </s-table-cell>
        <s-table-cell>
          <s-stack direction="block" gap="small-300">
            <s-badge tone={badgeTone(expTone(exp))}>
              {exp === "Buy" ? t("Buy") : exp === "Preorder" ? t("Preorder") : t("Not offered")}
            </s-badge>
            <s-text>{t(wording.inStock)}</s-text>
            <s-text>{t(wording.outOfStock)}</s-text>
          </s-stack>
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

        <s-banner tone="info">
          {t("Stock is counted at the locations that serve each market. Where an item is out of stock at those locations and preorder isn't offered, shoppers there see it as sold out — at checkout too.")}
          {stock && stock.totalProducts > stock.products
            ? ` ${t("Stock counts above are based on your first {n} preorder products.").replace("{n}", String(stock.products))}`
            : ""}
        </s-banner>
    </AppPage>
  );
}
