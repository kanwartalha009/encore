import { useState } from "react";
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
  Banner,
  Divider,
  Collapsible,
  ChoiceList,
  Link,
  Icon,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  InfoIcon,
} from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { useLocale, LOCALE_NAMES, LOCALES, type Locale } from "../lib/i18n";
import { getSettings, saveSettingsSection } from "../models/settings.server";
import {
  checkDiscountCompatibility,
  type DiscountCompatRow,
} from "../services/discount-compat.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const { general } = await getSettings(session.shop);
  return { shop: session.shop, saved: general };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "save");

  if (intent === "check_discounts") {
    const result = await checkDiscountCompatibility(admin);
    return Response.json({ ok: true, intent, ...result });
  }

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    data = {};
  }
  await saveSettingsSection(session.shop, "general", data);
  return Response.json({ ok: true, intent: "save" });
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function SettingsPage() {
  const { shop, saved } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const submit = useSubmit();
  const discountFetcher = useFetcher<{
    rows?: DiscountCompatRow[];
    checkedAt?: string;
    error?: string;
  }>();
  const checkDiscounts = () =>
    discountFetcher.submit({ intent: "check_discounts" }, { method: "post" });
  const discountTone = (s: DiscountCompatRow["status"]) =>
    s === "CONFLICT" ? "critical" : s === "REVIEW" ? "attention" : "success";
  const { locale, setLocale, t } = useLocale();
  const g = saved as Partial<{
    defaultPaymentMode: "pay_now" | "deposit" | "pay_later";
    defaultDepositPct: string;
    defaultDeliveryNote: string;
    defaultDeliveryFallback: string;
    showLineItemProps: boolean;
    preorderPropLabel: string;
    shipDatePropLabel: string;
    klaviyoKey: string;
    omnisendKey: string;
    slackWebhook: string;
    senderEmail: string;
    embedEnabled: boolean;
    smsEnabled: boolean;
    availabilityRule: "always" | "oos" | "in_stock";
    autoStopAtZero: boolean;
    autoManageContinueSelling: boolean;
    reserveMode: "on_sale" | "on_fulfillment";
    defaultButtonLabel: string;
    ctaPlacement: "replace" | "beside" | "stack";
    comingSoonBeforeStart: boolean;
    notAvailableAfterEnd: boolean;
    hideBuyNow: boolean;
    showPreorderLabel: boolean;
    showPromoNote: boolean;
    mixedCartWarning: boolean;
    mixedCartMessage: string;
    showLineItem: boolean;
    showContactLink: boolean;
    contactEmail: string;
    contactSubject: string;
    preorderModel: "selling_plan" | "legacy";
    balanceCharge: "auto" | "reminder";
    balanceChargeDays: string;
    notifyOverdue: boolean;
    orderTagName: string;
    badgeStyle: "pill" | "corner" | "ribbon";
    buttonColor: string;
    customCss: string;
  }>;

  // Preorder defaults
  const [defaultPaymentMode, setDefaultPaymentMode] = useState<
    "pay_now" | "deposit" | "pay_later"
  >(g.defaultPaymentMode ?? "pay_now");
  const [defaultDepositPct, setDefaultDepositPct] = useState(g.defaultDepositPct ?? "20");
  const [defaultDeliveryNote, setDefaultDeliveryNote] = useState(
    g.defaultDeliveryNote ?? "Ships by {{shipping_date}}",
  );
  const [defaultDeliveryFallback, setDefaultDeliveryFallback] = useState(
    g.defaultDeliveryFallback ?? "Ships as soon as it's available.",
  );

  // Preorder line-item properties
  const [showLineItemProps, setShowLineItemProps] = useState(g.showLineItemProps ?? true);
  const [preorderPropLabel, setPreorderPropLabel] = useState(g.preorderPropLabel ?? "Preorder");
  const [shipDatePropLabel, setShipDatePropLabel] = useState(g.shipDatePropLabel ?? "Ships");

  // Advanced
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [klaviyoKey, setKlaviyoKey] = useState(g.klaviyoKey ?? "");
  const [omnisendKey, setOmnisendKey] = useState(g.omnisendKey ?? "");
  const [slackWebhook, setSlackWebhook] = useState(g.slackWebhook ?? "");
  const [senderEmail, setSenderEmail] = useState(g.senderEmail ?? `hello@${shop}`);
  const [embedEnabled, setEmbedEnabled] = useState(g.embedEnabled ?? true);
  const [smsEnabled, setSmsEnabled] = useState(g.smsEnabled ?? false);

  // Inventory rules
  const [availabilityRule, setAvailabilityRule] = useState<
    "always" | "oos" | "in_stock"
  >(g.availabilityRule ?? "always");
  const [autoStopAtZero, setAutoStopAtZero] = useState(g.autoStopAtZero ?? true);
  const [autoManageContinueSelling, setAutoManageContinueSelling] = useState(
    g.autoManageContinueSelling ?? true,
  );
  const [reserveMode, setReserveMode] = useState<"on_sale" | "on_fulfillment">(
    g.reserveMode ?? "on_sale",
  );

  // Preorder button & storefront
  const [defaultButtonLabel, setDefaultButtonLabel] = useState(g.defaultButtonLabel ?? "Preorder");
  const [ctaPlacement, setCtaPlacement] = useState<"replace" | "beside" | "stack">(
    g.ctaPlacement ?? "replace",
  );
  const [comingSoonBeforeStart, setComingSoonBeforeStart] = useState(g.comingSoonBeforeStart ?? true);
  const [notAvailableAfterEnd, setNotAvailableAfterEnd] = useState(g.notAvailableAfterEnd ?? true);
  const [hideBuyNow, setHideBuyNow] = useState(g.hideBuyNow ?? false);
  const [showPreorderLabel, setShowPreorderLabel] = useState(g.showPreorderLabel ?? true);
  const [showPromoNote, setShowPromoNote] = useState(g.showPromoNote ?? false);

  // Cart
  const [mixedCartWarning, setMixedCartWarning] = useState(g.mixedCartWarning ?? true);
  const [mixedCartMessage, setMixedCartMessage] = useState(
    g.mixedCartMessage ??
      "Your cart has both in-stock and preorder items — they may ship separately.",
  );
  const [showLineItem, setShowLineItem] = useState(g.showLineItem ?? true);
  const [showContactLink, setShowContactLink] = useState(g.showContactLink ?? true);
  const [contactEmail, setContactEmail] = useState(g.contactEmail ?? `hello@${shop}`);
  const [contactSubject, setContactSubject] = useState(g.contactSubject ?? "Preorder information");

  // Payment plumbing
  const [preorderModel, setPreorderModel] = useState<"selling_plan" | "legacy">(
    g.preorderModel ?? "selling_plan",
  );
  const [balanceCharge, setBalanceCharge] = useState<"auto" | "reminder">(g.balanceCharge ?? "auto");
  const [balanceChargeDays, setBalanceChargeDays] = useState(g.balanceChargeDays ?? "7");
  const [notifyOverdue, setNotifyOverdue] = useState(g.notifyOverdue ?? false);
  const [orderTagName, setOrderTagName] = useState(g.orderTagName ?? "pre-order");

  // Design / CSS
  const [badgeStyle, setBadgeStyle] = useState<"pill" | "corner" | "ribbon">(
    g.badgeStyle ?? "pill",
  );
  const [buttonColor, setButtonColor] = useState(g.buttonColor ?? "#1A1A1A");
  const [customCss, setCustomCss] = useState(g.customCss ?? "");
  const [previewNoDate, setPreviewNoDate] = useState(false);

  const handleSave = () => {
    submit(
      {
        payload: JSON.stringify({
          defaultPaymentMode, defaultDepositPct, defaultDeliveryNote, defaultDeliveryFallback,
          showLineItemProps, preorderPropLabel, shipDatePropLabel,
          klaviyoKey, omnisendKey, slackWebhook, senderEmail, embedEnabled, smsEnabled,
          availabilityRule, autoStopAtZero, autoManageContinueSelling, reserveMode,
          defaultButtonLabel, ctaPlacement, comingSoonBeforeStart, notAvailableAfterEnd,
          hideBuyNow, showPreorderLabel, showPromoNote,
          mixedCartWarning, mixedCartMessage, showLineItem, showContactLink, contactEmail, contactSubject,
          preorderModel, balanceCharge, balanceChargeDays, notifyOverdue, orderTagName,
          badgeStyle, buttonColor, customCss,
        }),
      },
      { method: "post" },
    );
    shopify.toast.show("Settings saved");
  };

  const handleConnect = (provider: string) => {
    shopify.toast.show(`Demo: would launch ${provider} OAuth flow`);
  };

  const handleWipeDemo = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Wipe all preorders, cohorts, customer preorders, and waitlist data for this shop? This cannot be undone.",
      )
    )
      return;
    shopify.toast.show("Demo: would wipe all data");
  };

  // Live-preview message: substitute {{shipping_date}}, or use the fallback
  // when the product has no ship date.
  const SAMPLE_SHIP_DATE = "Aug 15, 2026";
  const previewNote = previewNoDate
    ? defaultDeliveryFallback
    : defaultDeliveryNote.replace(
        /\{\{\s*shipping_date\s*\}\}/g,
        SAMPLE_SHIP_DATE,
      );

  const SETTINGS_SECTIONS: [string, string][] = [
    ["sec-language", t("settings.sec.language")],
    ["sec-defaults", t("settings.sec.defaults")],
    ["sec-lineitem", t("settings.sec.lineitem")],
    ["sec-inventory", t("settings.sec.inventory")],
    ["sec-button", t("settings.sec.button")],
    ["sec-cart", t("settings.sec.cart")],
    ["sec-payment", t("settings.sec.payment")],
    ["sec-discounts", t("Discounts")],
    ["sec-design", t("settings.sec.design")],
    ["sec-advanced", t("settings.sec.advanced")],
  ];
  const [activeSec, setActiveSec] = useState("sec-language");
  const jumpTo = (id: string) => {
    setActiveSec(id);
    if (typeof document !== "undefined")
      document
        .getElementById(id)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <Page
      title={t("settings.title")}
      subtitle="Store-wide settings — set once. They apply to every preorder; a few can be overridden per preorder."
      primaryAction={{ content: t("common.save"), onAction: handleSave }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 230px) minmax(0, 1fr)",
          gap: 20,
          alignItems: "start",
        }}
      >
        <div style={{ position: "sticky", top: 16 }}>
          <Card padding="200">
            <BlockStack gap="050">
              {SETTINGS_SECTIONS.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => jumpTo(id)}
                  style={{ all: "unset", cursor: "pointer", display: "block", width: "100%" }}
                >
                  <Box
                    padding="200"
                    borderRadius="200"
                    background={activeSec === id ? "bg-surface-secondary" : undefined}
                  >
                    <Text
                      as="span"
                      variant="bodyMd"
                      fontWeight={activeSec === id ? "semibold" : "regular"}
                    >
                      {label}
                    </Text>
                  </Box>
                </button>
              ))}
            </BlockStack>
          </Card>
        </div>

        <BlockStack gap="500">
          <Banner tone="info" onDismiss={() => {}}>
            <Text as="span">{t("These defaults pre-fill new preorders. You can change anything per preorder at any time.")}</Text>
          </Banner>

        <div id="sec-language" />
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">{t("App language")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("The language of this admin app. Defaults to your store's language; change it just for your account.")}</Text>
            </BlockStack>
            <Divider />
            <Select
              label={t("App language")}
              labelHidden
              options={LOCALES.map((l) => ({
                label: LOCALE_NAMES[l],
                value: l,
              }))}
              value={locale}
              onChange={(v) => setLocale(v as Locale)}
            />
          </BlockStack>
        </Card>

        <div id="sec-defaults" />
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">{t("Preorder defaults")}</Text>
            <Divider />
            <Select
              label={t("How do customers pay?")}
              options={[
                { label: t("Full at checkout (recommended)"), value: "pay_now" },
                { label: t("Deposit + balance before ship"), value: "deposit" },
                {
                  label: t("Pay later (vault card, charge on ship)"),
                  value: "pay_later",
                },
              ]}
              value={defaultPaymentMode}
              onChange={(v) =>
                setDefaultPaymentMode(
                  v as "pay_now" | "deposit" | "pay_later",
                )
              }
              helpText={t("Most stores keep this on Full at checkout. Use Deposit to lower the buying barrier on big-ticket items.")}
            />
            {defaultPaymentMode === "deposit" && (
              <TextField
                label={t("Default deposit percentage")}
                type="number"
                value={defaultDepositPct}
                onChange={setDefaultDepositPct}
                autoComplete="off"
                suffix="%"
                helpText={t("The remainder is auto-charged 7 days before the ship date.")}
              />
            )}
            <TextField
              label={t("Message below Add to cart")}
              value={defaultDeliveryNote}
              onChange={setDefaultDeliveryNote}
              autoComplete="off"
              multiline={2}
              helpText="Shown under the Preorder button. Use {{shipping_date}} to insert the product's ship date automatically."
            />
            <TextField
              label={t("Fallback message (when no ship date is set)")}
              value={defaultDeliveryFallback}
              onChange={setDefaultDeliveryFallback}
              autoComplete="off"
              multiline={2}
              helpText="Used when a product has no ship date, so {{shipping_date}} would be empty."
            />
          </BlockStack>
        </Card>

        <div id="sec-lineitem" />
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">{t("Preorder in cart & checkout")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("What shoppers see on the preorder line through cart, checkout, and the order.")}</Text>
            </BlockStack>
            <Divider />
            <Checkbox
              label={t("Show a “Preorder” label and ship date on the cart line")}
              checked={showLineItemProps}
              onChange={setShowLineItemProps}
            />
            {showLineItemProps && (
              <BlockStack gap="300">
                <TextField
                  label={t("Label property name")}
                  value={preorderPropLabel}
                  onChange={setPreorderPropLabel}
                  autoComplete="off"
                  helpText={t("Shows as e.g. “Preorder: Yes”.")}
                />
                <TextField
                  label={t("Ship-date property name")}
                  value={shipDatePropLabel}
                  onChange={setShipDatePropLabel}
                  autoComplete="off"
                  helpText={t("Shows the ship date, e.g. “Ships: Aug 15”.")}
                />
              </BlockStack>
            )}
            <Banner tone="info">
              <Text as="span">{t("These are visible line-item properties. Internal IDs Encore adds stay hidden (underscore-prefixed). In Shopify selling-plan mode the plan carries the preorder; in legacy mode these properties do.")}</Text>
            </Banner>
          </BlockStack>
        </Card>

        <div id="sec-inventory" />
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">{t("Inventory rules")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("When preorder is available and how stock is handled. Applies to every preorder.")}</Text>
            </BlockStack>
            <Divider />
            <ChoiceList
              title={t("When should preorder be available?")}
              choices={[
                {
                  label: t("Always allow preorder (recommended)"),
                  value: "always",
                  helpText: "Customers can preorder regardless of stock level.",
                },
                {
                  label: t("When product is out of stock"),
                  value: "oos",
                  helpText: "Preorder appears only when inventory reaches 0.",
                },
                {
                  label: t("When product is in stock"),
                  value: "in_stock",
                  helpText:
                    "Use available inventory as preorder units until it reaches 0.",
                },
              ]}
              selected={[availabilityRule]}
              onChange={(v) =>
                setAvailabilityRule(v[0] as "always" | "oos" | "in_stock")
              }
            />
            <Checkbox
              label={t("Automatically stop preorders when stock reaches 0")}
              checked={autoStopAtZero}
              onChange={setAutoStopAtZero}
            />
            <Checkbox
              label={'Auto-manage "Continue selling when out of stock"'}
              helpText={t("Encore toggles this on products based on inventory levels.")}
              checked={autoManageContinueSelling}
              onChange={setAutoManageContinueSelling}
            />
            <Divider />
            <ChoiceList
              title={t("How is inventory reserved?")}
              choices={[
                {
                  label: t("Reserve on sale"),
                  value: "on_sale",
                  helpText:
                    "Inventory is reduced as soon as the customer checks out.",
                },
                {
                  label: t("Reserve on fulfillment"),
                  value: "on_fulfillment",
                  helpText:
                    "Inventory is reduced only when the order is fulfilled.",
                },
              ]}
              selected={[reserveMode]}
              onChange={(v) =>
                setReserveMode(v[0] as "on_sale" | "on_fulfillment")
              }
            />
          </BlockStack>
        </Card>

        <div id="sec-button" />
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">{t("Preorder button & storefront")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("Default button text and how it behaves before a preorder starts or after it ends.")}</Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <TextField
                label={t("Default button label")}
                value={defaultButtonLabel}
                onChange={setDefaultButtonLabel}
                autoComplete="off"
                helpText={t("Override per preorder if needed.")}
              />
              <Select
                label={t("Button placement")}
                options={[
                  { label: t("Replace Add to cart"), value: "replace" },
                  { label: t("Beside Add to cart"), value: "beside" },
                  { label: t("Stacked below"), value: "stack" },
                ]}
                value={ctaPlacement}
                onChange={(v) =>
                  setCtaPlacement(v as "replace" | "beside" | "stack")
                }
              />
              <Checkbox
                label={'Show "Coming soon" before the preorder starts'}
                checked={comingSoonBeforeStart}
                onChange={setComingSoonBeforeStart}
              />
              <Checkbox
                label={'Show "Not available" after the preorder ends'}
                checked={notAvailableAfterEnd}
                onChange={setNotAvailableAfterEnd}
              />
              <Checkbox
                label={'Hide the "Buy it now" button on preorder products'}
                checked={hideBuyNow}
                onChange={setHideBuyNow}
              />
              <Checkbox
                label={t("Show preorder badge on product & collection pages")}
                checked={showPreorderLabel}
                onChange={setShowPreorderLabel}
              />
              <Checkbox
                label={t("Show promotional message & fulfillment note")}
                checked={showPromoNote}
                onChange={setShowPromoNote}
              />
            </BlockStack>
          </BlockStack>
        </Card>

        <div id="sec-cart" />
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">{t("Cart")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("How preorder items appear in the cart, and what shoppers see when they mix preorder and in-stock items.")}</Text>
            </BlockStack>
            <Divider />
            <BlockStack gap="300">
              <Checkbox
                label={t("Show mixed-cart warning")}
                helpText={t("Warn when a cart has both preorder and in-stock items.")}
                checked={mixedCartWarning}
                onChange={setMixedCartWarning}
              />
              {mixedCartWarning && (
                <TextField
                  label={t("Warning message")}
                  value={mixedCartMessage}
                  onChange={setMixedCartMessage}
                  autoComplete="off"
                  multiline={2}
                />
              )}
              <Checkbox
                label={t("Show preorder note on the cart line item")}
                checked={showLineItem}
                onChange={setShowLineItem}
              />
              <Checkbox
                label={t("Show a contact link in the cart")}
                checked={showContactLink}
                onChange={setShowContactLink}
              />
              {showContactLink && (
                <BlockStack gap="300">
                  <TextField
                    label={t("Contact email")}
                    value={contactEmail}
                    onChange={setContactEmail}
                    autoComplete="off"
                    type="email"
                  />
                  <TextField
                    label={t("Contact subject")}
                    value={contactSubject}
                    onChange={setContactSubject}
                    autoComplete="off"
                  />
                </BlockStack>
              )}
            </BlockStack>
          </BlockStack>
        </Card>

        <div id="sec-payment" />
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">{t("Payment & balances")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("How preorders integrate with checkout and how the remaining balance is collected on deposits.")}</Text>
            </BlockStack>
            <Divider />
            <ChoiceList
              title={t("Preorder model")}
              choices={[
                {
                  label: t("Use Shopify selling plan (recommended)"),
                  value: "selling_plan",
                  helpText: "Integrated with Shopify checkout & orders.",
                },
                {
                  label: t("Legacy"),
                  value: "legacy",
                  helpText: "Less integrated, more adaptable.",
                },
              ]}
              selected={[preorderModel]}
              onChange={(v) =>
                setPreorderModel(v[0] as "selling_plan" | "legacy")
              }
            />
            <Divider />
            <ChoiceList
              title={t("Charge the remaining balance")}
              choices={[
                {
                  label: t("Auto-charge remaining balance"),
                  value: "auto",
                  helpText:
                    "Charged on a set date or X days after checkout.",
                },
                {
                  label: t("Send payment reminder email"),
                  value: "reminder",
                  helpText: "Ask the customer to pay the balance themselves.",
                },
              ]}
              selected={[balanceCharge]}
              onChange={(v) => setBalanceCharge(v[0] as "auto" | "reminder")}
            />
            {balanceCharge === "auto" && (
              <TextField
                label={t("Charge balance before ship date")}
                type="number"
                value={balanceChargeDays}
                onChange={setBalanceChargeDays}
                autoComplete="off"
                suffix={t("days before")}
              />
            )}
            <Checkbox
              label={t("Send notifications about overdue balances")}
              checked={notifyOverdue}
              onChange={setNotifyOverdue}
            />
            <Divider />
            <TextField
              label={t("Tag name for preorder orders")}
              value={orderTagName}
              onChange={setOrderTagName}
              autoComplete="off"
              helpText={t("Applied to every preorder in Shopify admin.")}
            />
          </BlockStack>
        </Card>

        <div id="sec-design" />
        <Card>
          <BlockStack gap="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">{t("Design")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("Match the preorder badge and button to your store. Custom CSS for fine control.")}</Text>
            </BlockStack>
            <Divider />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 360px)",
                gap: 20,
                alignItems: "start",
              }}
            >
              <BlockStack gap="400">
            <ChoiceList
              title={t("Badge style")}
              choices={[
                { label: t("Pill"), value: "pill" },
                { label: t("Corner tag"), value: "corner" },
                { label: t("Ribbon"), value: "ribbon" },
              ]}
              selected={[badgeStyle]}
              onChange={(v) =>
                setBadgeStyle(v[0] as "pill" | "corner" | "ribbon")
              }
            />
            <InlineStack gap="300" blockAlign="end">
              <Box minWidth="200px">
                <TextField
                  label={t("Button colour (hex)")}
                  value={buttonColor}
                  onChange={setButtonColor}
                  autoComplete="off"
                />
              </Box>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: buttonColor,
                  border: "1px solid #E1E3E5",
                }}
              />
            </InlineStack>
            <TextField
              label={t("Custom CSS")}
              value={customCss}
              onChange={setCustomCss}
              autoComplete="off"
              multiline={6}
              placeholder=".encore-preorder-button { border-radius: 8px; }"
              helpText={t("Advanced — applied to the storefront block for this store.")}
            />
              </BlockStack>

              <div style={{ position: "sticky", top: 16 }}>
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">{t("Live preview")}</Text>
                <Checkbox
                  label={t("Preview without a ship date")}
                  checked={previewNoDate}
                  onChange={setPreviewNoDate}
                />
              </InlineStack>
              <Box
                padding="500"
                borderWidth="025"
                borderColor="border"
                borderRadius="300"
                background="bg-surface"
              >
                <div className="encore-preview">
                  <style dangerouslySetInnerHTML={{ __html: customCss }} />
                  <div style={{ maxWidth: 320 }}>
                    <span
                      className="encore-preorder-badge"
                      style={{
                        display: "inline-block",
                        background: buttonColor,
                        color: "#ffffff",
                        fontSize: 12,
                        fontWeight: 600,
                        padding: "4px 10px",
                        borderRadius:
                          badgeStyle === "pill"
                            ? 999
                            : badgeStyle === "corner"
                              ? 4
                              : 2,
                      }}
                    >
                      Preorder
                    </span>
                    <div
                      style={{
                        marginTop: 12,
                        fontWeight: 600,
                        fontSize: 16,
                        color: "#202223",
                      }}
                    >
                      Aurora Hoodie — Indigo
                    </div>
                    <div style={{ color: "#6D7175", marginBottom: 12 }}>
                      $54.00
                    </div>
                    <button
                      type="button"
                      className="encore-preorder-button"
                      style={{
                        background: buttonColor,
                        color: "#ffffff",
                        border: "none",
                        borderRadius: 8,
                        padding: "11px 16px",
                        fontWeight: 600,
                        width: "100%",
                        cursor: "default",
                      }}
                    >
                      {defaultButtonLabel}
                    </button>
                    <div
                      className="encore-preorder-note"
                      style={{ marginTop: 8, color: "#6D7175", fontSize: 13 }}
                    >
                      {previewNote}
                    </div>
                  </div>
                </div>
              </Box>
              <Text as="p" variant="bodySm" tone="subdued">{t("Updates live as you change the colour, badge, message, or custom CSS. Your CSS can target .encore-preorder-button, .encore-preorder-badge, or .encore-preorder-note.")}</Text>
            </BlockStack>
              </div>
            </div>
          </BlockStack>
        </Card>

        {/* Storefront block status */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">{t("Storefront block")}</Text>
                  <Badge tone={embedEnabled ? "success" : "warning"}>
                    {embedEnabled ? "Enabled" : "Disabled"}
                  </Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">{t("The Preorder button appears automatically on product pages for variants you've put on preorder. No theme code needed.")}</Text>
              </BlockStack>
              <Button
                url={`https://${shop}/admin/themes/current/editor?context=apps`}
                external
              >{t("Open theme editor")}</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <div id="sec-discounts" />
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">{t("Discount compatibility")}</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {t("Check your active discounts against pre-orders — Buy-X-Get-Y is the usual conflict.")}
                </Text>
              </BlockStack>
              <Button onClick={checkDiscounts} loading={discountFetcher.state !== "idle"}>
                {t("Check now")}
              </Button>
            </InlineStack>
            <Divider />
            {discountFetcher.data?.error ? (
              <Banner tone="warning">
                <Text as="span">
                  {t("Couldn't read discounts — confirm the app has the read_discounts permission (re-grant after deploy).")}
                </Text>
              </Banner>
            ) : discountFetcher.data ? (
              (discountFetcher.data.rows?.length ?? 0) === 0 ? (
                <Text as="p" tone="subdued">{t("No active discounts — nothing conflicts with pre-orders.")}</Text>
              ) : (
                <BlockStack gap="300">
                  {discountFetcher.data.rows?.map((d) => (
                    <InlineStack key={d.id} align="space-between" blockAlign="start" wrap={false} gap="300">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">{d.title}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{d.kind} — {d.note}</Text>
                      </BlockStack>
                      <Badge tone={discountTone(d.status)}>
                        {d.status === "OK" ? t("Compatible") : d.status === "REVIEW" ? t("Review") : t("Conflict")}
                      </Badge>
                    </InlineStack>
                  ))}
                </BlockStack>
              )
            ) : (
              <Text as="p" tone="subdued">
                {t("Run a check to see how your live discounts interact with pre-orders.")}
              </Text>
            )}
          </BlockStack>
        </Card>

        <div id="sec-advanced" />
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <InlineStack gap="200" blockAlign="center">
                  <Text as="h2" variant="headingMd">{t("Advanced")}</Text>
                  <Icon source={InfoIcon} tone="subdued" />
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">{t("Email integrations, SMS alerts, danger zone.")}</Text>
              </BlockStack>
              <Button
                variant="tertiary"
                icon={advancedOpen ? ChevronUpIcon : ChevronDownIcon}
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                {advancedOpen ? "Hide" : "Show"} advanced
              </Button>
            </InlineStack>

            <Collapsible
              id="settings-advanced"
              open={advancedOpen}
              transition={{ duration: "200ms", timingFunction: "ease" }}
            >
              <BlockStack gap="500">
                <Divider />

                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">{t("Email integrations")}</Text>
                  <IntegrationRow
                    name="Klaviyo"
                    helpText={t("Sync waitlist signups + preorder campaigns to a Klaviyo list.")}
                    onConnect={() => handleConnect("Klaviyo")}
                    connected={!!klaviyoKey}
                  >
                    <TextField
                      label={t("API key")}
                      labelHidden
                      value={klaviyoKey}
                      onChange={setKlaviyoKey}
                      autoComplete="off"
                      placeholder={t("pk_xxxxx")}
                      type="password"
                    />
                  </IntegrationRow>
                  <Divider />
                  <IntegrationRow
                    name="Omnisend"
                    helpText={t("Push preorder events into Omnisend automation flows.")}
                    onConnect={() => handleConnect("Omnisend")}
                    connected={!!omnisendKey}
                  >
                    <TextField
                      label={t("API key")}
                      labelHidden
                      value={omnisendKey}
                      onChange={setOmnisendKey}
                      autoComplete="off"
                      placeholder={t("omn-xxxxx")}
                      type="password"
                    />
                  </IntegrationRow>
                  <Divider />
                  <IntegrationRow
                    name="Slack alerts"
                    helpText={t("Per-preorder merchant alerts (balance failures, cohort ready).")}
                    onConnect={() => handleConnect("Slack")}
                    connected={!!slackWebhook}
                  >
                    <TextField
                      label={t("Webhook URL")}
                      labelHidden
                      value={slackWebhook}
                      onChange={setSlackWebhook}
                      autoComplete="off"
                      placeholder={t("https://hooks.slack.com/services/...")}
                    />
                  </IntegrationRow>
                </BlockStack>

                <Divider />

                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">{t("Email & SMS")}</Text>
                  <TextField
                    label={t("Sender email")}
                    value={senderEmail}
                    onChange={setSenderEmail}
                    autoComplete="off"
                    type="email"
                    helpText={t("Verify SPF/DKIM in your email host before going live.")}
                  />
                  <Checkbox
                    label={t("Enable SMS for back-in-stock alerts")}
                    helpText={t("Requires Twilio (or compatible) credentials in v1.1.")}
                    checked={smsEnabled}
                    onChange={setSmsEnabled}
                  />
                </BlockStack>

                <Divider />

                <BlockStack gap="300">
                  <Text as="h3" variant="headingSm">{t("Danger zone")}</Text>
                  <InlineStack
                    align="space-between"
                    blockAlign="center"
                    wrap={false}
                  >
                    <BlockStack gap="050">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{t("Wipe demo data")}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{t("Deletes all preorders, cohorts, customer preorders, and waitlist subscriptions for this shop.")}</Text>
                    </BlockStack>
                    <Button tone="critical" onClick={handleWipeDemo}>{t("Wipe data")}</Button>
                  </InlineStack>
                  <Divider />
                  <InlineStack
                    align="space-between"
                    blockAlign="center"
                    wrap={false}
                  >
                    <BlockStack gap="050">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">{t("Uninstall app")}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{t("Uninstall from Shopify admin. We guarantee a clean uninstall — no leftover theme code.")}</Text>
                    </BlockStack>
                    <Button url={`https://${shop}/admin/apps`} external>{t("Open admin apps")}</Button>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Collapsible>
          </BlockStack>
        </Card>

        <Box paddingBlockEnd="400">
          <Text as="p" variant="bodySm" tone="subdued" alignment="center">
            Need help?{" "}
            <Link url="https://docs.preordernovafied.app" external>
              Read the docs
            </Link>{" "}
            or contact{" "}
            <Link url="mailto:support@preordernovafied.app">support</Link>.
          </Text>
        </Box>
      </BlockStack>
      </div>
    </Page>
  );
}

function IntegrationRow({
  name,
  helpText,
  onConnect,
  connected,
  children,
}: {
  name: string;
  helpText: string;
  onConnect: () => void;
  connected: boolean;
  children: React.ReactNode;
}) {
  return (
    <BlockStack gap="200">
      <InlineStack align="space-between" blockAlign="center">
        <BlockStack gap="050">
          <InlineStack gap="200">
            <Text as="p" variant="bodyMd" fontWeight="semibold">
              {name}
            </Text>
            <Badge tone={connected ? "success" : undefined}>
              {connected ? "Connected" : "Not connected"}
            </Badge>
          </InlineStack>
          <Text as="p" variant="bodySm" tone="subdued">
            {helpText}
          </Text>
        </BlockStack>
        <Button onClick={onConnect}>
          {connected ? "Reconnect" : "Connect"}
        </Button>
      </InlineStack>
      {children}
    </BlockStack>
  );
}
