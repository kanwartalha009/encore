import type { HeadersFunction, LinksFunction, LoaderFunctionArgs } from "react-router";
import appStyles from "../app.css?url";
import { Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
import { useEffect } from "react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import esTranslations from "@shopify/polaris/locales/es.json";
import frTranslations from "@shopify/polaris/locales/fr.json";
import deTranslations from "@shopify/polaris/locales/de.json";
import itTranslations from "@shopify/polaris/locales/it.json";
import ptTranslations from "@shopify/polaris/locales/pt-BR.json";
import nlTranslations from "@shopify/polaris/locales/nl.json";
import plTranslations from "@shopify/polaris/locales/pl.json";
import type { ReactNode } from "react";

import { authenticate } from "../shopify.server";
import { RouterLink } from "../components/RouterLink";
import {
  LocaleProvider,
  toSupportedLocale,
  useLocale,
  type Locale,
} from "../lib/i18n";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: appStyles }];

// Polaris chrome (modals, pickers, pagination…) follows the active app locale.
const POLARIS_TRANSLATIONS: Record<Locale, typeof enTranslations> = {
  en: enTranslations,
  es: esTranslations,
  fr: frTranslations,
  de: deTranslations,
  it: itTranslations,
  pt: ptTranslations,
  nl: nlTranslations,
  pl: plTranslations,
};

// Store locale is stable — one Admin API round-trip per shop per hour, not one
// per navigation (this loader runs on EVERY client-side transition).
const LOCALE_TTL_MS = 60 * 60 * 1000;
const localeCache = new Map<string, { locale: Locale; at: number }>();

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

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
 * `shopify.loading`) while any loader / action is in flight, plus a thin
 * in-app progress bar so the merchant always sees that a click registered.
 */
function NavigationProgress() {
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
  return (
    <div className={"encore-nav-progress" + (busy ? " encore-nav-progress--on" : "")} aria-hidden="true">
      <div className="encore-nav-progress__bar" />
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
      <s-link href="/app/insights">{t("nav.insights")}</s-link>
      <s-link href="/app/settings">{t("nav.settings")}</s-link>
      <s-link href="/app/plans">{t("nav.plans")}</s-link>
    </s-app-nav>
  );
}

/** Inside LocaleProvider so Polaris re-renders with the active locale's strings. */
function LocalizedPolarisProvider({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  return (
    <PolarisAppProvider i18n={POLARIS_TRANSLATIONS[locale] ?? enTranslations} linkComponent={RouterLink}>
      {children}
    </PolarisAppProvider>
  );
}

export default function App() {
  const { apiKey, storeLocale } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <LocaleProvider defaultLocale={storeLocale}>
        <LocalizedPolarisProvider>
          <AppNav />
          <NavigationProgress />
          <Outlet />
        </LocalizedPolarisProvider>
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
