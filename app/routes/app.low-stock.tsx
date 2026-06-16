import { useState } from "react";
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
  Button,
  Box,
  TextField,
  Select,
  Divider,
  Banner,
} from "@shopify/polaris";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { LOW_STOCK_PRESETS, type LowStockPreset } from "../lib/demoStorefront";
import { DEMO_COLLECTIONS } from "../lib/demoProducts";
import { CollectionPicker } from "../lib/storefrontKit";
import { useLocale } from "../lib/i18n";
import { getSettings, saveSettingsSection } from "../models/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { lowStock } = await getSettings(session.shop);
  return { saved: lowStock };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    data = {};
  }
  await saveSettingsSection(session.shop, "lowStock", data);
  return Response.json({ ok: true });
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

type PresetId = LowStockPreset["id"];

function fillText(tpl: string, n: number, threshold: number) {
  return tpl
    .replace(/\{n\}/g, String(n))
    .replace(/\{available\}/g, String(n))
    .replace(/\{threshold\}/g, String(threshold));
}

function thresholdColor(ratio: number, accent: string) {
  if (ratio <= 0.34) return "#D72C0D";
  if (ratio <= 0.67) return "#B98900";
  return accent;
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <InlineStack gap="300" blockAlign="end">
      <Box minWidth="180px">
        <TextField label={label} value={value} onChange={onChange} autoComplete="off" />
      </Box>
      <div style={{ width: 32, height: 32, borderRadius: 8, background: value, border: "1px solid #E1E3E5" }} />
    </InlineStack>
  );
}

function LowStockPreview({
  preset,
  text,
  barColor,
  bgColor,
  textColor,
  n,
  threshold,
}: {
  preset: PresetId;
  text: string;
  barColor: string;
  bgColor: string;
  textColor: string;
  n: number;
  threshold: number;
}) {
  const label = fillText(text, n, threshold);
  const ratio = Math.min(1, n / Math.max(1, threshold));
  const fill = preset === "color" ? thresholdColor(ratio, barColor) : barColor;

  const Bar = ({ animated }: { animated?: boolean }) => (
    <div style={{ height: 8, borderRadius: 999, background: bgColor, overflow: "hidden" }}>
      <div
        className={animated ? "encore-lowstock-pulse" : undefined}
        style={{ height: "100%", width: `${ratio * 100}%`, background: fill }}
      />
    </div>
  );

  return (
    <div className="encore-lowstock" style={{ maxWidth: 280 }}>
      <style
        dangerouslySetInnerHTML={{
          __html:
            "@keyframes encorePulse{0%{opacity:1}50%{opacity:.55}100%{opacity:1}}.encore-lowstock-pulse{animation:encorePulse 1.2s ease-in-out infinite}",
        }}
      />
      {preset === "text" && (
        <span style={{ color: textColor, fontWeight: 600, fontSize: 14 }}>{label}</span>
      )}
      {preset === "bar_text" && (
        <div>
          <Bar />
          <div style={{ marginTop: 6, color: textColor, fontSize: 13 }}>{label}</div>
        </div>
      )}
      {preset === "segmented" && (
        <div>
          <div style={{ display: "flex", gap: 3 }}>
            {Array.from({ length: Math.min(10, threshold) }).map((_, i) => (
              <div key={i} style={{ flex: 1, height: 8, borderRadius: 2, background: i < n ? barColor : bgColor }} />
            ))}
          </div>
          <div style={{ marginTop: 6, color: textColor, fontSize: 13 }}>{label}</div>
        </div>
      )}
      {preset === "pill" && (
        <span style={{ display: "inline-block", background: barColor, color: "#fff", borderRadius: 999, padding: "4px 12px", fontSize: 12, fontWeight: 600 }}>
          {label}
        </span>
      )}
      {preset === "color" && (
        <div>
          <Bar />
          <div style={{ marginTop: 6, color: fill, fontSize: 13, fontWeight: 600 }}>{label}</div>
        </div>
      )}
      {preset === "pulse" && (
        <div>
          <Bar animated />
          <div style={{ marginTop: 6, color: textColor, fontSize: 13 }}>{label}</div>
        </div>
      )}
    </div>
  );
}

function PresetCard({
  preset,
  active,
  onClick,
}: {
  preset: LowStockPreset;
  active: boolean;
  onClick: () => void;
}) {
  const { t } = useLocale();
  return (
    <button type="button" onClick={onClick} style={{ all: "unset", cursor: "pointer", flex: 1, minWidth: 0 }}>
      <Box
        padding="300"
        borderWidth={active ? "050" : "025"}
        borderColor={active ? "border-emphasis" : "border"}
        borderRadius="300"
        background={active ? "bg-surface-secondary" : undefined}
      >
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{t(preset.name)}</Text>
          <Text as="span" variant="bodySm" tone="subdued">{t(preset.desc)}</Text>
        </BlockStack>
      </Box>
    </button>
  );
}

