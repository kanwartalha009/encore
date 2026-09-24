/**
 * Settings → Notifications (N1).
 * Pick the provider (Klaviyo or Shopify Flow) and edit + translate the customer
 * email copy per message type. The copy feeds both paths (Klaviyo event props /
 * the "Send email" Flow action).
 */
import { useEffect, useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { EmailIcon } from "@shopify/polaris-icons";
import { PageHero } from "../components/ui";
import { flag, val, vals } from "../components/wc";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import {
  getNotificationSettings,
  saveNotificationSettings,
  defaultTemplate,
  type MessageType,
  type NotificationProvider,
  type NotificationSettings,
} from "../services/notifications.server";
import { MESSAGE_TYPES } from "../lib/notifications-shared";
import { isConnected, klaviyoConfigured } from "../services/klaviyo-oauth.server";

const LOCALES = ["en", "es", "fr", "de", "it", "pt", "nl", "pl"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [settings, klaviyoOAuth] = await Promise.all([
    getNotificationSettings(session.shop),
    isConnected(session.shop),
  ]);
  const defaults = Object.fromEntries(
    MESSAGE_TYPES.map((m) => [m.type, defaultTemplate(m.type)]),
  );
  return { settings, defaults, klaviyoOAuth, klaviyoConfigurable: klaviyoConfigured() };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();

  const current = await getNotificationSettings(session.shop);
  const provider = String(fd.get("provider") ?? current.provider) as NotificationProvider;
  const klaviyoBisMode =
    String(fd.get("klaviyoBisMode") ?? current.klaviyoBisMode) === "native"
      ? "native"
      : "events";
  const type = String(fd.get("type") ?? "");
  const locale = String(fd.get("locale") ?? "en") || "en";
  const subject = String(fd.get("subject") ?? "");
  const body = String(fd.get("body") ?? "");

  const templates = { ...current.templates };
  if (type) {
    templates[type] = { ...(templates[type] ?? {}), [locale]: { subject, body } };
  }
  const next: NotificationSettings = { provider, klaviyoBisMode, templates };
  await saveNotificationSettings(session.shop, next);
  return { ok: true };
};

export const headers: HeadersFunction = (h) => boundary.headers(h);

export default function NotificationsPage() {
  const { t } = useLocale();
  // Klaviyo OAuth starts with an authenticated fetch, then a top-level hop.
  const klaviyoConnect = useFetcher<{ url?: string; error?: string }>();
  useEffect(() => {
    const u = klaviyoConnect.data?.url;
    if (u) window.open(u, "_top");
  }, [klaviyoConnect.data]);
  const { settings, defaults, klaviyoOAuth, klaviyoConfigurable } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const klaviyoStatus = searchParams.get("klaviyo") || (klaviyoConnect.data?.error === "unconfigured" ? "unconfigured" : null);

  const [provider, setProvider] = useState<NotificationProvider>(settings.provider);
  const [bisMode, setBisMode] = useState<"events" | "native">(settings.klaviyoBisMode);
  const [type, setType] = useState<MessageType>(MESSAGE_TYPES[0].type);
  const [locale, setLocale] = useState("en");

  const savedFor = (ty: MessageType, lo: string) =>
    settings.templates?.[ty]?.[lo] ?? defaults[ty];

  const [subject, setSubject] = useState(savedFor(type, locale).subject);
  const [body, setBody] = useState(savedFor(type, locale).body);

  // Reset the editor when the type/locale selection changes.
  const onPick = (ty: MessageType, lo: string) => {
    setType(ty);
    setLocale(lo);
    const tpl = savedFor(ty, lo);
    setSubject(tpl.subject);
    setBody(tpl.body);
  };

  const vars = useMemo(
    () => MESSAGE_TYPES.find((m) => m.type === type)?.vars ?? [],
    [type],
  );
  const saving = fetcher.state !== "idle";

  const save = () => {
    const data = new FormData();
    data.set("provider", provider);
    data.set("klaviyoBisMode", bisMode);
    data.set("type", type);
    data.set("locale", locale);
    data.set("subject", subject);
    data.set("body", body);
    fetcher.submit(data, { method: "post" });
  };

  return (
    <s-page inlineSize="large">
      <div className="encore-stack">
        <PageHero icon={EmailIcon} tone="sky" title={t("Notifications")} sub={t("Choose how customer emails are sent, and edit the copy per language.")} />
        <s-paragraph color="subdued">
          {t("Encore delivers customer emails through Klaviyo or Shopify Flow — pick whichever your store already uses, then tailor the copy for each message and language below.")}
        </s-paragraph>
        {fetcher.data?.ok && <s-banner tone="success">{t("Saved.")}</s-banner>}
        {klaviyoStatus === "connected" && <s-banner tone="success">{t("Klaviyo connected.")}</s-banner>}
        {klaviyoStatus === "error" && <s-banner tone="critical">{t("Klaviyo connection failed. Please try again.")}</s-banner>}
        {klaviyoStatus === "unconfigured" && (
          <s-banner tone="warning">{t("Klaviyo OAuth isn't configured on this app yet — paste an API key instead.")}</s-banner>
        )}

        <div className="encore-layout" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)" }}>
          <s-section heading={t("Provider")} subheading={t("Most stores already run one of these — no new cost.")}>
            <s-stack direction="block" gap="base">
              <s-choice-list label={t("Provider")} labelAccessibilityVisibility="exclusive" name="provider" onChange={(e) => setProvider((vals(e)[0] as NotificationProvider) ?? "off")}>
                <s-choice value="klaviyo" selected={flag(provider === "klaviyo")}>
                  {t("Klaviyo")}
                  <s-text slot="details">{t("Encore sends events + copy; your Klaviyo flow emails.")}</s-text>
                </s-choice>
                <s-choice value="shopify_flow" selected={flag(provider === "shopify_flow")}>
                  {t("Shopify Flow")}
                  <s-text slot="details">{t("A Flow workflow emails via the Encore 'Send email' action.")}</s-text>
                </s-choice>
                <s-choice value="off" selected={flag(provider === "off")}>
                  {t("Off")}
                  <s-text slot="details">{t("No automated customer emails.")}</s-text>
                </s-choice>
              </s-choice-list>

              {provider === "klaviyo" && (
                <s-stack direction="block" gap="base">
                  <s-divider />
                  <div className="encore-row-between">
                    <s-text>{t("Klaviyo connection")}</s-text>
                    <s-badge tone={klaviyoOAuth ? "success" : "auto"}>
                      {klaviyoOAuth ? t("Connected (OAuth)") : t("Not connected")}
                    </s-badge>
                  </div>
                  {klaviyoConfigurable ? (
                    <s-button
                      onClick={() => klaviyoConnect.load("/klaviyo/connect")}
                      loading={flag(klaviyoConnect.state !== "idle")}
                      variant={klaviyoOAuth ? "secondary" : "primary"}
                    >
                      {klaviyoOAuth ? t("Reconnect Klaviyo") : t("Connect Klaviyo")}
                    </s-button>
                  ) : (
                    <s-text color="subdued" fontSize="small">
                      {t("Or paste a Klaviyo private API key in Settings → Email integrations.")}
                    </s-text>
                  )}
                  <s-choice-list label={t("Back-in-stock mode")} name="bisMode" onChange={(e) => setBisMode((vals(e)[0] as "events" | "native") ?? "events")}>
                    <s-choice value="events" selected={flag(bisMode === "events")}>
                      {t("Encore events")}
                      <s-text slot="details">{t("Encore sends a Back in Stock event on restock.")}</s-text>
                    </s-choice>
                    <s-choice value="native" selected={flag(bisMode === "native")}>
                      {t("Klaviyo native")}
                      <s-text slot="details">{t("Subscribe shoppers to Klaviyo's own back-in-stock at signup (needs the catalog synced).")}</s-text>
                    </s-choice>
                  </s-choice-list>
                </s-stack>
              )}
            </s-stack>
          </s-section>

          <s-section heading={t("Email templates")}>
            <s-stack direction="block" gap="base">
              <s-grid gridTemplateColumns="2fr 1fr" gap="base">
                <s-select label={t("Message")} value={type} onChange={(e) => onPick(val(e) as MessageType, locale)}>
                  {MESSAGE_TYPES.map((m) => (
                    <s-option key={m.type} value={m.type}>
                      {t(m.label)}
                    </s-option>
                  ))}
                </s-select>
                <s-select label={t("Language")} value={locale} onChange={(e) => onPick(type, val(e))}>
                  {LOCALES.map((l) => (
                    <s-option key={l} value={l}>
                      {l.toUpperCase()}
                    </s-option>
                  ))}
                </s-select>
              </s-grid>

              <s-text-field label={t("Subject")} value={subject} onInput={(e) => setSubject(val(e))} />
              <s-text-area label={t("Body")} value={body} rows={6} onInput={(e) => setBody(val(e))} />

              <s-stack direction="inline" gap="small-200" alignItems="center">
                <s-text color="subdued" fontSize="small">
                  {t("Variables:")}
                </s-text>
                {vars.map((v) => (
                  <s-badge key={v}>{`{{${v}}}`}</s-badge>
                ))}
              </s-stack>

              <s-divider />
              <s-stack direction="inline" justifyContent="end">
                <s-button variant="primary" onClick={save} loading={flag(saving)}>
                  {t("Save")}
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        </div>
      </div>
    </s-page>
  );
}
