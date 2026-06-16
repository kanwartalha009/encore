import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Box,
  TextField,
  Select,
  Checkbox,
  Divider,
  EmptyState,
  IndexTable,
  Banner,
} from "@shopify/polaris";
import { EmailIcon, NotificationIcon, ExportIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { listWaitlistGroups } from "../models/waitlist.server";
import { notifyGroup, retryFailed } from "../services/waitlist-notify.server";
import { NOTIFY_POSITIONS } from "../lib/demoStorefront";
import { DEMO_COLLECTIONS } from "../lib/demoProducts";
import { CollectionPicker } from "../lib/storefrontKit";
import { useLocale } from "../lib/i18n";
import { getSettings, saveSettingsSection } from "../models/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const [groups, settings] = await Promise.all([
    listWaitlistGroups(session.shop),
    getSettings(session.shop),
  ]);
  return { groups, saved: settings.backInStock };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "save");

  if (intent === "notify_group") {
    const r = await notifyGroup(
      session.shop,
      String(fd.get("productId") ?? ""),
      (fd.get("variantTitle") as string) || null,
    );
    return Response.json({ ok: true, intent, ...r });
  }
  if (intent === "retry_failed") {
    const r = await retryFailed(session.shop);
    return Response.json({ ok: true, intent, ...r });
  }

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    data = {};
  }
  await saveSettingsSection(session.shop, "backInStock", data);
  return Response.json({ ok: true, intent: "save" });
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

