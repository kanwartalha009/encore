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
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Button,
  ChoiceList,
  TextField,
  Badge,
  Banner,
  Box,
  ProgressBar,
} from "@shopify/polaris";

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

  const publishing = fetcher.state !== "idle";

  const pickProducts = async () => {
    const shopify = (window as unknown as { shopify?: { resourcePicker?: (o: unknown) => Promise<unknown> } }).shopify;
    if (!shopify?.resourcePicker) return;
    const sel = (await shopify.resourcePicker({ type: "product", multiple: true })) as
      | { id: string; title: string }[]
      | undefined;
    if (sel === undefined) return; // shopper closed the picker — keep current selection
    if (sel.length) {
      setProducts(sel.map((p) => ({ id: p.id, title: p.title })));
      setPickerHint(false);
    } else {
      // Empty selection — most often a brand-new store with no products yet.
      setPickerHint(true);
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
    <Page title={t("Set up your first preorder")} narrowWidth>
      <BlockStack gap="500">
        <ProgressBar progress={((step + 1) / 3) * 100} size="small" tone="primary" />

        {fetcher.data && fetcher.data.ok === false && (
          <Banner tone="critical">{t("Pick at least one product to continue.")}</Banner>
        )}

        <Card>
          <BlockStack gap="400">
            {step === 0 && (
              <>
                <Text as="h2" variant="headingMd">{t("1. Pick products")}</Text>
                <Text as="p" tone="subdued">{t("Choose the products you want to sell on preorder.")}</Text>
                <InlineStack gap="300" blockAlign="center">
                  <Button onClick={pickProducts}>{t("Choose products")}</Button>
                  {products.length > 0 && (
                    <Badge tone="success">{`${products.length} ${t("selected")}`}</Badge>
                  )}
                </InlineStack>
                {products.length > 0 && (
                  <Text as="p" variant="bodySm" tone="subdued">
                    {products.map((p) => p.title).slice(0, 5).join(", ")}
                    {products.length > 5 ? "…" : ""}
                  </Text>
                )}
                {pickerHint && products.length === 0 && (
                  <Banner tone="info">
                    <Text as="p">
                      {t(
                        "No products selected. If your store doesn't have any products yet, add one in Shopify admin under Products, then come back here.",
                      )}
                    </Text>
                  </Banner>
                )}
              </>
            )}

            {step === 1 && (
              <>
                <Text as="h2" variant="headingMd">{t("2. When should preorder show?")}</Text>
                <ChoiceList
                  title=""
                  titleHidden
                  choices={[
                    { label: t("Preorder now"), value: "now", helpText: t("Offer preorder right away.") },
                    { label: t("When it sells out"), value: "oos", helpText: t("Switch to preorder only when stock hits 0.") },
                    { label: t("On a date"), value: "date", helpText: t("Start preorder from a launch date.") },
                  ]}
                  selected={[mode]}
                  onChange={(v) => setMode(v[0] ?? "now")}
                />
                {mode === "date" && (
                  <TextField label={t("Start date")} type="date" value={startDate} onChange={setStartDate} autoComplete="off" />
                )}
              </>
            )}

            {step === 2 && (
              <>
                <Text as="h2" variant="headingMd">{t("3. Style the button")}</Text>
                <TextField label={t("Button text")} value={ctaLabel} onChange={setCtaLabel} autoComplete="off" />
                <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                  <InlineStack align="center">
                    <span style={{ background: "#1a1a1a", color: "#fff", padding: "12px 24px", borderRadius: 8, fontWeight: 600 }}>
                      {ctaLabel || "Preorder"}
                    </span>
                  </InlineStack>
                </Box>
              </>
            )}

            <InlineStack align="space-between">
              <Button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
                {t("Back")}
              </Button>
              {step < 2 ? (
                <Button variant="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
                  {t("Next")}
                </Button>
              ) : (
                <Button variant="primary" loading={publishing} disabled={products.length === 0} onClick={publish}>
                  {t("Publish")}
                </Button>
              )}
            </InlineStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
