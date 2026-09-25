import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useNavigate, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  LanguageIcon,
  CartIcon,
  OrderIcon,
  InventoryIcon,
  ButtonIcon,
  CashDollarIcon,
  DiscountIcon,
  PaintBrushFlatIcon,
  SettingsIcon,
  MenuHorizontalIcon,
  GlobeIcon,
  EmailIcon,
  QuestionCircleIcon,
} from "@shopify/polaris-icons";
import { AppPage, IconTile, NavList, type TileTone } from "../components/ui";
import { SelectField, ChoiceListField, badgeTone, flag, isChecked, val } from "../components/wc";

type IconSource = React.FunctionComponent<React.SVGProps<SVGSVGElement>>;
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { useLocale, LOCALE_NAMES, LOCALES, type Locale } from "../lib/i18n";
import { getSettings, saveSettingsSection } from "../models/settings.server";
import {
  checkDiscountCompatibility,
  type DiscountCompatRow,
} from "../services/discount-compat.server";
import { getEmbedStatus, embedActivationUrl } from "../models/theme-embed.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const { general } = await getSettings(session.shop);
  // Real check against the live theme (not the saved flag).
  const embed = await getEmbedStatus(admin);
  return { shop: session.shop, saved: general, embed, embedUrl: embedActivationUrl(session.shop) };
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
  const { shop, saved, embed, embedUrl } = useLoaderData<typeof loader>();
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
  const navigate = useNavigate();
  // Klaviyo OAuth starts with an authenticated fetch, then a top-level hop
  // (the route answers JSON; a plain link inside the iframe used to show it).
  const klaviyoConnect = useFetcher<{ url?: string; error?: string }>();
  useEffect(() => {
    const u = klaviyoConnect.data?.url;
    if (u) window.open(u, "_top");
  }, [klaviyoConnect.data]);
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
    badgePosition: "auto" | "price" | "image-left" | "image-right" | "button";
    collectionBadges: boolean;
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
  const [embedEnabled] = useState(g.embedEnabled ?? true);
  const [smsEnabled] = useState(g.smsEnabled ?? false);

  // Inventory rules
  const [availabilityRule] = useState<"always" | "oos" | "in_stock">(g.availabilityRule ?? "always");
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
  const [badgePosition, setBadgePosition] = useState<
    "auto" | "price" | "image-left" | "image-right" | "button"
  >(g.badgePosition ?? "auto");
  const [collectionBadges, setCollectionBadges] = useState(g.collectionBadges ?? true);
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
          badgeStyle, badgePosition, collectionBadges, buttonColor, customCss,
        }),
      },
      { method: "post" },
    );
    shopify.toast.show(t("Settings saved"));
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

  const SETTINGS_SECTIONS: [string, string, IconSource, TileTone][] = [
    ["sec-language", t("settings.sec.language"), LanguageIcon, "sky"],
    ["sec-defaults", t("settings.sec.defaults"), CartIcon, "violet"],
    ["sec-lineitem", t("settings.sec.lineitem"), OrderIcon, "teal"],
    ["sec-inventory", t("settings.sec.inventory"), InventoryIcon, "amber"],
    ["sec-button", t("settings.sec.button"), ButtonIcon, "violet"],
    ["sec-cart", t("settings.sec.cart"), CartIcon, "emerald"],
    ["sec-payment", t("settings.sec.payment"), CashDollarIcon, "emerald"],
    ["sec-discounts", t("Discounts"), DiscountIcon, "rose"],
    ["sec-design", t("settings.sec.design"), PaintBrushFlatIcon, "amber"],
    ["sec-advanced", t("settings.sec.advanced"), SettingsIcon, "slate"],
    ["sec-more", t("More settings"), MenuHorizontalIcon, "slate"],
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
    <AppPage
      heading={t("settings.title")}
      intro={t("Store-wide settings — set once. They apply to every preorder; a few can be overridden per preorder.")}
      primaryAction={
        <s-button variant="primary" onClick={handleSave}>
          {t("common.save")}
        </s-button>
      }
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
          <s-section>
            <s-stack direction="block" gap="small-300">
              {SETTINGS_SECTIONS.map(([id, label, icon, tone]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => jumpTo(id)}
                  style={{ all: "unset", outline: "revert", cursor: "pointer", display: "block", width: "100%" }}
                >
                  <s-box padding="small-100" borderRadius="base" background={activeSec === id ? "subdued" : "transparent"}>
                    <s-stack direction="inline" gap="small-100" alignItems="center">
                      <IconTile icon={icon} tone={activeSec === id ? tone : "slate"} size="sm" />
                      <s-text fontWeight={activeSec === id ? "semibold" : "auto"}>{label}</s-text>
                    </s-stack>
                  </s-box>
                </button>
              ))}
            </s-stack>
          </s-section>
        </div>

        <s-stack direction="block" gap="large">
        <div id="sec-language" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>{t("App language")}</s-heading>
              <s-paragraph fontSize="small" color="subdued">{t("The language of this admin app. Defaults to your store's language; change it just for your account.")}</s-paragraph>
            </s-stack>
            <s-divider />
            <SelectField
              label={t("App language")}
              labelHidden
              options={LOCALES.map((l) => ({
                label: LOCALE_NAMES[l],
                value: l,
              }))}
              value={locale}
              onChange={(v) => setLocale(v as Locale)}
            />
          </s-stack>
        </s-section>

        <div id="sec-defaults" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-heading>{t("Preorder defaults")}</s-heading>
            <s-divider />
            <SelectField
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
              details={t("Most stores keep this on Full at checkout. Use Deposit to lower the buying barrier on big-ticket items.")}
            />
            {defaultPaymentMode === "deposit" && (
              <s-number-field
                label={t("Default deposit percentage")}
                value={defaultDepositPct}
                onInput={(e) => setDefaultDepositPct(val(e))}
                suffix="%"
                details={t("The remainder is auto-charged 7 days before the ship date.")}/>
            )}
            <s-text-area
              label={t("Message below Add to cart")}
              value={defaultDeliveryNote}
              onInput={(e) => setDefaultDeliveryNote(val(e))} rows={2}
              details="Shown under the Preorder button. Use {{shipping_date}} to insert the product's ship date automatically."/>
            <s-text-area
              label={t("Fallback message (when no ship date is set)")}
              value={defaultDeliveryFallback}
              onInput={(e) => setDefaultDeliveryFallback(val(e))} rows={2}
              details="Used when a product has no ship date, so {{shipping_date}} would be empty."/>
          </s-stack>
        </s-section>

        <div id="sec-lineitem" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>{t("Preorder in cart & checkout")}</s-heading>
              <s-paragraph fontSize="small" color="subdued">{t("What shoppers see on the preorder line through cart, checkout, and the order.")}</s-paragraph>
            </s-stack>
            <s-divider />
            <s-checkbox
              label={t("Show a “Preorder” label and ship date on the cart line")}
              checked={flag(showLineItemProps)}
              onChange={(e) => setShowLineItemProps(isChecked(e))}/>
            {showLineItemProps && (
              <s-stack direction="block" gap="small">
                <s-text-field
                  label={t("Label property name")}
                  value={preorderPropLabel}
                  onInput={(e) => setPreorderPropLabel(val(e))}
                  details={t("Shows as e.g. “Preorder: Yes”.")}/>
                <s-text-field
                  label={t("Ship-date property name")}
                  value={shipDatePropLabel}
                  onInput={(e) => setShipDatePropLabel(val(e))}
                  details={t("Shows the ship date, e.g. “Ships: Aug 15”.")}/>
              </s-stack>
            )}
            <s-banner tone="info">
              <s-text>{t("These are visible line-item properties. Internal IDs Encore adds stay hidden (underscore-prefixed). In Shopify selling-plan mode the plan carries the preorder; in legacy mode these properties do.")}</s-text>
            </s-banner>
          </s-stack>
        </s-section>

        <div id="sec-inventory" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>{t("Inventory rules")}</s-heading>
              <s-paragraph fontSize="small" color="subdued">{t("When preorder is available and how stock is handled. Applies to every preorder.")}</s-paragraph>
            </s-stack>
            <s-divider />
            <s-paragraph fontSize="small" color="subdued">{t('When shoppers see each preorder ("Always" for presales, or "Only when sold out") is set on the preorder itself — open any preorder and choose under "When shoppers see it".')}</s-paragraph>
            <s-checkbox
              label={t("Automatically stop preorders when stock reaches 0")}
              checked={flag(autoStopAtZero)}
              onChange={(e) => setAutoStopAtZero(isChecked(e))}/>
            <s-checkbox
              label={'Auto-manage "Continue selling when out of stock"'}
              details={t("While a campaign is live, Encore turns this on for its variants so shoppers can buy past zero stock. When a variant's preorder allocation sells out, or the campaign pauses or ends, Encore turns it back off — the product shows Sold out and Shopify rejects further orders.")}
              checked={flag(autoManageContinueSelling)}
              onChange={(e) => setAutoManageContinueSelling(isChecked(e))}/>
            <s-divider />
            <ChoiceListField
              label={t("How is inventory reserved?")}
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
          </s-stack>
        </s-section>

        <div id="sec-button" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>{t("Preorder button & storefront")}</s-heading>
              <s-paragraph fontSize="small" color="subdued">{t("Default button text and how it behaves before a preorder starts or after it ends.")}</s-paragraph>
            </s-stack>
            <s-divider />
            <s-stack direction="block" gap="small">
              <s-text-field
                label={t("Default button label")}
                value={defaultButtonLabel}
                onInput={(e) => setDefaultButtonLabel(val(e))}
                details={t("Override per preorder if needed.")}/>
              <SelectField
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
              <s-checkbox
                label={'Show "Coming soon" before the preorder starts'}
                checked={flag(comingSoonBeforeStart)}
                onChange={(e) => setComingSoonBeforeStart(isChecked(e))}/>
              <s-checkbox
                label={'Show "Not available" after the preorder ends'}
                checked={flag(notAvailableAfterEnd)}
                onChange={(e) => setNotAvailableAfterEnd(isChecked(e))}/>
              <s-checkbox
                label={'Hide the "Buy it now" button on preorder products'}
                checked={flag(hideBuyNow)}
                onChange={(e) => setHideBuyNow(isChecked(e))}/>
              <s-checkbox
                label={t("Show preorder badge on product & collection pages")}
                checked={flag(showPreorderLabel)}
                onChange={(e) => setShowPreorderLabel(isChecked(e))}/>
              <s-checkbox
                label={t("Show promotional message & fulfillment note")}
                checked={flag(showPromoNote)}
                onChange={(e) => setShowPromoNote(isChecked(e))}/>
            </s-stack>
          </s-stack>
        </s-section>

        <div id="sec-cart" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>{t("Cart")}</s-heading>
              <s-paragraph fontSize="small" color="subdued">{t("How preorder items appear in the cart, and what shoppers see when they mix preorder and in-stock items.")}</s-paragraph>
            </s-stack>
            <s-divider />
            <s-stack direction="block" gap="small">
              <s-checkbox
                label={t("Show mixed-cart warning")}
                details={t("Warn when a cart has both preorder and in-stock items.")}
                checked={flag(mixedCartWarning)}
                onChange={(e) => setMixedCartWarning(isChecked(e))}/>
              {mixedCartWarning && (
                <s-text-area
                  label={t("Warning message")}
                  value={mixedCartMessage}
                  onInput={(e) => setMixedCartMessage(val(e))} rows={2}/>
              )}
              <s-checkbox
                label={t("Show preorder note on the cart line item")}
                checked={flag(showLineItem)}
                onChange={(e) => setShowLineItem(isChecked(e))}/>
              <s-checkbox
                label={t("Show a contact link in the cart")}
                checked={flag(showContactLink)}
                onChange={(e) => setShowContactLink(isChecked(e))}/>
              {showContactLink && (
                <s-stack direction="block" gap="small">
                  <s-email-field
                    label={t("Contact email")}
                    value={contactEmail}
                    onInput={(e) => setContactEmail(val(e))}/>
                  <s-text-field
                    label={t("Contact subject")}
                    value={contactSubject}
                    onInput={(e) => setContactSubject(val(e))}/>
                </s-stack>
              )}
            </s-stack>
          </s-stack>
        </s-section>

        <div id="sec-payment" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>{t("Payment & balances")}</s-heading>
              <s-paragraph fontSize="small" color="subdued">{t("How preorders integrate with checkout and how the remaining balance is collected on deposits.")}</s-paragraph>
            </s-stack>
            <s-divider />
            <ChoiceListField
              label={t("Preorder model")}
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
            <s-divider />
            <ChoiceListField
              label={t("Charge the remaining balance")}
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
              <s-number-field
                label={t("Charge balance before ship date")}
                value={balanceChargeDays}
                onInput={(e) => setBalanceChargeDays(val(e))}
                suffix={t("days before")}/>
            )}
            <s-checkbox
              label={t("Send notifications about overdue balances")}
              checked={flag(notifyOverdue)}
              onChange={(e) => setNotifyOverdue(isChecked(e))}/>
            <s-divider />
            <s-text-field
              label={t("Tag name for preorder orders")}
              value={orderTagName}
              onInput={(e) => setOrderTagName(val(e))}
              details={t("Applied to every preorder in Shopify admin.")}/>
          </s-stack>
        </s-section>

        <div id="sec-design" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>{t("Design")}</s-heading>
              <s-paragraph fontSize="small" color="subdued">{t("Match the preorder badge and button to your store. Custom CSS for fine control.")}</s-paragraph>
            </s-stack>
            <s-divider />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 360px)",
                gap: 20,
                alignItems: "start",
              }}
            >
              <s-stack direction="block" gap="base">
            <ChoiceListField
              label={t("Badge style")}
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
            <SelectField
              label={t("Badge position on the product page")}
              options={[
                { label: t("Smart (next to the price, else on the image)"), value: "auto" },
                { label: t("Next to the price"), value: "price" },
                { label: t("On the image — top left"), value: "image-left" },
                { label: t("On the image — top right"), value: "image-right" },
                { label: t("Above the Preorder button"), value: "button" },
              ]}
              value={badgePosition}
              onChange={(v) =>
                setBadgePosition(v as "auto" | "price" | "image-left" | "image-right" | "button")
              }
              details={t("Smart placement finds your theme's price or main image automatically — works on any theme.")}
            />
            <s-checkbox
              label={t("Show the preorder badge on collection, search and home product cards")}
              checked={flag(collectionBadges)}
              onChange={(e) => setCollectionBadges(isChecked(e))}/>
            <s-stack direction="inline" gap="small" alignItems="end">
              <s-box>
                <s-text-field
                  label={t("Button colour (hex)")}
                  value={buttonColor}
                  onInput={(e) => setButtonColor(val(e))}/>
              </s-box>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: buttonColor,
                  border: "1px solid var(--p-color-border)",
                }}
              />
            </s-stack>
            <s-text-area
              label={t("Custom CSS")}
              value={customCss}
              onInput={(e) => setCustomCss(val(e))} rows={6}
              placeholder=".encore-preorder-button { border-radius: 8px; }"
              details={t("Advanced — applied to the storefront block for this store.")}/>
              </s-stack>

              <div style={{ position: "sticky", top: 16 }}>
            <s-stack direction="block" gap="small">
              <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                <s-heading fontSize="small">{t("Live preview")}</s-heading>
                <s-checkbox
                  label={t("Preview without a ship date")}
                  checked={flag(previewNoDate)}
                  onChange={(e) => setPreviewNoDate(isChecked(e))}/>
              </s-stack>
              <s-box
                padding="large" border="base"
                borderRadius="base"
                background="base"
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
                      {t("Preorder")}
                    </span>
                    <div
                      style={{
                        marginTop: 12,
                        fontWeight: 600,
                        fontSize: 16,
                        color: "var(--p-color-text)",
                      }}
                    >
                      {t("Aurora Hoodie — Indigo")}
                    </div>
                    <div style={{ color: "var(--p-color-text-secondary)", marginBottom: 12 }}>
                      $54.00
                    </div>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden="true"
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
                      style={{ marginTop: 8, color: "var(--p-color-text-secondary)", fontSize: 13 }}
                    >
                      {previewNote}
                    </div>
                  </div>
                </div>
              </s-box>
              <s-paragraph fontSize="small" color="subdued">{t("Updates live as you change the colour, badge, message, or custom CSS. Your CSS can target .encore-preorder-button, .encore-preorder-badge, or .encore-preorder-note.")}</s-paragraph>
            </s-stack>
              </div>
            </div>
          </s-stack>
        </s-section>

        {/* Storefront block status — verified against the live theme */}
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-stack direction="block" gap="small-300">
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-heading>{t("Storefront block")}</s-heading>
                  {embed.checked ? (
                    <s-badge tone={badgeTone(embed.enabled ? "success" : "critical")}>
                      {embed.enabled ? t("Enabled") : t("Not enabled")}
                    </s-badge>
                  ) : (
                    <s-badge tone="caution">{t("Not verified")}</s-badge>
                  )}
                </s-stack>
                <s-paragraph fontSize="small" color="subdued">
                  {embed.checked
                    ? embed.enabled
                      ? t("Encore's app embed is on in your live theme ({theme}). The Preorder button, Notify-me and Low-stock appear automatically next to your add-to-cart button — no theme code needed.").replace("{theme}", embed.themeName)
                      : t("Encore's app embed is OFF in your live theme ({theme}). Nothing will show on the storefront until it is turned on — click Turn on, then Save in the theme editor.").replace("{theme}", embed.themeName)
                    : t("Could not read your live theme to confirm the embed is on. Open the theme editor → App embeds and make sure Encore is toggled on.")}
                </s-paragraph>
              </s-stack>
              <s-button href={embedUrl} target="_blank" variant={embed.checked && !embed.enabled ? "primary" : undefined}>
                {embed.checked && !embed.enabled ? t("Turn on in theme editor") : t("Open theme editor")}
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>

        <div id="sec-discounts" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-stack direction="block" gap="small-300">
                <s-heading>{t("Discount compatibility")}</s-heading>
                <s-paragraph fontSize="small" color="subdued">
                  {t("Check your active discounts against preorders — Buy-X-Get-Y is the usual conflict.")}
                </s-paragraph>
              </s-stack>
              <s-button onClick={checkDiscounts} loading={flag(discountFetcher.state !== "idle")}>
                {t("Check now")}
              </s-button>
            </s-stack>
            <s-divider />
            {discountFetcher.data?.error ? (
              <s-banner tone="warning">
                <s-text>
                  {t("Couldn't read discounts — confirm the app has the read_discounts permission (re-grant after deploy).")}
                </s-text>
              </s-banner>
            ) : discountFetcher.data ? (
              (discountFetcher.data.rows?.length ?? 0) === 0 ? (
                <s-paragraph color="subdued">{t("No active discounts — nothing conflicts with preorders.")}</s-paragraph>
              ) : (
                <s-stack direction="block" gap="small">
                  {discountFetcher.data.rows?.map((d) => (
                    <s-stack direction="inline" key={d.id} justifyContent="space-between" alignItems="start" gap="small">
                      <s-stack direction="block" gap="small-300">
                        <s-text fontWeight="semibold">{d.title}</s-text>
                        <s-text fontSize="small" color="subdued">{d.kind} — {d.note}</s-text>
                      </s-stack>
                      <s-badge tone={badgeTone(discountTone(d.status))}>
                        {d.status === "OK" ? t("Compatible") : d.status === "REVIEW" ? t("Review") : t("Conflict")}
                      </s-badge>
                    </s-stack>
                  ))}
                </s-stack>
              )
            ) : (
              <s-paragraph color="subdued">
                {t("Run a check to see how your live discounts interact with preorders.")}
              </s-paragraph>
            )}
          </s-stack>
        </s-section>

        <div id="sec-advanced" />
        <s-section>
          <s-stack direction="block" gap="base">
            <s-stack direction="inline" justifyContent="space-between" alignItems="center">
              <s-stack direction="block" gap="small-300">
                <s-stack direction="inline" gap="small-100" alignItems="center">
                  <s-heading>{t("Advanced")}</s-heading>
                  <s-icon type="info" color="subdued" />
                </s-stack>
                <s-paragraph fontSize="small" color="subdued">{t("Email integrations, SMS alerts, danger zone.")}</s-paragraph>
              </s-stack>
              <s-button
                variant="tertiary"
                icon={advancedOpen ? "chevron-up" : "chevron-down"}
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                {advancedOpen ? "Hide" : "Show"} advanced
              </s-button>
            </s-stack>

            {advancedOpen && (
            <div id="settings-advanced">
              <s-stack direction="block" gap="large">
                <s-divider />

                <s-stack direction="block" gap="small">
                  <s-heading fontSize="small">{t("Email integrations")}</s-heading>
                  <IntegrationRow
                    name="Klaviyo"
                    helpText={t("Sync waitlist signups + preorder campaigns to a Klaviyo list.")}
                    action={
                      <s-button onClick={() => klaviyoConnect.load("/klaviyo/connect")} loading={flag(klaviyoConnect.state !== "idle")}>
                        {klaviyoKey ? t("Reconnect") : t("Connect")}
                      </s-button>
                    }
                    connected={!!klaviyoKey}
                  >
                    <s-password-field
                      label={t("API key")}
                      labelAccessibilityVisibility="exclusive"
                      value={klaviyoKey}
                      onInput={(e) => setKlaviyoKey(val(e))}
                      placeholder={t("pk_xxxxx")}/>
                  </IntegrationRow>
                  <s-divider />
                  <IntegrationRow
                    name="Omnisend"
                    helpText={t("Push preorder events into Omnisend automation flows.")}
                    action={<s-button disabled>{t("Coming soon")}</s-button>}
                    connected={!!omnisendKey}
                  >
                    <s-password-field
                      label={t("API key")}
                      labelAccessibilityVisibility="exclusive"
                      value={omnisendKey}
                      onInput={(e) => setOmnisendKey(val(e))}
                      placeholder={t("omn-xxxxx")}/>
                  </IntegrationRow>
                  <s-divider />
                  <IntegrationRow
                    name="Slack alerts"
                    helpText={t("Per-preorder merchant alerts (balance failures, cohort ready).")}
                    action={<s-button disabled>{t("Coming soon")}</s-button>}
                    connected={!!slackWebhook}
                  >
                    <s-text-field
                      label={t("Webhook URL")}
                      labelAccessibilityVisibility="exclusive"
                      value={slackWebhook}
                      onInput={(e) => setSlackWebhook(val(e))}
                      placeholder={t("https://hooks.slack.com/services/...")}/>
                  </IntegrationRow>
                </s-stack>

                <s-divider />

                <s-stack direction="block" gap="small">
                  <s-heading fontSize="small">{t("Email & SMS")}</s-heading>
                  <s-email-field
                    label={t("Sender email")}
                    value={senderEmail}
                    onInput={(e) => setSenderEmail(val(e))}
                    details={t("Verify SPF/DKIM in your email host before going live.")}/>
                  {/* SMS delivery ships in R3 — hidden until real (audit O4). <s-checkbox
                    label={t("Enable SMS for back-in-stock alerts")}
                    details={t("Requires Twilio (or compatible) credentials in v1.1.")}
                    checked={flag(smsEnabled)}
                    onChange={(e) => setSmsEnabled(isChecked(e))}/> */}
                </s-stack>

                <s-divider />

                <s-stack direction="block" gap="small">
                  <s-heading fontSize="small">{t("Danger zone")}</s-heading>
                  <s-stack direction="inline"
                    justifyContent="space-between"
                    alignItems="center"
                  >
                    <s-stack direction="block" gap="small-300">
                      <s-paragraph fontWeight="semibold">{t("Uninstall app")}</s-paragraph>
                      <s-paragraph fontSize="small" color="subdued">{t("Uninstall from Shopify admin. We guarantee a clean uninstall — no leftover theme code.")}</s-paragraph>
                    </s-stack>
                    <s-button href={`https://${shop}/admin/apps`} target="_blank">{t("Open admin apps")}</s-button>
                  </s-stack>
                </s-stack>
              </s-stack>
            </div>
            )}
          </s-stack>
        </s-section>

        <div id="sec-more" />
        <NavList
          heading={t("More settings")}
          sub={t("Less-common areas, kept out of the way until you need them.")}
          items={[
            { icon: GlobeIcon, tone: "sky", title: t("Markets"), sub: t("Per-region preorder rules and availability."), onClick: () => navigate("/app/markets") },
            { icon: LanguageIcon, tone: "violet", title: t("nav.translations"), sub: t("Translate storefront and email text for your buyers."), onClick: () => navigate("/app/translations") },
            { icon: EmailIcon, tone: "teal", title: t("Notifications"), sub: t("Customer emails via Shopify Flow or Klaviyo — no added cost."), onClick: () => navigate("/app/notifications") },
            { icon: QuestionCircleIcon, tone: "slate", title: t("Get help"), sub: t("Send us a message — we usually reply within a day."), onClick: () => navigate("/app/help") },
          ]}
        />
      </s-stack>
      </div>
    </AppPage>
  );
}

function IntegrationRow({
  name,
  helpText,
  action,
  connected,
  children,
}: {
  name: string;
  helpText: string;
  action: React.ReactNode;
  connected: boolean;
  children: React.ReactNode;
}) {
  return (
    <s-stack direction="block" gap="small-100">
      <s-stack direction="inline" justifyContent="space-between" alignItems="center">
        <s-stack direction="block" gap="small-300">
          <s-stack direction="inline" gap="small-100">
            <s-paragraph fontWeight="semibold">
              {name}
            </s-paragraph>
            <s-badge tone={badgeTone(connected ? "success" : undefined)}>
              {connected ? "Connected" : "Not connected"}
            </s-badge>
          </s-stack>
          <s-paragraph fontSize="small" color="subdued">
            {helpText}
          </s-paragraph>
        </s-stack>
        {action}
      </s-stack>
      {children}
    </s-stack>
  );
}
