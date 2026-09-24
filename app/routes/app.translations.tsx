import { useMemo, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { LanguageIcon } from "@shopify/polaris-icons";
import { PageHero } from "../components/ui";
import { val } from "../components/wc";
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
    // Only the merchant's SAVED translations count as "done" (QA 2026-08-31:
    // bundled sample texts inflated the "n/n translated" badge). Samples now
    // appear only as placeholder suggestions in the empty fields below.
    const merged: Record<string, Record<string, string>> = {};
    for (const [loc, m] of Object.entries(saved))
      merged[loc] = { ...m };
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
    <s-page inlineSize="large">
      <div className="encore-stack">
        <PageHero
          icon={LanguageIcon}
          tone="violet"
          title={t("translations.title")}
          sub={t("Translate the text Encore adds to your storefront. Switches with the shopper's language — set once, not per market.")}
          actions={
            <s-button variant="primary" onClick={save}>
              {t("common.save")}
            </s-button>
          }
        />
        <s-banner tone="info">
          {t("The admin language follows your Shopify account automatically. Below you translate the storefront text we add (button, badge, cart, popup, low-stock) — these register with Shopify so they switch with the buyer's language alongside Translate & Adapt.")}
        </s-banner>

        <s-section>
          <s-stack direction="block" gap="base">
            <div className="encore-row-between">
              <s-select label={t("Language to translate")} value={locale} onChange={(e) => setLocale(val(e))}>
                {targets.map((l) => (
                  <s-option key={l.code} value={l.code}>
                    {l.published ? l.name : `${l.name} ${t("(not published)")}`}
                  </s-option>
                ))}
              </s-select>
              <s-badge tone={done === STOREFRONT_STRINGS.length ? "success" : "caution"}>
                {`${done} / ${STOREFRONT_STRINGS.length} ${t("translated")}`}
              </s-badge>
            </div>
            {localeMeta && !localeMeta.published && (
              <s-banner tone="warning">
                {t("If this language isn't published on your storefront yet, publish it in Shopify Settings → Languages.")}
              </s-banner>
            )}
          </s-stack>
        </s-section>

        {done === 0 && (
          <s-section heading={`${t("No translations yet for")} ${localeMeta?.name ?? locale}`}>
            <s-paragraph color="subdued">
              {t("Every storefront string Encore adds can be customised per language — fill in any field below and save to override the English default for shoppers browsing in this language.")}
            </s-paragraph>
          </s-section>
        )}

        {GROUPS.map((group) => {
          const items = STOREFRONT_STRINGS.filter((s) => s.group === group);
          if (items.length === 0) return null;
          return (
            <s-section key={group} heading={t(group)}>
              <s-stack direction="block" gap="base">
                {items.map((s) => (
                  <s-grid key={s.key} gridTemplateColumns="1fr 1fr" gap="base" alignItems="start">
                    <s-stack direction="block" gap="none">
                      <s-text type="strong">{t(s.label)}</s-text>
                      <s-text color="subdued" fontSize="small">
                        {s.defaultValue}
                      </s-text>
                    </s-stack>
                    <s-text-field
                      label={localeMeta?.name ?? locale}
                      labelAccessibilityVisibility="exclusive"
                      value={(translations[locale] ?? {})[s.key] ?? ""}
                      onInput={(e) => setVal(s.key, val(e))}
                      placeholder={
                        SAMPLE_TRANSLATIONS[locale]?.[s.key] ??
                        `${t("Translate to")} ${localeMeta?.name ?? locale}…`
                      }
                    />
                  </s-grid>
                ))}
              </s-stack>
            </s-section>
          );
        })}

        <s-stack direction="inline" justifyContent="end">
          <s-button variant="primary" onClick={save}>
            {t("common.save")}
          </s-button>
        </s-stack>
      </div>
    </s-page>
  );
}
