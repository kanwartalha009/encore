/**
 * Settings → Notifications (N1).
 * Pick the provider (Klaviyo or Shopify Flow) and edit + translate the customer
 * email copy per message type. The copy feeds both paths (Klaviyo event props /
 * the "Send email" Flow action).
 */
import { useMemo, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  ChoiceList,
  Select,
  TextField,
  Button,
  Badge,
  Banner,
  Box,
  Divider,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import {
  getNotificationSettings,
  saveNotificationSettings,
  defaultTemplate,
  MESSAGE_TYPES,
  type MessageType,
  type NotificationProvider,
  type NotificationSettings,
} from "../services/notifications.server";
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
  const { settings, defaults, klaviyoOAuth, klaviyoConfigurable } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [searchParams] = useSearchParams();
  const klaviyoStatus = searchParams.get("klaviyo");

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
    <Page
      title={t("Notifications")}
      subtitle={t("Choose how customer emails are sent, and edit the copy per language.")}
    >
      <BlockStack gap="500">
        {fetcher.data?.ok && (
          <Banner tone="success" onDismiss={() => {}}>
            {t("Saved.")}
          </Banner>
        )}
        {klaviyoStatus === "connected" && (
          <Banner tone="success">{t("Klaviyo connected.")}</Banner>
        )}
        {klaviyoStatus === "error" && (
          <Banner tone="critical">{t("Klaviyo connection failed. Please try again.")}</Banner>
        )}
        {klaviyoStatus === "unconfigured" && (
          <Banner tone="warning">
            {t("Klaviyo OAuth isn't configured on this app yet — paste an API key instead.")}
          </Banner>
        )}

        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">{t("Provider")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("Most stores already run one of these — no new cost.")}
                </Text>
                <ChoiceList
                  title=""
                  titleHidden
                  choices={[
                    { label: t("Klaviyo"), value: "klaviyo", helpText: t("Encore sends events + copy; your Klaviyo flow emails.") },
                    { label: t("Shopify Flow"), value: "shopify_flow", helpText: t("A Flow workflow emails via the Encore 'Send email' action.") },
                    { label: t("Off"), value: "off", helpText: t("No automated customer emails.") },
                  ]}
                  selected={[provider]}
                  onChange={(v) => setProvider((v[0] as NotificationProvider) ?? "off")}
                />

                {provider === "klaviyo" && (
                  <BlockStack gap="300">
                    <Divider />
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">{t("Klaviyo connection")}</Text>
                      <Badge tone={klaviyoOAuth ? "success" : undefined}>
                        {klaviyoOAuth ? t("Connected (OAuth)") : t("Not connected")}
                      </Badge>
                    </InlineStack>
                    {klaviyoConfigurable ? (
                      <Button
                        url="/klaviyo/connect"
                        variant={klaviyoOAuth ? "secondary" : "primary"}
                      >
                        {klaviyoOAuth ? t("Reconnect Klaviyo") : t("Connect Klaviyo")}
                      </Button>
                    ) : (
                      <Text as="p" variant="bodySm" tone="subdued">
                        {t("Or paste a Klaviyo private API key in Settings → Email integrations.")}
                      </Text>
                    )}
                    <ChoiceList
                      title={t("Back-in-stock mode")}
                      choices={[
                        { label: t("Encore events"), value: "events", helpText: t("Encore sends a Back in Stock event on restock.") },
                        { label: t("Klaviyo native"), value: "native", helpText: t("Subscribe shoppers to Klaviyo's own back-in-stock at signup (needs the catalog synced).") },
                      ]}
                      selected={[bisMode]}
                      onChange={(v) => setBisMode((v[0] as "events" | "native") ?? "events")}
                    />
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{t("Email templates")}</Text>
                <InlineStack gap="300">
                  <Box minWidth="220px">
                    <Select
                      label={t("Message")}
                      options={MESSAGE_TYPES.map((m) => ({ label: t(m.label), value: m.type }))}
                      value={type}
                      onChange={(v) => onPick(v as MessageType, locale)}
                    />
                  </Box>
                  <Box minWidth="120px">
                    <Select
                      label={t("Language")}
                      options={LOCALES.map((l) => ({ label: l.toUpperCase(), value: l }))}
                      value={locale}
                      onChange={(v) => onPick(type, v)}
                    />
                  </Box>
                </InlineStack>

                <TextField
                  label={t("Subject")}
                  value={subject}
                  onChange={setSubject}
                  autoComplete="off"
                />
                <TextField
                  label={t("Body")}
                  value={body}
                  onChange={setBody}
                  multiline={6}
                  autoComplete="off"
                />

                <InlineStack gap="100" wrap>
                  <Text as="span" variant="bodySm" tone="subdued">{t("Variables:")}</Text>
                  {vars.map((v) => (
                    <Badge key={v}>{`{{${v}}}`}</Badge>
                  ))}
                </InlineStack>

                <Divider />
                <InlineStack align="end">
                  <Button variant="primary" onClick={save} loading={saving}>
                    {t("Save")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
