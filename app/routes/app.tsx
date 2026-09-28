import type { HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import appStyles from "../app.css?url";
import { Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { pricingConfigured, needsPlan } from "../services/app-pricing.server";
import { planSelectionUrl } from "../lib/admin-url.server";
import {
  LocaleProvider,
  toSupportedLocale,
  useLocale,
  type Locale,
} from "../lib/i18n";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: appStyles }];

// Polaris web components take their chrome strings (modal close, pagination…)
// from the admin's own locale, so no per-locale bundle ships with the app.

// Store locale is stable — one Admin API round-trip per shop per hour, not one
// per navigation (this loader runs on EVERY client-side transition).
const LOCALE_TTL_MS = 60 * 60 * 1000;
const localeCache = new Map<string, { locale: Locale; at: number }>();

// Just picked a plan (the welcome link carries `plan_handle`): don't send the
// merchant back to the plan page for a few minutes even if the Partner API
// hasn't caught up yet.
const PLAN_GRACE_MS = 10 * 60 * 1000;
const planGrace = new Map<string, number>();
const PLAN_GATE_EXEMPT = ["/app/help"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, redirect } = await authenticate.admin(request);

  // Shopify App Pricing (2026-09-28): a store must pick a plan (plans carry the
  // free trial) before using Encore. Off until the Partner API is configured;
  // any error fails open (app-pricing.server).
  if (pricingConfigured()) {
    const url = new URL(request.url);
    const justPicked = url.searchParams.has("plan_handle");
    if (justPicked) planGrace.set(session.shop, Date.now() + PLAN_GRACE_MS);
    const inGrace = (planGrace.get(session.shop) ?? 0) > Date.now();
    const exempt = PLAN_GATE_EXEMPT.some((p) => url.pathname.startsWith(p));
    const noPlan = await needsPlan(admin, session.shop, { force: justPicked });
    if (noPlan && !inGrace && !exempt) {
      throw redirect(planSelectionUrl(session.shop), { target: "_top" });
    }
  }

  // Store's primary locale → default admin language (manual choice still wins).
  let storeLocale: Locale = "en";
  const cached = localeCache.get(session.shop);
  if (cached && Date.now() - cached.at < LOCALE_TTL_MS) {
    storeLocale = cached.locale;
  } else {
    try {
      const res = await admin.graphql(`query { shop { primaryLocale } }`);
      const body = (await res.json()) as {
        data?: { shop?: { primaryLocale?: string | null } | null };
      };
      storeLocale = toSupportedLocale(body?.data?.shop?.primaryLocale);
      localeCache.set(session.shop, { locale: storeLocale, at: Date.now() });
    } catch {
      // Locale detection must never block the admin — fall back to English.
    }
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", storeLocale };
};

/**
 * Navigation feedback: the admin's own top loading bar (App Bridge
 * `shopify.loading`) while a loader / action is in flight, and the page
 * content softens slightly so the merchant sees the click registered.
 * Nothing fake, nothing flashy.
 */
function useBusy(): boolean {
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const busy = navigation.state !== "idle";
  useEffect(() => {
    try {
      shopify.loading(busy);
    } catch {
      /* outside the admin (tests, previews) */
    }
    return () => {
      try {
        shopify.loading(false);
      } catch {
        /* noop */
      }
    };
  }, [busy, shopify]);
  return busy;
}

function Content() {
  const busy = useBusy();
  return (
    <div className={"encore-content" + (busy ? " encore-content--busy" : "")} aria-busy={busy || undefined}>
      <Outlet />
    </div>
  );
}

function AppNav() {
  const { t } = useLocale();
  return (
    <s-app-nav>
      {/* E1: 6 nav items. Cohorts/Demand/Benchmark/Low-stock → Insights tabs;
          Markets/Translations/Notifications → Settings tabs (all still reachable). */}
      <s-link href="/app">{t("nav.dashboard")}</s-link>
      <s-link href="/app/campaigns">{t("nav.preorders")}</s-link>
      <s-link href="/app/waitlist">{t("nav.backinstock")}</s-link>
      <s-link href="/app/low-stock">{t("nav.lowstock")}</s-link>
      <s-link href="/app/insights">{t("nav.insights")}</s-link>
      <s-link href="/app/settings">{t("nav.settings")}</s-link>
      <s-link href="/app/plans">{t("nav.plans")}</s-link>
    </s-app-nav>
  );
}

/**
 * Polaris web components, pinned to the newest stable v1 release (1.1 as of
 * 2026-09-22) per shopify.dev/docs/api/app-home/versioning. Move to
 * `polaris-2.js` once Polaris 2.0 (the refreshed admin look) leaves RC.
 */
const POLARIS_URL = "https://cdn.shopify.com/shopifycloud/polaris-1.js";

export default function App() {
  const { apiKey, storeLocale } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey} polarisUrl={POLARIS_URL}>
      <LocaleProvider defaultLocale={storeLocale}>
        <AppNav />
        <Content />
      </LocaleProvider>
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
