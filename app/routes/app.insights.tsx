/**
 * Insights hub — a flat overview, not nested tabs (2026-09-24 rework).
 *
 * One KPI row, then four detail links that each open a full page: Orders,
 * Cohorts, Benchmark, Demand. Low stock is a feature with its own nav entry
 * now, so it no longer lives here. All four destination routes existed
 * before; the hub only changes how they are reached (no feature loss).
 *
 * Trap-safe: `.server` model functions are used only in the loader.
 */
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  OrderIcon,
  ClockIcon,
  ChartVerticalIcon,
  MagicIcon,
  CashDollarIcon,
} from "@shopify/polaris-icons";
import { AppPage, MetricStrip, NavList, Reveal } from "../components/ui";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { rollupDemand } from "../models/demand.server";
import { listCohorts } from "../models/cohorts.server";
import { getBenchmark } from "../services/benchmark.server";
import { listShopOrders } from "../models/orders-view.server";
import { getShopCurrency } from "../models/shop.server";
import { formatMoney } from "../lib/format";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const [demand, benchmark, cohorts, orders, currency] = await Promise.all([
    rollupDemand(shop),
    getBenchmark(shop),
    listCohorts(shop),
    listShopOrders(shop, 200),
    getShopCurrency(admin, shop),
  ]);
  const awaiting = orders.filter(
    (o) => o.paymentStatus === "BALANCE_PENDING" || o.paymentStatus === "BALANCE_FAILED",
  ).length;
  return {
    orders: { count: orders.length, awaiting, units: orders.reduce((a, o) => a + o.units, 0) },
    demand: { signals: demand.length },
    benchmark: {
      conversionRate: benchmark.waitlist.conversionRate,
      lift: benchmark.liftPoints,
      units: benchmark.preorder.units,
      gmv: benchmark.preorder.gmv,
    },
    cohorts: {
      count: cohorts.length,
      atRisk: cohorts.filter((c) => c.status === "AT_RISK").length,
    },
    currency,
  };
};

export const headers: HeadersFunction = (h) => boundary.headers(h);

export default function InsightsPage() {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const d = useLoaderData<typeof loader>();

  const empty = d.orders.count === 0 && d.demand.signals === 0 && d.cohorts.count === 0;
  const conv =
    d.benchmark.conversionRate == null ? "—" : `${(d.benchmark.conversionRate * 100).toFixed(1)}%`;
  const lift = d.benchmark.lift == null ? "—" : `${d.benchmark.lift} pts`;

  return (
    <AppPage heading={t("Insights")} intro={t("Orders, cohorts, benchmark and demand — each one click away.")}>

        <MetricStrip
          metrics={[
            {
              icon: OrderIcon,
              tone: "violet",
              label: t("Preorder orders"),
              value: String(d.orders.count),
              sub:
                d.orders.awaiting > 0
                  ? `${d.orders.awaiting} ${d.orders.awaiting === 1 ? t("order awaiting payment") : t("orders awaiting payment")}`
                  : `${d.orders.units} ${t("units")}`,
              onClick: () => navigate("/app/orders"),
            },
            {
              icon: CashDollarIcon,
              tone: "emerald",
              label: t("GMV captured"),
              value: formatMoney(Math.round(d.benchmark.gmv * 100), d.currency, locale),
              sub: `${d.benchmark.units.toLocaleString()} ${t("units")}`,
              onClick: () => navigate("/app/benchmark"),
            },
            {
              icon: ChartVerticalIcon,
              tone: "sky",
              label: t("Waitlist conversion"),
              value: conv,
              sub: `${t("Lift")} ${lift}`,
              onClick: () => navigate("/app/benchmark"),
            },
            {
              icon: ClockIcon,
              tone: d.cohorts.atRisk > 0 ? "amber" : "teal",
              label: t("Active cohorts"),
              value: String(d.cohorts.count),
              sub: d.cohorts.atRisk > 0 ? `${d.cohorts.atRisk} ${t("at risk")}` : t("all on track"),
              onClick: () => navigate("/app/cohorts"),
            },
          ]}
        />

        {empty && (
          <Reveal index={4}>
            <s-section>
              <div className="encore-row-between">
                <s-stack direction="block" gap="small-200">
                  <s-heading>{t("Insights fill in with your first preorder")}</s-heading>
                  <s-paragraph color="subdued">
                    {t("Orders, cohorts, conversion and demand all start counting the moment a preorder goes live.")}
                  </s-paragraph>
                </s-stack>
                <s-button variant="primary" icon="plus" onClick={() => navigate("/app/campaigns/new")}>
                  {t("Create a preorder")}
                </s-button>
              </div>
            </s-section>
          </Reveal>
        )}

        <NavList
          items={[
            {
              icon: OrderIcon,
              tone: "violet",
              title: t("Orders"),
              sub: t("Every order with a preorder item, payment state, ship date"),
              onClick: () => navigate("/app/orders"),
            },
            {
              icon: ClockIcon,
              tone: "teal",
              title: t("Cohorts"),
              sub: t("Ship-date groups, progress to target, mark ready to ship"),
              onClick: () => navigate("/app/cohorts"),
            },
            {
              icon: ChartVerticalIcon,
              tone: "sky",
              title: t("Benchmark"),
              sub: t("Waitlist conversion, lift and captured revenue"),
              onClick: () => navigate("/app/benchmark"),
            },
            {
              icon: MagicIcon,
              tone: "amber",
              title: t("Demand"),
              sub: t("What shoppers want next, by product and market"),
              onClick: () => navigate("/app/demand"),
            },
          ]}
        />
    </AppPage>
  );
}
