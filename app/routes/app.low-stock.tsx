import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { InventoryIcon } from "@shopify/polaris-icons";
import { PageHero } from "../components/ui";
import { val, useLinkProps } from "../components/wc";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { LOW_STOCK_PRESETS, type LowStockPreset } from "../lib/demoStorefront";
import { listCollections } from "../models/collections.server";
import { CollectionPicker } from "../lib/storefrontKit";
import { useLocale } from "../lib/i18n";
import { getSettings, saveSettingsSection } from "../models/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [{ lowStock }, collections] = await Promise.all([
    getSettings(session.shop),
    listCollections(admin),
  ]);
  return { saved: lowStock, collections };
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
  return <s-color-field label={label} value={value} onInput={(e) => onChange(val(e))} />;
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
    <s-clickable
      onClick={onClick}
      padding="base"
      border="base"
      borderColor={active ? "strong" : "base"}
      borderRadius="base"
      background={active ? "subdued" : "transparent"}
    >
      <s-stack direction="block" gap="none">
        <s-text type="strong">{t(preset.name)}</s-text>
        <s-text color="subdued" fontSize="small">
          {t(preset.desc)}
        </s-text>
      </s-stack>
    </s-clickable>
  );
}

export default function LowStockPage() {
  const shopify = useAppBridge();
  const { t } = useLocale();
  const { saved, collections } = useLoaderData<typeof loader>();
  const submit = useSubmit();
  const link = useLinkProps();
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
  const save = (overrides: { enabled?: boolean } = {}) => {
    submit(
      {
        payload: JSON.stringify({
          enabled, threshold, preset, text, barColor, bgColor, textColor,
          position, customCss, excludeTags, excludeCollections,
          ...overrides,
        }),
      },
      { method: "post" },
    );
    shopify.toast.show(t("Low-stock settings saved"));
  };

  return (
    <s-page inlineSize="large">
      <div className="encore-stack">
        <PageHero
          icon={InventoryIcon}
          tone="amber"
          title={t("lowstock.title")}
          sub={t("lowstock.subtitle")}
          actions={
            enabled ? (
              <s-button variant="primary" onClick={() => save()}>
                {t("common.save")}
              </s-button>
            ) : undefined
          }
        />
        {!enabled ? (
          // ----- Enable-first guide -----
          <s-section heading={t("Show shoppers when stock is running low")}>
            <s-stack direction="block" gap="base">
              <s-paragraph color="subdued">
                {t("A small “only a few left” indicator on the product page nudges hesitant shoppers to buy now. It appears automatically when a variant's available inventory drops to your threshold, and reads live inventory from your store.")}
              </s-paragraph>
              <s-divider />
              <s-stack direction="block" gap="small">
                <s-text>{t("What you'll set up next:")}</s-text>
                <s-text color="subdued">{t("1 · The threshold (e.g. show when 10 or fewer left).")}</s-text>
                <s-text color="subdued">{t("2 · A design — text, a progress bar, a badge, and your colours.")}</s-text>
                <s-text color="subdued">{t("3 · Any products to exclude, by tag or collection.")}</s-text>
              </s-stack>
              <s-stack direction="inline">
                <s-button variant="primary" onClick={() => setEnabled(true)}>
                  {t("Enable low stock")}
                </s-button>
              </s-stack>
            </s-stack>
          </s-section>
        ) : (
          // ----- Full settings -----
          <>
            <s-section>
              <div className="encore-row-between">
                <s-stack direction="block" gap="none">
                  <s-heading>{t("Low stock is on")}</s-heading>
                  <s-text color="subdued" fontSize="small">
                    {t("Shown on product pages when available is at or below your threshold.")}
                  </s-text>
                </s-stack>
                <s-button
                  variant="tertiary"
                  tone="critical"
                  onClick={() => {
                    setEnabled(false);
                    save({ enabled: false });
                  }}
                >
                  {t("Turn off")}
                </s-button>
              </div>
            </s-section>

            <s-section heading={t("Products running low will appear here once inventory tracking picks them up.")}>
              <s-stack direction="block" gap="small">
                <s-paragraph color="subdued">
                  {t("As inventory drops to your threshold, the indicator shows on those product pages automatically — and suggestions for what to preorder next will appear here.")}
                </s-paragraph>
                <s-stack direction="inline">
                  <s-button {...link("/app/campaigns")}>{t("View preorders")}</s-button>
                </s-stack>
              </s-stack>
            </s-section>

            <s-section heading={t("When to show")}>
              <s-stack direction="block" gap="base">
                <s-number-field
                  label={t("Show when available is at or below")}
                  value={threshold}
                  onInput={(e) => setThreshold(val(e))}
                  suffix={t("units")}
                  min={1}
                  details={t("Hidden above this number, and when the product is out of stock.")}
                />
                <s-select label={t("Position")} value={position} onChange={(e) => setPosition(val(e))}>
                  <s-option value="below_price">{t("Below the price")}</s-option>
                  <s-option value="above_atc">{t("Above Add to cart")}</s-option>
                  <s-option value="below_atc">{t("Below Add to cart")}</s-option>
                </s-select>
              </s-stack>
            </s-section>

            <s-section heading={t("Design")} subheading={t("Pick a style, then customise everything.")}>
              <s-stack direction="block" gap="base">
                <s-grid gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="base">
                  {LOW_STOCK_PRESETS.map((p) => (
                    <PresetCard key={p.id} preset={p} active={preset === p.id} onClick={() => setPreset(p.id)} />
                  ))}
                </s-grid>
                <s-text-field
                  label={t("Text")}
                  value={text}
                  onInput={(e) => setText(val(e))}
                  details={t("Variables: {n} or {available} (remaining), {threshold}.")}
                />
                <s-grid gridTemplateColumns="repeat(3, minmax(0, 1fr))" gap="base">
                  <ColorField label={t("Bar / accent colour")} value={barColor} onChange={setBarColor} />
                  <ColorField label={t("Bar background colour")} value={bgColor} onChange={setBgColor} />
                  <ColorField label={t("Text colour")} value={textColor} onChange={setTextColor} />
                </s-grid>
                <s-text-area
                  label={t("Custom CSS")}
                  value={customCss}
                  onInput={(e) => setCustomCss(val(e))}
                  rows={4}
                  placeholder=".encore-lowstock { font-weight: 700; }"
                  details={t("Targets .encore-lowstock in the theme block.")}
                />

                <s-divider />
                <s-heading>{t("Live preview")}</s-heading>
                <s-box padding="large" border="base" borderRadius="base" background="base">
                  <s-stack direction="block" gap="small-200">
                    <s-text type="strong">Aurora Hoodie — Indigo</s-text>
                    <s-text color="subdued">$54.00</s-text>
                    <s-box paddingBlockStart="small">
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
                    </s-box>
                  </s-stack>
                </s-box>
              </s-stack>
            </s-section>

            <s-section heading={t("Exclusions")}>
              <s-stack direction="block" gap="base">
                <s-text-field
                  label={t("Exclude products with these tags")}
                  value={excludeTags}
                  onInput={(e) => setExcludeTags(val(e))}
                  details={t("Comma-separated, e.g. archived, clearance.")}
                />
                <CollectionPicker
                  collections={collections}
                  selected={excludeCollections}
                  onChange={setExcludeCollections}
                  label={t("Exclude collections")}
                />
                {collections.length === 0 && (
                  <s-text color="subdued" fontSize="small">
                    {t("No collections found in your store.")}
                  </s-text>
                )}
              </s-stack>
            </s-section>

            <s-stack direction="inline" justifyContent="end">
              <s-button variant="primary" onClick={() => save()}>
                {t("common.save")}
              </s-button>
            </s-stack>
          </>
        )}
      </div>
    </s-page>
  );
}