export default function LowStockPage() {
  const shopify = useAppBridge();
  const { t } = useLocale();
  const { saved } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const v = saved as {
    enabled?: boolean;
    threshold?: string;
    preset?: PresetId;
    text?: string;
    barColor?: string;
    bgColor?: string;
    textColor?: string;
    position?: string;
    customCss?: string;
    excludeTags?: string;
    excludeCollections?: string[];
  };

  const [enabled, setEnabled] = useState(v.enabled ?? false);
  const [threshold, setThreshold] = useState(v.threshold ?? "10");
  const [preset, setPreset] = useState<PresetId>(v.preset ?? "bar_text");
  const [text, setText] = useState(v.text ?? "Only {n} left");
  const [barColor, setBarColor] = useState(v.barColor ?? "#D72C0D");
  const [bgColor, setBgColor] = useState(v.bgColor ?? "#E3E3E3");
  const [textColor, setTextColor] = useState(v.textColor ?? "#616161");
  const [position, setPosition] = useState(v.position ?? "below_price");
  const [customCss, setCustomCss] = useState(v.customCss ?? "");
  const [excludeTags, setExcludeTags] = useState(v.excludeTags ?? "archived, clearance");
  const [excludeCollections, setExcludeCollections] = useState<string[]>(
    v.excludeCollections ?? [],
  );

  const n = Math.min(5, Number(threshold) || 10);
  const save = () => {
    submit(
      {
        payload: JSON.stringify({
          enabled, threshold, preset, text, barColor, bgColor, textColor,
          position, customCss, excludeTags, excludeCollections,
        }),
      },
      { method: "post" },
    );
    shopify.toast.show("Low-stock settings saved");
  };

  return (
    <Page
      title={t("lowstock.title")}
      subtitle={t("lowstock.subtitle")}
      primaryAction={enabled ? { content: t("common.save"), onAction: save } : undefined}
    >
      {!enabled ? (
        // ----- Enable-first guide -----
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("Show shoppers when stock is running low")}</Text>
            <Text as="p" tone="subdued">{t("A small “only a few left” indicator on the product page nudges hesitant shoppers to buy now. It appears automatically when a variant's available inventory drops to your threshold, and reads live inventory from your store.")}</Text>
            <Divider />
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">{t("What you'll set up next:")}</Text>
              <Text as="p" tone="subdued">{t("1 · The threshold (e.g. show when 10 or fewer left).")}</Text>
              <Text as="p" tone="subdued">{t("2 · A design — text, a progress bar, a badge, and your colours.")}</Text>
              <Text as="p" tone="subdued">{t("3 · Any products to exclude, by tag or collection.")}</Text>
            </BlockStack>
            <InlineStack>
              <Button variant="primary" onClick={() => setEnabled(true)}>{t("Enable low stock")}</Button>
            </InlineStack>
          </BlockStack>
        </Card>
      ) : (
        // ----- Full settings -----
        <BlockStack gap="500">
          <Card>
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">{t("Low stock is on")}</Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">{t("Shown on product pages when available is at or below your threshold.")}</Text>
              </BlockStack>
              <Button variant="tertiary" tone="critical" onClick={() => setEnabled(false)}>{t("Turn off")}</Button>
            </InlineStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("When to show")}</Text>
              <Divider />
              <TextField
                label={t("Show when available is at or below")}
                type="number"
                value={threshold}
                onChange={setThreshold}
                autoComplete="off"
                suffix={t("units")}
                helpText={t("Hidden above this number, and when the product is out of stock.")}
              />
              <Select
                label={t("Position")}
                options={[
                  { label: t("Below the price"), value: "below_price" },
                  { label: t("Above Add to cart"), value: "above_atc" },
                  { label: t("Below Add to cart"), value: "below_atc" },
                ]}
                value={position}
                onChange={setPosition}
              />
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("Design")}</Text>
              <Divider />
              <Text as="p" variant="bodySm" tone="subdued">{t("Pick a style, then customise everything.")}</Text>
              <InlineStack gap="300" wrap>
                {LOW_STOCK_PRESETS.slice(0, 3).map((p) => (
                  <PresetCard key={p.id} preset={p} active={preset === p.id} onClick={() => setPreset(p.id)} />
                ))}
              </InlineStack>
              <InlineStack gap="300" wrap>
                {LOW_STOCK_PRESETS.slice(3).map((p) => (
                  <PresetCard key={p.id} preset={p} active={preset === p.id} onClick={() => setPreset(p.id)} />
                ))}
              </InlineStack>
              <TextField
                label={t("Text")}
                value={text}
                onChange={setText}
                autoComplete="off"
                helpText={t("Variables: {n} or {available} (remaining), {threshold}.")}
              />
              <ColorField label={t("Bar / accent colour")} value={barColor} onChange={setBarColor} />
              <ColorField label={t("Bar background colour")} value={bgColor} onChange={setBgColor} />
              <ColorField label={t("Text colour")} value={textColor} onChange={setTextColor} />
              <TextField
                label={t("Custom CSS")}
                value={customCss}
                onChange={setCustomCss}
                autoComplete="off"
                multiline={4}
                placeholder=".encore-lowstock { font-weight: 700; }"
                helpText={t("Targets .encore-lowstock in the theme block.")}
              />

              <Divider />
              <Text as="h3" variant="headingSm">{t("Live preview")}</Text>
              <Box padding="500" borderWidth="025" borderColor="border" borderRadius="300" background="bg-surface">
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">Aurora Hoodie — Indigo</Text>
                  <Text as="span" tone="subdued">$54.00</Text>
                  <Box paddingBlockStart="200">
                    <style dangerouslySetInnerHTML={{ __html: customCss }} />
                    <LowStockPreview
                      preset={preset}
                      text={text}
                      barColor={barColor}
                      bgColor={bgColor}
                      textColor={textColor}
                      n={n}
                      threshold={Number(threshold) || 10}
                    />
                  </Box>
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">{t("Exclusions")}</Text>
              <Divider />
              <TextField
                label={t("Exclude products with these tags")}
                value={excludeTags}
                onChange={setExcludeTags}
                autoComplete="off"
                helpText={t("Comma-separated, e.g. archived, clearance.")}
              />
              <CollectionPicker
                collections={DEMO_COLLECTIONS}
                selected={excludeCollections}
                onChange={setExcludeCollections}
                label={t("Exclude collections")}
              />
            </BlockStack>
          </Card>

          <InlineStack align="end">
            <Button variant="primary" onClick={save}>{t("common.save")}</Button>
          </InlineStack>
        </BlockStack>
      )}
    </Page>
  );
}
