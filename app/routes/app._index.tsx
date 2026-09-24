import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useState } from "react";
import { useLoaderData, useNavigate } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { getDashboard } from "../models/dashboard.server";
import { getShopCurrency } from "../models/shop.server";
import {
  PlusIcon,
  CartIcon,
  CashDollarIcon,
  PackageIcon,
  EmailIcon,
  ChartVerticalIcon,
  CheckIcon,
  AlertCircleIcon,
  ClockIcon,
  NotificationIcon,
  ChartLineIcon,
  SettingsIcon,
  ShieldCheckMarkIcon,
  OrderIcon,
  DeliveryIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { statusToTone } from "../lib/format";
import { badgeTone } from "../components/wc";
import {
  StatCard,
  QuickAction,
  SectionHead,
  ProgressRing,
  IconTile,
  Reveal,
  Hero,
  HeroButton,
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
};

const KPI_ICONS = [
  CashDollarIcon,
  ChartVerticalIcon,
  PackageIcon,
  EmailIcon,
] as const;
const KPI_TONES: TileTone[] = ["emerald", "violet", "amber", "sky"];

// Activity feed is event-log driven; until we wire that up, surface a small
// curated list so the panel isn't empty on first install.
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
  return data;
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

// ---------- Helpers ----------
// ---------- Sub-components ----------
function ReliabilityStat({
  label,
  value,
  alert,
  icon,
}: {
  label: string;
  value: string;
  alert: boolean;
  icon: typeof CashDollarIcon;
}) {
  const { t } = useLocale();
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      <IconTile icon={alert ? AlertCircleIcon : icon} tone={alert ? "rose" : "emerald"} />
      <s-stack direction="block" gap="none">
        <s-text fontSize="large" fontWeight="semibold">
          {value}
        </s-text>
        <s-text color="subdued" fontSize="small">
          {t(label)}
        </s-text>
      </s-stack>
    </s-stack>
  );
}

function ReliabilityBar({
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
  const delivery =
    r.waitlistDeliveryRate == null
      ? "—"
      : `${Math.round(r.waitlistDeliveryRate * 100)}%`;
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <SectionHead
          icon={ShieldCheckMarkIcon}
          tone={r.clean ? "emerald" : "rose"}
          title={t("Reliability")}
          sub={t("The 'must never' guarantees — measured, not estimated.")}
          action={
            <s-badge tone={r.clean ? "success" : "critical"}>
              {r.clean ? t("All clear") : t("Needs attention")}
            </s-badge>
          }
        />
        <s-divider />
        <s-stack direction="inline" gap="large-400" alignItems="center">
          <ReliabilityStat
            label="Oversell incidents"
            value={String(r.oversellIncidents)}
            alert={r.oversellIncidents > 0}
            icon={ShieldCheckMarkIcon}
          />
          <ReliabilityStat
            label="Untagged orders"
            value={String(r.untaggedOrders)}
            alert={r.untaggedOrders > 0}
            icon={OrderIcon}
          />
          <ReliabilityStat
            label="Waitlist delivery"
            value={delivery}
            alert={r.waitlistFailed > 0}
            icon={EmailIcon}
          />
        </s-stack>
      </s-stack>
    </s-section>
  );
}

function CohortRow({ cohort }: { cohort: Cohort }) {
  const { t } = useLocale();
  const pct = Math.min(
    100,
    Math.round((cohort.unitsSold / Math.max(1, cohort.unitsForecast)) * 100),
  );
  const ringTone: TileTone =
    cohort.status === "At risk" ? "amber" : cohort.status === "Ready to ship" ? "emerald" : "violet";
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      <ProgressRing percent={pct} tone={ringTone} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <s-stack direction="block" gap="small-200">
          <div className="encore-row-between">
            <s-stack direction="block" gap="none">
              <s-text type="strong">{cohort.name}</s-text>
              <s-text color="subdued" fontSize="small">
                {cohort.shipDate} · {cohort.gmv} {t("pre-sold")}
              </s-text>
            </s-stack>
            <s-badge tone={badgeTone(statusToTone(cohort.status))}>{t(cohort.status)}</s-badge>
          </div>
          <s-progress value={pct} max={100} accessibilityLabel={`${pct}%`} />
          <s-text color="subdued" fontSize="small">
            {cohort.unitsSold.toLocaleString()} / {cohort.unitsForecast.toLocaleString()} {t("units")}
          </s-text>
        </s-stack>
      </div>
    </s-stack>
  );
}

