import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";

import { authenticate } from "../shopify.server";
import { LocaleProvider, useLocale } from "../lib/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

function AppNav() {
  const { t } = useLocale();
  return (
    <s-app-nav>
      <s-link href="/app">{t("nav.dashboard")}</s-link>
      <s-link href="/app/campaigns">{t("nav.preorders")}</s-link>
      <s-link href="/app/cohorts">{t("nav.orders")}</s-link>
      <s-link href="/app/demand">{t("Demand")}</s-link>
      <s-link href="/app/markets">{t("Markets")}</s-link>
      <s-link href="/app/benchmark">{t("Benchmark")}</s-link>
      <s-link href="/app/waitlist">{t("nav.backinstock")}</s-link>
      <s-link href="/app/low-stock">{t("nav.lowstock")}</s-link>
      <s-link href="/app/translations">{t("nav.translations")}</s-link>
      <s-link href="/app/notifications">{t("Notifications")}</s-link>
      <s-link href="/app/settings">{t("nav.settings")}</s-link>
      <s-link href="/app/plans">{t("Plans")}</s-link>
    </s-app-nav>
  );
}

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <PolarisAppProvider i18n={enTranslations}>
        <LocaleProvider>
          <AppNav />
          <Outlet />
        </LocaleProvider>
      </PolarisAppProvider>
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