export default function BackInStockPage() {
  const { groups, saved } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const { t } = useLocale();
  const submit = useSubmit();
  const v = saved as {
    enabled?: boolean;
    buttonText?: string;
    position?: string;
    buttonColor?: string;
    hideBuyNow?: boolean;
    popupTitle?: string;
    collectPhone?: boolean;
    showProductInfo?: boolean;
    consentText?: string;
    doubleOptIn?: boolean;
    syncTarget?: string;
    excludeTags?: string;
    excludeCollections?: string[];
  };

  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  // ----- Storefront settings -----
  const [enabled, setEnabled] = useState(v.enabled ?? true);
  const [buttonText, setButtonText] = useState(
    v.buttonText ?? "Notify me when back in stock",
  );
  const [position, setPosition] = useState<string>(v.position ?? "replace");
  const [buttonColor, setButtonColor] = useState(v.buttonColor ?? "#1A1A1A");
  const [hideBuyNow, setHideBuyNow] = useState(v.hideBuyNow ?? true);
  const [popupTitle, setPopupTitle] = useState(v.popupTitle ?? "Get notified");
  const [collectPhone, setCollectPhone] = useState(v.collectPhone ?? false);
  const [showProductInfo, setShowProductInfo] = useState(v.showProductInfo ?? true);
  const [consentText, setConsentText] = useState(
    v.consentText ?? "I agree to be emailed when this is back in stock.",
  );
  const [doubleOptIn, setDoubleOptIn] = useState(v.doubleOptIn ?? false);
  const [syncTarget, setSyncTarget] = useState(v.syncTarget ?? "klaviyo");
  const [excludeTags, setExcludeTags] = useState(v.excludeTags ?? "archived");
  const [excludeCollections, setExcludeCollections] = useState<string[]>(
    v.excludeCollections ?? [],
  );

  const save = () => {
    submit(
      {
        payload: JSON.stringify({
          enabled, buttonText, position, buttonColor, hideBuyNow, popupTitle,
          collectPhone, showProductInfo, consentText, doubleOptIn, syncTarget,
          excludeTags, excludeCollections,
        }),
      },
      { method: "post" },
    );
    shopify.toast.show(t("Back-in-stock settings saved"));
    setShowSettings(false);
  };

  const totalSubs = groups.reduce((a, g) => a + g.subscribers, 0);
  const productCount = new Set(groups.map((g) => g.productId)).size;
  const totalConverted = groups.reduce((a, g) => a + g.convertedCount, 0);
  const conversionRate = totalSubs > 0 ? Math.round((totalConverted / totalSubs) * 100) : 0;

  const exportCsv = () => {
    if (typeof document === "undefined") return;
    const header = ["Product", "Variant", "Subscribers", "Email", "SMS", "Both", "Converted", "Newest signup"];
    const body = groups.map((g) => [
      g.productTitle,
      g.variantTitle ?? "",
      g.subscribers,
      g.email,
      g.sms,
      g.both,
      g.convertedCount,
      g.newestSignupAt ? new Date(g.newestSignupAt).toISOString().slice(0, 10) : "",
    ]);
    const csv = [header, ...body]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "back-in-stock-subscribers.csv";
    a.click();
    URL.revokeObjectURL(url);
    shopify.toast.show(t("Subscribers exported"));
  };

  const notifyFetcher = useFetcher<{
    ok?: boolean;
    intent?: string;
    sent?: number;
    failed?: number;
  }>();
  useEffect(() => {
    const d = notifyFetcher.data;
    if (!d || !d.ok) return;
    if (d.intent === "notify_group" || d.intent === "retry_failed") {
      const failed = d.failed ?? 0;
      shopify.toast.show(
        `Notified ${d.sent ?? 0}${failed > 0 ? ` · ${failed} failed` : ""}`,
        failed > 0 ? { isError: true } : undefined,
      );
    }
  }, [notifyFetcher.data, shopify]);

  const notify = (productId: string, variantTitle: string | null) => {
    notifyFetcher.submit(
      { intent: "notify_group", productId, variantTitle: variantTitle ?? "" },
      { method: "post" },
    );
  };
  const retryAllFailed = () =>
    notifyFetcher.submit({ intent: "retry_failed" }, { method: "post" });
  const notifyBusy = notifyFetcher.state !== "idle";
  const totalFailed = groups.reduce((a, g) => a + g.failed, 0);

  const rows = groups.map((g, index) => (
    <IndexTable.Row id={`${g.productId}::${g.variantTitle ?? ""}`} key={index} position={index}>
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{g.productTitle}</Text>
          {g.variantTitle && <Text as="span" variant="bodySm" tone="subdued">{g.variantTitle}</Text>}
          {(g.notified > 0 || g.failed > 0) && (
            <InlineStack gap="150">
              {g.notified > 0 && <Badge tone="success">{`${g.notified} notified`}</Badge>}
              {g.failed > 0 && <Badge tone="critical">{`${g.failed} failed`}</Badge>}
            </InlineStack>
          )}
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="end" variant="bodyMd" fontWeight="semibold" numeric>
          {g.subscribers.toLocaleString()}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="150">
          {g.email > 0 && <Badge tone="info">{`Email · ${g.email}`}</Badge>}
          {g.sms > 0 && <Badge tone="success">{`SMS · ${g.sms}`}</Badge>}
          {g.both > 0 && <Badge tone="attention">{`Both · ${g.both}`}</Badge>}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" alignment="end" numeric>{g.convertedCount.toLocaleString()}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {g.newestSignupAt ? new Date(g.newestSignupAt).toISOString().slice(0, 10) : "—"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Button icon={NotificationIcon} onClick={() => notify(g.productId, g.variantTitle)} loading={notifyBusy}>{t("Notify")}</Button>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      title={t("backinstock.title")}
      subtitle={t("backinstock.subtitle")}
      primaryAction={
        showSettings
          ? { content: t("common.save"), onAction: save }
          : { content: t("Customize storefront"), onAction: () => setShowSettings(true) }
      }
      secondaryActions={[
        { content: t("common.export"), icon: ExportIcon, onAction: exportCsv, disabled: groups.length === 0 },
        ...(totalFailed > 0
          ? [{ content: `Retry ${totalFailed} failed`, onAction: retryAllFailed }]
          : []),
      ]}
    >
      <BlockStack gap="500">
        {/* ---- Storefront customization (opens on demand) ---- */}
        {showSettings && (
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">{t("Notify-me button")}</Text>
                  <Button variant="tertiary" onClick={() => setShowSettings(false)}>{t("Close")}</Button>
                </InlineStack>
                <Divider />
                <Checkbox
                  label={t("Show “Notify me” on out-of-stock products")}
                  helpText={t("Only when the product isn't in a live preorder — preorder wins.")}
                  checked={enabled}
                  onChange={setEnabled}
                />
                <Checkbox
                  label={t("Hide the “Buy it now” button on these products")}
                  checked={hideBuyNow}
                  onChange={setHideBuyNow}
                />
                <Divider />
                <TextField label={t("Button text")} value={buttonText} onChange={setButtonText} autoComplete="off" />
                <Select
                  label={t("Button position")}
                  options={NOTIFY_POSITIONS.map((p) => ({ label: p.label, value: p.value }))}
                  value={position}
                  onChange={setPosition}
                />
                <InlineStack gap="300" blockAlign="end">
                  <Box minWidth="200px">
                    <TextField label={t("Button colour (hex)")} value={buttonColor} onChange={setButtonColor} autoComplete="off" />
                  </Box>
                  <div style={{ width: 36, height: 36, borderRadius: 8, background: buttonColor, border: "1px solid #E1E3E5" }} />
                </InlineStack>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{t("Sign-up popup")}</Text>
                <Divider />
                <Layout>
                  <Layout.Section>
                    <BlockStack gap="300">
                      <TextField label={t("Popup title")} value={popupTitle} onChange={setPopupTitle} autoComplete="off" />
                      <TextField label={t("Consent text")} value={consentText} onChange={setConsentText} autoComplete="off" multiline={2} />
                      <Checkbox label={t("Also collect phone number (SMS)")} checked={collectPhone} onChange={setCollectPhone} />
                      <Checkbox label={t("Show product image & title in popup")} checked={showProductInfo} onChange={setShowProductInfo} />
                      <Checkbox
                        label={t("Require email confirmation (double opt-in)")}
                        helpText={t("Off = one tap (recommended). On = stricter consent (EU).")}
                        checked={doubleOptIn}
                        onChange={setDoubleOptIn}
                      />
                    </BlockStack>
                  </Layout.Section>
                  <Layout.Section variant="oneThird">
                    <Box padding="400" borderWidth="025" borderColor="border" borderRadius="300" background="bg-surface">
                      <BlockStack gap="200">
                        <Text as="span" variant="headingSm">{popupTitle}</Text>
                        {showProductInfo && (
                          <InlineStack gap="200" blockAlign="center">
                            <div style={{ width: 36, height: 36, borderRadius: 6, background: "#E3E3E3" }} />
                            <Text as="span" variant="bodySm" tone="subdued">Aurora Hoodie — Indigo</Text>
                          </InlineStack>
                        )}
                        <div style={{ border: "1px solid #E1E3E5", borderRadius: 8, padding: "8px 10px", color: "#8A8A8A", fontSize: 13 }}>you@email.com</div>
                        {collectPhone && (
                          <div style={{ border: "1px solid #E1E3E5", borderRadius: 8, padding: "8px 10px", color: "#8A8A8A", fontSize: 13 }}>+1 555 000 0000</div>
                        )}
                        <button type="button" style={{ background: buttonColor, color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 600, cursor: "default" }}>
                          {buttonText}
                        </button>
                        <Text as="span" variant="bodySm" tone="subdued">{consentText}</Text>
                      </BlockStack>
                    </Box>
                  </Layout.Section>
                </Layout>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">{t("Where subscribers are saved")}</Text>
                <Divider />
                <Select
                  label={t("Sync subscribers to")}
                  options={[
                    { label: t("Klaviyo (recommended — flows send the email)"), value: "klaviyo" },
                    { label: t("Shopify customers (tag + segment)"), value: "shopify" },
                    { label: t("Keep in Encore only"), value: "none" },
                  ]}
                  value={syncTarget}
                  onChange={setSyncTarget}
                />
                {syncTarget === "shopify" && (
                  <Banner tone="warning">
                    <Text as="span">{t("Shopify Email has no automatic back-in-stock trigger, so we'll send the restock email for you and tag the customer.")}</Text>
                  </Banner>
                )}
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
                  helpText={t("Comma-separated, e.g. archived, discontinued.")}
                />
                <CollectionPicker
                  collections={DEMO_COLLECTIONS}
                  selected={excludeCollections}
                  onChange={setExcludeCollections}
                  label={t("Exclude collections")}
                />
              </BlockStack>
            </Card>

            <InlineStack align="end" gap="200">
              <Button onClick={() => setShowSettings(false)}>{t("common.cancel")}</Button>
              <Button variant="primary" onClick={save}>{t("common.save")}</Button>
            </InlineStack>

            <Divider />
          </BlockStack>
        )}

        {/* ---- Dashboard (always visible) ---- */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{t("Total subscribers")}</Text>
                <Text as="p" variant="heading2xl">{totalSubs.toLocaleString()}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{t("across")} {productCount} {productCount === 1 ? t("product") : t("products")}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{t("Converted to purchase")}</Text>
                <Text as="p" variant="heading2xl">{totalConverted.toLocaleString()}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{conversionRate}% {t("conversion rate")}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" tone="subdued">{t("High-intent (24h)")}</Text>
                <Text as="p" variant="heading2xl">{Math.round(totalSubs * 0.12).toLocaleString()}</Text>
                <Text as="p" variant="bodySm" tone="subdued">{t("~12% of total")}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {groups.length === 0 ? (
          <Card>
            <EmptyState
              heading="No subscribers yet"
              action={{ content: t("Customize storefront"), onAction: () => setShowSettings(true) }}
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>{t("Once the theme block is added, shoppers can subscribe on out-of-stock products.")}</p>
            </EmptyState>
          </Card>
        ) : (
          <>
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">{t("Subscribers")}</Text>
              <Button icon={ExportIcon} onClick={exportCsv}>{t("Export CSV")}</Button>
            </InlineStack>
            <Banner icon={EmailIcon} tone="info" onDismiss={() => {}} title={t("Demo data")}>
              <Text as="span">{t("“Notify” fires a toast for now — it will notify subscribers via your chosen sync (Klaviyo / Shopify) once wired.")}</Text>
            </Banner>
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "subscriber group", plural: "subscriber groups" }}
                itemCount={groups.length}
                selectable={false}
                headings={[
                  { title: t("Product · variant") },
                  { title: t("Subscribers"), alignment: "end" },
                  { title: t("Channels") },
                  { title: t("Converted"), alignment: "end" },
                  { title: t("Newest signup") },
                  { title: t("Action") },
                ]}
              >
                {rows}
              </IndexTable>
            </Card>
          </>
        )}
      </BlockStack>
    </Page>
  );
}