type ActivityItem = {
  icon: typeof CashDollarIcon;
  text: string;
  detail: string;
  time: string;
};

const ACTIVITY_TONES: TileTone[] = ["violet", "teal", "amber", "sky", "rose", "emerald"];

function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const { t } = useLocale();
  return (
    <s-stack direction="block" gap="base">
      {items.map((a, i) => (
        <Reveal key={`${a.text}-${i}`} index={i}>
          <s-stack direction="inline" gap="base" alignItems="start">
            <IconTile icon={a.icon} tone={ACTIVITY_TONES[i % ACTIVITY_TONES.length]} size="sm" />
            <s-stack direction="block" gap="none">
              <s-text fontWeight="medium">{t(a.text)}</s-text>
              <s-text color="subdued" fontSize="small">
                {t(a.detail)}
              </s-text>
              <s-text color="subdued" fontSize="small">
                {a.time}
              </s-text>
            </s-stack>
          </s-stack>
        </Reveal>
      ))}
    </s-stack>
  );
}

const DASHBOARD_CAMPAIGN_LIMIT = 5;

/**
 * Up to five preorders, each row a link to its own page. No checkboxes —
 * bulk actions live on the Preorders page, reached by "View all".
 */
function CampaignsList({ campaigns }: { campaigns: CampaignRow[] }) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const rows = campaigns.slice(0, DASHBOARD_CAMPAIGN_LIMIT);
  return (
    <div>
      {rows.map((c, i) => (
        <Reveal key={c.id} index={i}>
          <button
            type="button"
            className="encore-row"
            onClick={() => navigate(`/app/campaigns/${c.id}`)}
            aria-label={`${c.product} — ${t(c.status)}`}
          >
            <IconTile icon={CartIcon} tone={c.status === "Live" ? "emerald" : c.status === "Paused" ? "amber" : "slate"} size="sm" />
            <span className="encore-row__main">
              <span className="encore-row__title">{c.product}</span>
              <span className="encore-row__sub">
                {t(c.trigger)} · {t(c.payment)} · {t("Ships")} {c.shipDate}
              </span>
            </span>
            <span className="encore-row__meta">
              <span className="encore-row__units">{c.units} {t("units")}</span>
              <s-badge tone={badgeTone(statusToTone(c.status))}>{t(c.status)}</s-badge>
              <span className="encore-row__arrow"><s-icon type="arrow-right" /></span>
            </span>
          </button>
        </Reveal>
      ))}
    </div>
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
  const KPIS = data.kpis.map((k, i) => ({
    ...k,
    icon: KPI_ICONS[i] ?? CashDollarIcon,
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
  const ACTIVITY = data.activity.length
    ? data.activity.map((a) => ({
        icon: ACTIVITY_KIND_ICON[a.kind] ?? CheckIcon,
        text: a.text,
        detail: a.detail,
        time: a.time,
      }))
    : FALLBACK_ACTIVITY;

  const liveCount = CAMPAIGNS.filter((c) => c.status === "Live").length;
  return (
    <s-page inlineSize="large">
      <div className="encore-stack">
        <Hero
          eyebrow={t("Encore")}
          title={t("Preorders, cohorts, and back-in-stock at a glance.")}
          sub={t("Sell what isn't on the shelf yet — every preorder tagged, capped and tracked through to fulfillment.")}
          actions={
            <>
              <HeroButton primary icon={PlusIcon} onClick={() => navigate("/app/campaigns/new")}>
                {t("New preorder")}
              </HeroButton>
              <HeroButton icon={ClockIcon} onClick={() => navigate("/app/cohorts?view=cohorts")}>
                {t("Cohorts")}
              </HeroButton>
              <HeroButton icon={NotificationIcon} onClick={() => navigate("/app/waitlist")}>
                {t("Back in stock")}
              </HeroButton>
            </>
          }
          stats={[
            { value: String(liveCount), label: t("live now") },
            { value: KPIS[2]?.value ?? "0", label: t("units pre-sold") },
            { value: KPIS[3]?.value ?? "0", label: t("on waitlists") },
          ]}
        />

        {/* Quick actions */}
        <div className="encore-grid encore-grid--3">
          <QuickAction index={1} icon={CartIcon} tone="violet" title={t("Preorders")} sub={t("Create, pause, end, duplicate")} onClick={() => navigate("/app/campaigns")} />
          <QuickAction index={2} icon={ChartLineIcon} tone="teal" title={t("Insights")} sub={t("Demand, cohorts, low stock")} onClick={() => navigate("/app/insights")} />
          <QuickAction index={3} icon={SettingsIcon} tone="amber" title={t("Settings")} sub={t("Design, cart, notifications")} onClick={() => navigate("/app/settings")} />
        </div>

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

        {/* KPI tiles */}
        <div className="encore-grid encore-grid--4">
          {KPIS.map((kpi, i) => (
            <StatCard
              key={kpi.label}
              index={4 + i}
              label={t(kpi.label)}
              value={kpi.value}
              delta={kpi.delta}
              deltaTone={kpi.deltaTone}
              sub={t(kpi.sub)}
              icon={kpi.icon}
              tone={KPI_TONES[i] ?? "violet"}
            />
          ))}
        </div>

        {/* Reliability bar — §8 'must never' guarantees, from real audits */}
        <Reveal index={8}>
          <ReliabilityBar r={data.reliability} />
        </Reveal>

        {/* Cohorts + activity */}
        <Reveal index={9}>
          <div className="encore-layout">
            <s-section>
              <s-stack direction="block" gap="base">
                <SectionHead
                  icon={DeliveryIcon}
                  tone="violet"
                  title={t("Active cohorts")}
                  sub={t("Group of preorders sharing a ship date.")}
                  action={
                    <s-button variant="tertiary" icon="arrow-right" onClick={() => navigate("/app/cohorts")}>
                      {t("View all")}
                    </s-button>
                  }
                />
                <s-divider />
                {COHORTS.length === 0 ? (
                  <s-stack direction="block" gap="small">
                    <s-paragraph color="subdued">
                      {t("Cohorts group preorders by ship date — your first one appears when a preorder goes live.")}
                    </s-paragraph>
                    <s-stack direction="inline">
                      <s-button onClick={() => navigate("/app/onboarding")}>{t("Start setup")}</s-button>
                    </s-stack>
                  </s-stack>
                ) : (
                  <s-stack direction="block" gap="large">
                    {COHORTS.map((c, i) => (
                      <s-stack key={c.id} direction="block" gap="large">
                        <CohortRow cohort={c} />
                        {i < COHORTS.length - 1 && <s-divider />}
                      </s-stack>
                    ))}
                  </s-stack>
                )}
              </s-stack>
            </s-section>

            <s-section>
              <s-stack direction="block" gap="base">
                <SectionHead icon={ClockIcon} tone="sky" title={t("Recent activity")} />
                <s-divider />
                <ActivityFeed items={ACTIVITY} />
              </s-stack>
            </s-section>
          </div>
        </Reveal>

        {/* Preorders — top 5, click-through, View all */}
        <Reveal index={10}>
          <s-section padding="none">
            <s-box padding="base">
              <SectionHead
                icon={CartIcon}
                tone="violet"
                title={t("Preorders")}
                sub={t("Variant-level preorder rules.")}
                action={
                  <s-button variant="primary" icon="plus" onClick={() => navigate("/app/campaigns/new")}>
                    {t("New preorder")}
                  </s-button>
                }
              />
            </s-box>
            <s-divider />
            {CAMPAIGNS.length === 0 ? (
              <s-box padding="large">
                <s-empty-state heading={t("No preorders yet")}>
                  <s-paragraph slot="subheading">
                    {t("Pre-sell upcoming launches, capture demand on sold-out SKUs, or build a back-in-stock waitlist.")}
                  </s-paragraph>
                  <s-button slot="primary-action" variant="primary" onClick={() => navigate("/app/campaigns/new")}>
                    {t("Set up your first preorder")}
                  </s-button>
                </s-empty-state>
              </s-box>
            ) : (
              <>
                <CampaignsList campaigns={CAMPAIGNS} />
                <s-divider />
                <s-box padding="small">
                  <s-stack direction="inline" justifyContent="end">
                    <s-button variant="tertiary" icon="arrow-right" onClick={() => navigate("/app/campaigns")}>
                      {t("View all preorders")}
                    </s-button>
                  </s-stack>
                </s-box>
              </>
            )}
          </s-section>
        </Reveal>
      </div>
    </s-page>
  );
}
