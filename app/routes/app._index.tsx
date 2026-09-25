import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { getDashboard } from "../models/dashboard.server";
import { getShopCurrency } from "../models/shop.server";
import { getProductThumbs } from "../models/product-thumbs.server";
import {
  CartIcon,
  CashDollarIcon,
  PackageIcon,
  EmailIcon,
  ChartVerticalIcon,
  CheckIcon,
  AlertCircleIcon,
  ClockIcon,
  ShieldCheckMarkIcon,
  DeliveryIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { prettyDate, statusToTone } from "../lib/format";
import { badgeTone } from "../components/wc";
import {
  IconTile,
  ProductThumb,
  Reveal,
  MetricStrip,
  CardHeader,
  type Metric,
  type TileTone,
} from "../components/ui";

// ---------- View-model helpers ----------
type Cohort = {
  id: string;
  name: string;
  shipDate: string;
  unitsSold: number;
  unitsForecast: number;
  gmv: string;
  status: "On track" | "At risk" | "Ready to ship";
};

type CampaignRow = {
  id: string;
  product: string;
  trigger: string;
  payment: string;
  units: string;
  shipDate: string;
  status: "Live" | "Scheduled" | "Paused" | "Ended" | "Draft";
  thumb?: string | null;
};

const KPI_ICONS = [
  CashDollarIcon,
  ChartVerticalIcon,
  PackageIcon,
  EmailIcon,
] as const;
const KPI_TONES: TileTone[] = ["emerald", "violet", "amber", "sky"];
const KPI_LINKS = ["/app/orders", "/app/campaigns", "/app/cohorts", "/app/waitlist"];

// Activity comes from order/payment timestamps (orders-view.server.ts); the
// fallback only shows on a store with no preorder orders yet.
const ACTIVITY_KIND_ICON: Record<string, typeof CheckIcon> = {
  order: CartIcon,
  paid: CashDollarIcon,
  failed: AlertCircleIcon,
  refunded: CashDollarIcon,
  reminder: EmailIcon,
  campaign: CheckIcon,
};

const FALLBACK_ACTIVITY = [
  {
    icon: CheckIcon,
    text: "Welcome to Encore",
    detail: "Create your first preorder to start capturing revenue.",
    time: "now",
  },
];

// ---------- Loader / headers ----------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  // A6: money renders in the SHOP's currency, not a hardcoded USD.
  const currency = await getShopCurrency(admin, session.shop);
  const data = await getDashboard(session.shop, currency);
  // Product thumbnails for the preorder rows (best-effort; icon tile fallback).
  const thumbs = await getProductThumbs(
    admin,
    data.campaigns.map((c) => c.productId).filter((x): x is string => !!x),
  );
  return {
    ...data,
    campaigns: data.campaigns.map((c) => ({ ...c, thumb: c.productId ? thumbs[c.productId] ?? null : null })),
  };
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// ---------- Sub-components ----------
type Health = "ok" | "warn" | "bad" | "idle";

function HealthRow({
  status,
  label,
  value,
  action,
}: {
  status: Health;
  label: string;
  value: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="encore-list-row">
      <span className={`encore-status-dot${status === "ok" ? "" : ` encore-status-dot--${status}`}`} aria-hidden="true" />
      <span className="encore-list-row__main">
        <span className="encore-list-row__title">{label}</span>
      </span>
      {action}
      <span className={`encore-list-row__value${status === "bad" || status === "warn" ? ` encore-list-row__value--${status}` : ""}`}>{value}</span>
    </div>
  );
}

/**
 * Store health — the 'must never' guarantees, measured. Waitlist delivery
 * counts: failed back-in-stock sends (usually no email provider chosen) are
 * not "all clear" (the old card said "All clear" next to a red 0%).
 */
function HealthCard({
  r,
}: {
  r: {
    oversellIncidents: number;
    untaggedOrders: number;
    waitlistDeliveryRate: number | null;
    waitlistFailed: number;
    clean: boolean;
  };
}) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const delivery: Health =
    r.waitlistDeliveryRate == null ? "idle" : r.waitlistFailed > 0 ? "warn" : "ok";
  const overall: Health = !r.clean ? "bad" : delivery === "warn" ? "warn" : "ok";
  return (
    <s-section>
      <CardHeader
        icon={ShieldCheckMarkIcon}
        tone={overall === "bad" ? "rose" : overall === "warn" ? "amber" : "emerald"}
        title={t("Store health")}
        action={
          <s-badge tone={overall === "bad" ? "critical" : overall === "warn" ? "caution" : "success"}>
            {overall === "bad" ? t("Needs attention") : overall === "warn" ? t("Check") : t("All clear")}
          </s-badge>
        }
      />
      <div className="encore-card-body encore-list">
        <HealthRow status={r.oversellIncidents > 0 ? "bad" : "ok"} label={t("Oversell incidents")} value={String(r.oversellIncidents)} />
        <HealthRow status={r.untaggedOrders > 0 ? "bad" : "ok"} label={t("Untagged orders")} value={String(r.untaggedOrders)} />
        <HealthRow
          status={delivery}
          label={t("Waitlist delivery")}
          value={r.waitlistDeliveryRate == null ? "—" : `${Math.round(r.waitlistDeliveryRate * 100)}%`}
          action={
            delivery === "warn" ? (
              <s-button variant="tertiary" onClick={() => navigate("/app/notifications")}>
                {t("Fix")}
              </s-button>
            ) : undefined
          }
        />
      </div>
    </s-section>
  );
}

