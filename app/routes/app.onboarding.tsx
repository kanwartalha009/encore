/**
 * Onboarding wizard (E1) — install → first preorder in 3 steps:
 *   1) pick products  2) choose mode  3) style the button → Publish.
 * Creates a LIVE Campaign with sensible defaults (pay-now, no selling plan needed).
 * This is also the reviewer's first-run path. Trap-safe: `createCampaign` (a
 * `.server` value) is used only in the action.
 */
import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { WandIcon } from "@shopify/polaris-icons";
import { PageHero } from "../components/ui";
import { flag, val, vals, useLinkProps } from "../components/wc";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { createCampaign } from "../models/campaign.server";
import { getSettings } from "../models/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  // Inherit the merchant's store-wide defaults so the wizard starts from what
  // they already configured (Settings → default button label), not our hardcode.
  const { general } = await getSettings(session.shop);
  const g = general as { defaultButtonLabel?: unknown };
  const defaultCtaLabel =
    typeof g.defaultButtonLabel === "string" && g.defaultButtonLabel.trim()
      ? g.defaultButtonLabel.trim()
      : "Preorder";
  return { defaultCtaLabel };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();

  let productIds: string[] = [];
  try {
    productIds = (JSON.parse(String(fd.get("productIds") ?? "[]")) as string[]).filter(Boolean);
  } catch {
    productIds = [];
  }
  const mode = String(fd.get("mode") ?? "now");
  const ctaLabel = String(fd.get("ctaLabel") ?? "").trim() || "Preorder";
  const name = String(fd.get("name") ?? "").trim() || "My first preorder";
  const startRaw = String(fd.get("startDate") ?? "").trim();

  if (productIds.length === 0) return { ok: false as const, error: "no_products" };

  const triggerType = mode === "oos" ? "STOCK" : mode === "date" ? "DATE" : "MANUAL";
  const created = await createCampaign(session.shop, {
    name,
    productMode: "SPECIFIC",
    productIds,
    triggerType,
    ...(mode === "oos" ? { stockThreshold: 0 } : {}),
    ...(mode === "date" && startRaw ? { startDate: new Date(startRaw) } : {}),
    ctaLabel,
    status: "LIVE",
  });

  return redirect(`/app/campaigns/${created.id}?welcome=1`);
};

export const headers: HeadersFunction = (h) => boundary.headers(h);

type PickedProduct = { id: string; title: string };

