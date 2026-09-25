import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { ProductIcon } from "@shopify/polaris-icons";
import { ActionBar, AppPage, Disclosure, FormCard, KvRow } from "../components/ui";
import { SelectField, val, useLinkProps } from "../components/wc";
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
  sample,
}: {
  preset: LowStockPreset;
  active: boolean;
  onClick: () => void;
  sample: React.ReactNode;
}) {
  const { t } = useLocale();
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      className={`encore-style-card${active ? " encore-style-card--active" : ""}`}
      onClick={onClick}
    >
      <span className="encore-style-card__sample">{sample}</span>
      <span className="encore-style-card__name">{t(preset.name)}</span>
      <span className="encore-style-card__desc">{t(preset.desc)}</span>
    </button>
  );
}

const POSITION_OPTIONS = [
  { value: "below_price", label: "Below the price" },
  { value: "above_atc", label: "Above Add to cart" },
  { value: "below_atc", label: "Below Add to cart" },
];

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
  const [moreOpen, setMoreOpen] = useState(false);

  const thresholdNum = Number(threshold) || 10;
  const n = Math.min(5, thresholdNum);
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
  // One click to go live: enabling saves straight away with the defaults
  // (previously it only flipped local state and still needed a Save).
  const turnOn = () => {
    setEnabled(true);
    save({ enabled: true });
  };
  const turnOff = () => {
    setEnabled(false);
    save({ enabled: false });
  };

  const indicator = (
    <>
      <style dangerouslySetInnerHTML={{ __html: customCss }} />
      <LowStockPreview
        preset={preset}
        text={text}
        barColor={barColor}
        bgColor={bgColor}
        textColor={textColor}
        n={n}
        threshold={thresholdNum}
      />
    </>
  );
  /** Product-page mock with the indicator in the chosen position. */
  const productMock = (
    <div className="encore-preview" aria-label={t("Live preview")}>
      <div className="encore-preview__media">
        <span className="encore-preview__ph" aria-hidden="true">
          <ProductIcon />
        </span>
      </div>
      <div className="encore-preview__body">
        <span className="encore-preview__title">{t("Aurora Hoodie — Indigo")}</span>
        <span className="encore-preview__meta">$54.00</span>
        {position === "below_price" && <div className="encore-preview__slot">{indicator}</div>}
        {position === "above_atc" && <div className="encore-preview__slot">{indicator}</div>}
        <span className="encore-preview__btn">{t("Add to cart")}</span>
        {position === "below_atc" && <div className="encore-preview__slot">{indicator}</div>}
      </div>
    </div>
  );
  const positionLabel = POSITION_OPTIONS.find((p) => p.value === position)?.label ?? position;
  const presetName = LOW_STOCK_PRESETS.find((p) => p.id === preset)?.name ?? preset;
  const excludedCount =
    excludeCollections.length +
    excludeTags
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean).length;
  const saveButton = (
    <s-button variant="primary" onClick={() => save()}>
      {t("common.save")}
    </s-button>
  );

  return (
    <AppPage
      heading={t("lowstock.title")}
      intro={t("lowstock.subtitle")}
      primaryAction={enabled ? saveButton : undefined}
      secondaryActions={
        enabled
          ? [
              <s-button key="off" tone="critical" onClick={turnOff}>
                {t("Turn off")}
              </s-button>,
            ]
          : []
      }
    >
      {!enabled ? (
        // ----- Enable-first: what it does + what it looks like, one button -----
        <div className="encore-layout encore-layout--form">
          <FormCard
            title={t("Show shoppers when stock is running low")}
            sub={t("A small “only a few left” indicator on the product page nudges hesitant shoppers to buy now. It appears automatically when a variant's available inventory drops to your threshold, and reads live inventory from your store.")}
          >
            <div className="encore-steps">
              <span className="encore-steps__title">{t("What you'll set up next:")}</span>
              <span>{t("1 · The threshold (e.g. show when 10 or fewer left).")}</span>
              <span>{t("2 · A design — text, a progress bar, a badge, and your colours.")}</span>
              <span>{t("3 · Any products to exclude, by tag or collection.")}</span>
            </div>
            <div>
              <s-button variant="primary" onClick={turnOn}>
                {t("Enable low stock")}
              </s-button>
            </div>
          </FormCard>
          <FormCard title={t("Storefront preview")}>{productMock}</FormCard>
        </div>
      ) : (
        <>
          <div className="encore-layout encore-layout--form">
            {/* ================= Main column ================= */}
            <div className="encore-stack">
              <FormCard title={t("When to show")} sub={t("Shown on product pages when available is at or below your threshold.")}>
                <div className="encore-form-grid">
                  <s-number-field
                    label={t("Show when available is at or below")}
                    value={threshold}
                    onInput={(e) => setThreshold(val(e))}
                    suffix={t("units")}
                    min={1}
                    details={t("Hidden above this number, and when the product is out of stock.")}
                  />
                  <SelectField
                    label={t("Position")}
                    options={POSITION_OPTIONS.map((p) => ({ value: p.value, label: t(p.label) }))}
                    value={position}
                    onChange={setPosition}
                  />
                </div>
              </FormCard>

              <FormCard title={t("Design")} sub={t("Pick a style, then customise everything.")}>
                <div className="encore-style-grid" role="radiogroup" aria-label={t("Design")}>
                  {LOW_STOCK_PRESETS.map((p) => (
                    <PresetCard
                      key={p.id}
                      preset={p}
                      active={preset === p.id}
                      onClick={() => setPreset(p.id)}
                      sample={
                        <LowStockPreview
                          preset={p.id}
                          text={text}
                          barColor={barColor}
                          bgColor={bgColor}
                          textColor={textColor}
                          n={n}
                          threshold={thresholdNum}
                        />
                      }
                    />
                  ))}
                </div>
                <s-text-field
                  label={t("Text")}
                  value={text}
                  onInput={(e) => setText(val(e))}
                  details={t("Variables: {n} or {available} (remaining), {threshold}.")}
                />
                <div className="encore-form-grid encore-form-grid--3">
                  <ColorField label={t("Bar / accent colour")} value={barColor} onChange={setBarColor} />
                  <ColorField label={t("Bar background colour")} value={bgColor} onChange={setBgColor} />
                  <ColorField label={t("Text colour")} value={textColor} onChange={setTextColor} />
                </div>
              </FormCard>

              <Disclosure
                id="lowstock-more"
                title={t("More options")}
                sub={t("Exclusions and custom CSS.")}
                open={moreOpen}
                onToggle={() => setMoreOpen((o) => !o)}
              >
                <div className="encore-adv__group">
                  <h3 className="encore-adv__title">{t("Exclusions")}</h3>
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
                </div>
                <div className="encore-adv__group">
                  <h3 className="encore-adv__title">{t("Custom CSS")}</h3>
                  <s-text-area
                    label={t("Custom CSS")}
                    labelAccessibilityVisibility="exclusive"
                    value={customCss}
                    onInput={(e) => setCustomCss(val(e))}
                    rows={4}
                    placeholder=".encore-lowstock { font-weight: 700; }"
                    details={t("Targets .encore-lowstock in the theme block.")}
                  />
                </div>
              </Disclosure>
            </div>

            {/* ================= Sidebar ================= */}
            <div className="encore-stack">
              <FormCard title={t("Summary")} action={<s-badge tone="success">{t("Live")}</s-badge>}>
                <div className="encore-kv encore-kv--flush">
                  <KvRow label={t("Shows at")} value={`≤ ${thresholdNum} ${t("units")}`} />
                  <KvRow label={t("Position")} value={t(positionLabel)} />
                  <KvRow label={t("Style")} value={t(presetName)} />
                  <KvRow label={t("Exclusions")} value={excludedCount > 0 ? String(excludedCount) : t("None")} />
                </div>
              </FormCard>
              <FormCard title={t("Storefront preview")}>{productMock}</FormCard>
              <FormCard
                title={t("Running low → preorder")}
                sub={t("As inventory drops to your threshold, the indicator shows on those product pages automatically — and suggestions for what to preorder next will appear here.")}
              >
                <div>
                  <s-button {...link("/app/campaigns")}>{t("View preorders")}</s-button>
                </div>
              </FormCard>
            </div>
          </div>

          <ActionBar
            left={
              <s-button tone="critical" onClick={turnOff}>
                {t("Turn off")}
              </s-button>
            }
          >
            {saveButton}
          </ActionBar>
        </>
      )}
    </AppPage>
  );
}