function CohortsCard({ cohorts }: { cohorts: Cohort[] }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  return (
    <s-section>
      <CardHeader
        icon={DeliveryIcon}
        tone="violet"
        title={t("Active cohorts")}
        sub={t("Group of preorders sharing a ship date.")}
        action={
          cohorts.length > 0 ? (
            <s-button variant="tertiary" onClick={() => navigate("/app/cohorts")}>
              {t("View all")}
            </s-button>
          ) : undefined
        }
      />
      <div className="encore-card-body">
        {cohorts.length === 0 ? (
          <s-stack direction="block" gap="small">
            <s-text color="subdued">
              {t("Cohorts group preorders by ship date — your first one appears when a preorder goes live.")}
            </s-text>
            <s-stack direction="inline">
              <s-button onClick={() => navigate("/app/onboarding")}>{t("Start setup")}</s-button>
            </s-stack>
          </s-stack>
        ) : (
          <div className="encore-list">
            {cohorts.slice(0, 4).map((c) => {
              const pct = Math.min(100, Math.round((c.unitsSold / Math.max(1, c.unitsForecast)) * 100));
              const bar = c.status === "At risk" ? " encore-bar--amber" : c.status === "Ready to ship" ? " encore-bar--emerald" : "";
              return (
                <div key={c.id} className="encore-list-row" style={{ alignItems: "stretch" }}>
                  <span className="encore-list-row__main" style={{ gap: 6 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span className="encore-list-row__title" style={{ flex: 1 }}>{c.name}</span>
                      <s-badge tone={badgeTone(statusToTone(c.status))}>{t(c.status)}</s-badge>
                    </span>
                    <span className={`encore-bar${bar}`} aria-label={`${pct}%`}>
                      <span style={{ width: `${Math.max(pct, 2)}%` }} />
                    </span>
                    <span className="encore-list-row__sub">
                      {c.unitsSold.toLocaleString()} / {c.unitsForecast.toLocaleString()} {t("units")} · {c.gmv} {t("pre-sold")} · {t("Ships")} {prettyDate(c.shipDate, locale)}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </s-section>
  );
}

type ActivityItem = {
  icon: typeof CashDollarIcon;
  tone: TileTone;
  text: string;
  detail: string;
  time: string;
};

function ActivityCard({ items }: { items: ActivityItem[] }) {
  const { t } = useLocale();
  return (
    <s-section>
      <CardHeader icon={ClockIcon} tone="sky" title={t("Recent activity")} />
      <div className="encore-card-body encore-list">
        {items.map((a, i) => (
          <div key={`${a.text}-${i}`} className="encore-list-row">
            <IconTile icon={a.icon} tone={a.tone} size="xs" />
            <span className="encore-list-row__main">
              <span className="encore-list-row__title">{t(a.text)}</span>
              <span className="encore-list-row__sub">{t(a.detail)}</span>
            </span>
            <span className="encore-list-row__meta">{a.time}</span>
          </div>
        ))}
      </div>
    </s-section>
  );
}

const DASHBOARD_CAMPAIGN_LIMIT = 5;

/**
 * Up to five preorders, each row a link to its own page. No checkboxes —
 * bulk actions live on the Preorders page, reached by "View all".
 */
function PreordersCard({ campaigns }: { campaigns: CampaignRow[] }) {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const rows = campaigns.slice(0, DASHBOARD_CAMPAIGN_LIMIT);
  return (
    <s-section>
      <CardHeader
        icon={CartIcon}
        tone="violet"
        title={t("Preorders")}
        sub={t("Your most recent preorders.")}
        action={
          rows.length > 0 ? (
            <s-button variant="tertiary" onClick={() => navigate("/app/campaigns")}>
              {t("View all")}
            </s-button>
          ) : undefined
        }
      />
      {rows.length === 0 ? (
        <div className="encore-card-body">
          <s-empty-state heading={t("No preorders yet")}>
            <s-paragraph slot="subheading">
              {t("Pre-sell upcoming launches, capture demand on sold-out SKUs, or build a back-in-stock waitlist.")}
            </s-paragraph>
            <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/campaigns/new")}>
              {t("Set up your first preorder")}
            </s-button>
          </s-empty-state>
        </div>
      ) : (
        <div className="encore-card-body encore-flush">
          {rows.map((c) => (
            <button
              key={c.id}
              type="button"
              className="encore-row"
              onClick={() => navigate(`/app/campaigns/${c.id}`)}
              aria-label={`${c.product} — ${t(c.status)}`}
            >
              <ProductThumb src={c.thumb} alt={c.product} size={32} />
              <span className="encore-row__main">
                <span className="encore-row__title">{c.product}</span>
                <span className="encore-row__sub">
                  {t(c.payment)} · {t("Ships")} {prettyDate(c.shipDate, locale)}
                </span>
              </span>
              <span className="encore-row__meta">
                <span className="encore-row__units">{c.units} {t("units")}</span>
                <s-badge tone={badgeTone(statusToTone(c.status))}>{t(c.status)}</s-badge>
                <span className="encore-row__arrow"><s-icon type="chevron-right" size="small" /></span>
              </span>
            </button>
          ))}
        </div>
      )}
    </s-section>
  );
}

// ---------- Page ----------
export default function DashboardIndex() {
  const navigate = useNavigate();
  const { t } = useLocale();
  const data = useLoaderData<typeof loader>();
  const [welcomeDismissed, setWelcomeDismissed] = useState(true); // avoid SSR flash
  useEffect(() => {
    try {
      setWelcomeDismissed(localStorage.getItem("encore_welcome_dismissed") === "1");
    } catch {
      setWelcomeDismissed(false);
    }
  }, []);
  const METRICS: Metric[] = data.kpis.map((k, i) => ({
    label: t(k.label),
    value: k.value,
    delta: k.delta,
    deltaTone: k.deltaTone,
    sub: t(k.sub),
    icon: KPI_ICONS[i] ?? CashDollarIcon,
    tone: KPI_TONES[i] ?? "violet",
    onClick: KPI_LINKS[i] ? () => navigate(KPI_LINKS[i]) : undefined,
  }));
  const COHORTS: Cohort[] = data.cohorts.map((c) => ({
    id: c.id,
    name: c.name,
    shipDate: c.shipDate,
    unitsSold: c.unitsSold,
    unitsForecast: c.unitsTarget,
    gmv: c.gmv,
    status: c.status,
  }));
  const CAMPAIGNS: CampaignRow[] = data.campaigns;
  const ACTIVITY_TONES: Record<string, TileTone> = {
    order: "violet",
    paid: "emerald",
    failed: "rose",
    refunded: "amber",
    reminder: "sky",
    campaign: "teal",
  };
  const ACTIVITY: ActivityItem[] = data.activity.length
    ? data.activity.map((a) => ({
        icon: ACTIVITY_KIND_ICON[a.kind] ?? CheckIcon,
        tone: ACTIVITY_TONES[a.kind] ?? "slate",
        text: a.text,
        detail: a.detail,
        time: a.time,
      }))
    : FALLBACK_ACTIVITY.map((a) => ({ ...a, tone: "violet" as TileTone }));

  return (
    <s-page heading={t("Dashboard")} inlineSize="base">
      <s-button slot="primary-action" variant="primary" icon="plus" onClick={() => navigate("/app/campaigns/new")}>
        {t("New preorder")}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => navigate("/app/cohorts")}>
        {t("Cohorts")}
      </s-button>
      <s-button slot="secondary-actions" onClick={() => navigate("/app/waitlist")}>
        {t("Back in stock")}
      </s-button>

      <div className="encore-stack">
        {/* Onboarding banner — dismissible, persisted per browser (R0.3). */}
        {!welcomeDismissed && (
          <s-banner
            heading={t("Welcome to Encore")}
            tone="info"
            dismissible
            onDismiss={() => {
              setWelcomeDismissed(true);
              try { localStorage.setItem("encore_welcome_dismissed", "1"); } catch { /* private mode */ }
            }}
          >
            {t("Preorders are set up at the variant level. Pick variants, set units, set a ship date — that's it. Customers pay full at checkout by default; toggle deposit or pay-later inside any preorder.")}
            <s-button slot="secondary-actions" onClick={() => navigate("/app/onboarding")}>
              {t("Set up your first preorder")}
            </s-button>
            <s-button slot="secondary-actions" variant="tertiary" onClick={() => navigate("/app/help")}>
              {t("Get help")}
            </s-button>
          </s-banner>
        )}

        <MetricStrip metrics={METRICS} />

        <Reveal index={1}>
          <div className="encore-layout">
            <div className="encore-stack">
              <PreordersCard campaigns={CAMPAIGNS} />
              <CohortsCard cohorts={COHORTS} />
            </div>
            <div className="encore-stack">
              <HealthCard r={data.reliability} />
              <ActivityCard items={ACTIVITY} />
            </div>
          </div>
        </Reveal>
      </div>
    </s-page>
  );
}