export default function OnboardingWizard() {
  const { t } = useLocale();
  const { defaultCtaLabel } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [step, setStep] = useState(0);
  const [products, setProducts] = useState<PickedProduct[]>([]);
  const [mode, setMode] = useState("now");
  const [startDate, setStartDate] = useState("");
  const [ctaLabel, setCtaLabel] = useState(defaultCtaLabel);
  const [pickerHint, setPickerHint] = useState(false);
  const [pickerBroken, setPickerBroken] = useState(false);

  const publishing = fetcher.state !== "idle";
  const link = useLinkProps();

  const pickProducts = async () => {
    // Never dead-end the wizard: if the App Bridge picker is unavailable or
    // throws, surface it and offer the full form (which has its own picker).
    try {
      const shopify = (window as unknown as { shopify?: { resourcePicker?: (o: unknown) => Promise<unknown> } }).shopify;
      if (!shopify?.resourcePicker) {
        setPickerBroken(true);
        return;
      }
      const sel = (await shopify.resourcePicker({ type: "product", multiple: true })) as
        | { id: string; title: string }[]
        | undefined;
      if (sel === undefined) return; // shopper closed the picker — keep current selection
      if (sel.length) {
        setProducts(sel.map((p) => ({ id: p.id, title: p.title })));
        setPickerHint(false);
        setPickerBroken(false);
      } else {
        // Empty selection — most often a brand-new store with no products yet.
        setPickerHint(true);
      }
    } catch (err) {
      console.error("[encore/onboarding] resourcePicker failed", err);
      setPickerBroken(true);
    }
  };

  const publish = () => {
    const data = new FormData();
    data.set("productIds", JSON.stringify(products.map((p) => p.id)));
    data.set("mode", mode);
    data.set("ctaLabel", ctaLabel);
    data.set("startDate", startDate);
    data.set("name", products[0]?.title ? `${products[0].title} preorder` : "My first preorder");
    fetcher.submit(data, { method: "post" });
  };

  const canNext = step === 0 ? products.length > 0 : step === 1 ? mode !== "date" || !!startDate : true;

  return (
    <s-page inlineSize="small">
      <div className="encore-stack">
        <PageHero icon={WandIcon} tone="violet" title={t("Set up your first preorder")} />
        <s-progress value={((step + 1) / 3) * 100} max={100} accessibilityLabel={`${step + 1} / 3`} />

        {fetcher.data && fetcher.data.ok === false && (
          <s-banner tone="critical">{t("Pick at least one product to continue.")}</s-banner>
        )}

        <s-section>
          <s-stack direction="block" gap="base">
            {step === 0 && (
              <>
                <s-heading>{t("1. Pick products")}</s-heading>
                <s-paragraph color="subdued">{t("Choose the products you want to sell on preorder.")}</s-paragraph>
                <s-stack direction="inline" gap="base" alignItems="center">
                  <s-button onClick={pickProducts}>{t("Choose products")}</s-button>
                  {products.length > 0 && <s-badge tone="success">{`${products.length} ${t("selected")}`}</s-badge>}
                </s-stack>
                {products.length > 0 && (
                  <s-text color="subdued" fontSize="small">
                    {products.map((p) => p.title).slice(0, 5).join(", ")}
                    {products.length > 5 ? "…" : ""}
                  </s-text>
                )}
                {pickerBroken && (
                  <s-banner tone="warning">
                    {t(
                      "The product picker didn't open. You can create your first preorder with the full form instead — it does the same thing with a few more options.",
                    )}
                    <s-button slot="secondary-actions" {...link("/app/campaigns/new")}>
                      {t("Open the full preorder form")}
                    </s-button>
                  </s-banner>
                )}
                {pickerHint && products.length === 0 && (
                  <s-banner tone="info">
                    {t(
                      "No products selected. If your store doesn't have any products yet, add one in Shopify admin under Products, then come back here.",
                    )}
                  </s-banner>
                )}
              </>
            )}

            {step === 1 && (
              <>
                <s-heading>{t("2. When should preorder show?")}</s-heading>
                <s-choice-list label={t("2. When should preorder show?")} labelAccessibilityVisibility="exclusive" name="mode" onChange={(e) => setMode(vals(e)[0] ?? "now")}>
                  <s-choice value="now" selected={flag(mode === "now")}>
                    {t("Preorder now")}
                    <s-text slot="details">{t("Offer preorder right away.")}</s-text>
                  </s-choice>
                  <s-choice value="oos" selected={flag(mode === "oos")}>
                    {t("When it sells out")}
                    <s-text slot="details">{t("Switch to preorder only when stock hits 0.")}</s-text>
                  </s-choice>
                  <s-choice value="date" selected={flag(mode === "date")}>
                    {t("On a date")}
                    <s-text slot="details">{t("Start preorder from a launch date.")}</s-text>
                  </s-choice>
                </s-choice-list>
                {mode === "date" && (
                  <s-date-field label={t("Start date")} value={startDate} onChange={(e) => setStartDate(val(e))} />
                )}
              </>
            )}

            {step === 2 && (
              <>
                <s-heading>{t("3. Style the button")}</s-heading>
                <s-text-field label={t("Button text")} value={ctaLabel} onInput={(e) => setCtaLabel(val(e))} />
                <s-box background="subdued" padding="base" borderRadius="base">
                  <s-stack direction="inline" justifyContent="center">
                    <span style={{ background: "#1a1a1a", color: "#fff", padding: "12px 24px", borderRadius: 8, fontWeight: 600 }}>
                      {ctaLabel || t("Preorder")}
                    </span>
                  </s-stack>
                </s-box>
              </>
            )}

            <div className="encore-row-between">
              <s-button disabled={flag(step === 0)} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                {t("Back")}
              </s-button>
              {step < 2 ? (
                <s-button variant="primary" disabled={flag(!canNext)} onClick={() => setStep((s) => s + 1)}>
                  {t("Next")}
                </s-button>
              ) : (
                <s-button variant="primary" loading={flag(publishing)} disabled={flag(products.length === 0)} onClick={publish}>
                  {t("Publish")}
                </s-button>
              )}
            </div>
          </s-stack>
        </s-section>
      </div>
    </s-page>
  );
}
