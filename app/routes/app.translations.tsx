import { useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Select,
  TextField,
  Divider,
  Banner,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import {
  DEMO_LOCALES,
  STOREFRONT_STRINGS,
  SAMPLE_TRANSLATIONS,
} from "../lib/demoStorefront";
import { useLocale } from "../lib/i18n";
import { getTranslations, saveTranslations } from "../models/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const saved = await getTranslations(session.shop);
  return { saved };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const locale = String(fd.get("locale") ?? "");
  let entries: Record<string, string> = {};
  try {
    entries = JSON.parse(String(fd.get("entries") ?? "{}"));
  } catch {
    entries = {};
  }
  if (locale) await saveTranslations(session.shop, locale, entries);
  return Response.json({ ok: true });
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

const GROUPS = ["Preorder", "Back in stock", "Low stock"] as const;

export default function TranslationsPage() {
  const shopify = useAppBridge();
  const { t } = useLocale();
  const { saved } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const targets = DEMO_LOCALES.filter((l) => !l.primary);
  const [locale, setLocale] = useState(targets[0]?.code ?? "es");
  const [translations, setTranslations] = useState<
    Record<string, Record<string, string>>
  >(() => {
    const merged: Record<string, Record<string, string>> = {};
    for (const [loc, m] of Object.entries(SAMPLE_TRANSLATIONS))
      merged[loc] = { ...m };
    for (const [loc, m] of Object.entries(saved))
      merged[loc] = { ...(merged[loc] ?? {}), ...m };
    return merged;
  });

  const localeMeta = DEMO_LOCALES.find((l) => l.code === locale);

  const setVal = (key: string, value: string) =>
    setTranslations((prev) => ({
      ...prev,
      [locale]: { ...(prev[locale] ?? {}), [key]: value },
    }));

  const done = useMemo(() => {
    const map = translations[locale] ?? {};
    return STOREFRONT_STRINGS.filter((s) => (map[s.key] ?? "").trim().length > 0).length;
  }, [translations, locale]);

  const save = () => {
    submit(
      { locale, entries: JSON.stringify(translations[locale] ?? {}) },
      { method: "post" },
    );
    shopify.toast.show(`${t("Translations saved for")} ${localeMeta?.name}`);
  };

  return (
    <Page
      title={t("translations.title")}
      subtitle={t("Translate the text Encore adds to your storefront. Switches with the shopper's language — set once, not per market.")}
      primaryAction={{ content: t("common.save"), onAction: save }}
    >
      <BlockStack gap="500">
        <Banner tone="info" onDismiss={() => {}}>
          <Text as="span">{t("The admin language follows your Shopify account automatically. Below you translate the storefront text we add (button, badge, cart, popup, low-stock) — these register with Shopify so they switch with the buyer's language alongside Translate & Adapt.")}</Text>
        </Banner>

        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Select
                label={t("Language to translate")}
                options={targets.map((l) => ({
                  label: l.published ? l.name : `${l.name} ${t("(not published)")}`,
                  value: l.code,
                }))}
                value={locale}
                onChange={setLocale}
              />
              <Badge tone={done === STOREFRONT_STRINGS.length ? "success" : "attention"}>
                {`${done} / ${STOREFRONT_STRINGS.length} ${t("translated")}`}
              </Badge>
            </InlineStack>
            {localeMeta && !localeMeta.published && (
              <Banner tone="warning">
                <Text as="span">
                  {localeMeta.name} {t("isn't published on your storefront yet — publish it in Shopify → Settings → Languages for these to show.")}
                </Text>
              </Banner>
            )}
          </BlockStack>
        </Card>

        {GROUPS.map((group) => {
          const items = STOREFRONT_STRINGS.filter((s) => s.group === group);
          if (items.length === 0) return null;
          return (
            <Card key={group}>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{t(group)}</Text>
                <Divider />
                <BlockStack gap="400">
                  {items.map((s) => (
                    <InlineStack key={s.key} gap="400" align="space-between" blockAlign="start" wrap={false}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <BlockStack gap="050">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">{t(s.label)}</Text>
                          <Text as="span" variant="bodySm" tone="subdued">{s.defaultValue}</Text>
                        </BlockStack>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <TextField
                          label={localeMeta?.name ?? locale}
                          labelHidden
                          value={(translations[locale] ?? {})[s.key] ?? ""}
                          onChange={(v) => setVal(s.key, v)}
                          autoComplete="off"
                          placeholder={`${t("Translate to")} ${localeMeta?.name ?? locale}…`}
                        />
                      </div>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          );
        })}

        <InlineStack align="end">
          <Button variant="primary" onClick={save}>{t("common.save")}</Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
