/**
 * Preorder setup form.
 *
 * Layout:
 *   - Left column:  name · ship date · payment · advanced (per-drop only)
 *   - Right column: Markets card · summary · publish checklist
 *   - Full-width bottom: "Select product" — scope + product table with
 *     Limit quantity, End quantity, and per-row Availability scheduling.
 *
 * Store-wide behaviours (inventory rules, mixed-cart, button text, notification
 * cadence, CSS) live in Settings — not here. Those fields are still serialized
 * with sensible defaults so existing preorders keep working.
 */

import { useState } from "react";
import ConfirmModal from "./ConfirmModal";
import { useLocale } from "../lib/i18n";
import { useNavigate, useNavigation, useSubmit } from "react-router";
import {
  PlusIcon,
  EditIcon,
  ViewIcon,
} from "@shopify/polaris-icons";
import { PageHero, SectionHead } from "./ui";
import { SelectField, ChoiceListField, badgeTone, flag, isChecked, val, useLinkProps } from "./wc";


// ---------- View-state shape ----------
export type VariantAvailabilityUI =
  | "now"
  | "from_start"
  | "now_until_end"
  | "between"
  | "not_available";

export type SelectedVariant = {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  unitsOffered: string; // "Limit quantity"
  endQty: string; // "End quantity"
  availability: VariantAvailabilityUI;
  availStart: string;
  availEnd: string;
};

export type CampaignFormValues = {
  name: string;
  internalNotes: string;

  // Product scope + selection.
  productMode: "specific" | "collection" | "all";
  collectionId: string;
  selectedVariants: SelectedVariant[];

  // Markets — [] means all markets.
  markets: string[];

  // Cohort
  shipDate: string;
  cohortName: string;

  // Payment — defaults to Pay Now.
  paymentMode: "pay_now" | "deposit" | "pay_later";
  depositKind: "percent" | "fixed";
  depositAmount: string;
  balanceCaptureDays: string;
  moqEnabled: boolean;
  moqUnits: string;
  moqDeadline: string;

  // Per-drop copy + discount (kept on this page).
  deliveryNote: string;
  discountEnabled: boolean;
  discountKind: "percent" | "fixed";
  discountAmount: string;

  // Store-wide (configured in Settings; INHERITED into every new rule, and
  // overridable per rule — see campaignDefaultsFromSettings).
  ctaLabel: string;
  ctaPlacement: "replace" | "beside" | "stack";
  cartMode: "split" | "warning";
  mixedCartWarning: string;
  confirmationEmail: boolean;
  restockAlert: boolean;
  balanceReminder: "7_days_before" | "3_days_before" | "on_ship" | "off";
  alertChannel: "email" | "slack" | "both";

  // Advanced — passthrough.
  orderTags: string[];
  dunningSteps: {
    id: string;
    channel: "email" | "sms";
    offsetDays: number;
    label: string;
  }[];
  webhookUrl: string;
  metafieldNamespace: string;
};

// ---------- Defaults ----------
export const CAMPAIGN_FORM_DEFAULTS: CampaignFormValues = {
  name: "",
  internalNotes: "",

  productMode: "specific",
  collectionId: "",
  selectedVariants: [],

  markets: [],

  shipDate: "",
  cohortName: "",

  paymentMode: "pay_now",
  depositKind: "percent",
  depositAmount: "20",
  balanceCaptureDays: "7",
  moqEnabled: false,
  moqUnits: "100",
  moqDeadline: "",

  deliveryNote: "Ships when ready",
  discountEnabled: false,
  discountKind: "percent",
  discountAmount: "10",

  ctaLabel: "Preorder",
  ctaPlacement: "replace",
  cartMode: "split",
  mixedCartWarning: "Your cart includes preorder items that will ship later.",
  confirmationEmail: true,
  restockAlert: true,
  balanceReminder: "7_days_before",
  alertChannel: "email",

  orderTags: ["preorder"],
  dunningSteps: [
    { id: "d1", channel: "email", offsetDays: 1, label: "First retry" },
    { id: "d2", channel: "email", offsetDays: 3, label: "Second retry" },
    { id: "d3", channel: "sms", offsetDays: 5, label: "Final reminder" },
  ],
  webhookUrl: "",
  // NOTE: renaming this namespace requires a data migration of existing metafields — do not change casually.
  metafieldNamespace: "preorder_novafied",
};

/**
 * INHERIT STORE DEFAULTS (F0.4 / audit A4).
 *
 * Settings is the single place a merchant configures payment, cart, button, delivery
 * copy and order tagging. Every NEW rule is seeded from those values here, and each
 * group is overridable per rule ("Override for this preorder"). That kills the
 * store-vs-rule duplication the merchant complained about.
 *
 * SCOPE (deliberate, see PHASE-F0-AUDIT.md "F0.4 decision"): inheritance happens at
 * CREATE time — the rule is written with the store's values. Changing a Setting does
 * NOT retroactively rewrite rules that are already live; that would need nullable
 * override columns + resolver fallback across the deposit/selling-plan money path,
 * which we are not doing days before submission. Editing a rule shows its own values.
 *
 * Pure function (no `.server` import) so the loader and the component can both use it.
 */
export function campaignDefaultsFromSettings(
  general: Record<string, unknown>,
): CampaignFormValues {
  const str = (k: string, d: string): string =>
    typeof general[k] === "string" && (general[k] as string).trim()
      ? (general[k] as string)
      : d;
  const one = <T extends string>(k: string, allowed: readonly T[], d: T): T =>
    allowed.includes(general[k] as T) ? (general[k] as T) : d;

  return {
    ...CAMPAIGN_FORM_DEFAULTS,
    paymentMode: one(
      "defaultPaymentMode",
      ["pay_now", "deposit", "pay_later"] as const,
      CAMPAIGN_FORM_DEFAULTS.paymentMode,
    ),
    depositAmount: str("defaultDepositPct", CAMPAIGN_FORM_DEFAULTS.depositAmount),
    balanceCaptureDays: str(
      "balanceChargeDays",
      CAMPAIGN_FORM_DEFAULTS.balanceCaptureDays,
    ),
    deliveryNote: str("defaultDeliveryNote", CAMPAIGN_FORM_DEFAULTS.deliveryNote),
    ctaLabel: str("defaultButtonLabel", CAMPAIGN_FORM_DEFAULTS.ctaLabel),
    ctaPlacement: one(
      "ctaPlacement",
      ["replace", "beside", "stack"] as const,
      CAMPAIGN_FORM_DEFAULTS.ctaPlacement,
    ),
    // Settings stores "show a mixed-cart warning?" as a boolean + its message.
    cartMode: general.mixedCartWarning === true ? "warning" : "split",
    mixedCartWarning: str(
      "mixedCartMessage",
      CAMPAIGN_FORM_DEFAULTS.mixedCartWarning,
    ),
    orderTags: [str("orderTagName", "preorder")],
  };
}

const AVAIL_OPTIONS: { label: string; value: VariantAvailabilityUI }[] = [
  { label: "Available now", value: "now" },
  { label: "Available from start date", value: "from_start" },
  { label: "Available now & until end date", value: "now_until_end" },
  { label: "Available between start & end date", value: "between" },
  { label: "Not available", value: "not_available" },
];

// ---------- Section helper ----------
function SectionCard({
  title,
  helpText,
  children,
}: {
  title: string;
  helpText?: string;
  children: React.ReactNode;
}) {
  return (
    <s-section>
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-200">
          <s-heading>
            {title}
          </s-heading>
          {helpText && (
            <s-paragraph fontSize="small" color="subdued">
              {helpText}
            </s-paragraph>
          )}
        </s-stack>
        <s-divider />
        {children}
      </s-stack>
    </s-section>
  );
}

function ScopeCard({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <s-clickable
      onClick={onClick}
      padding="base"
      border="base"
      borderColor={active ? "strong" : "base"}
      borderRadius="base"
      background={active ? "subdued" : "transparent"}
    >
      <s-stack direction="block" gap="small-200">
        <s-heading fontSize="small">{title}</s-heading>
        <s-text fontSize="small" color="subdued">
          {desc}
        </s-text>
      </s-stack>
    </s-clickable>
  );
}

// ---------- Props ----------
export type CampaignFormProps = {
  mode: "create" | "edit";
  initialValues: CampaignFormValues;
  pageTitle: string;
  pageSubtitle: string;
  backTo: string;
  /** Real store data from the loader. When absent (or null on fetch failure),
   *  the form falls back to demo data so it still renders in isolation. */
  collections?: { id: string; title: string; count: number }[] | null;
  marketsList?: { id: string; title: string; subtitle: string }[] | null;
};

// ---------- Component ----------
export default function CampaignForm({
  mode,
  initialValues,
  pageTitle,
  pageSubtitle,
  backTo,
  collections,
  marketsList,
  currency = "USD",
}: CampaignFormProps & { currency?: string }) {
  // Real catalog data from the loader; empty stores get an honest empty picker.
  const collectionChoices = collections ?? [];
  const marketChoices = marketsList ?? [];
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const link = useLinkProps();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmitting =
    navigation.state === "submitting" || navigation.state === "loading";

  // ---------- Required ----------
  const [name, setName] = useState(initialValues.name);
  const [selectedVariants, setSelectedVariants] = useState<SelectedVariant[]>(
    initialValues.selectedVariants,
  );
  const [shipDate, setShipDate] = useState(initialValues.shipDate);

  // ---------- Product scope ----------
  const [productMode, setProductMode] = useState(initialValues.productMode);
  const [collectionId, setCollectionId] = useState(initialValues.collectionId);

  // ---------- Markets ----------
  const [marketScope, setMarketScope] = useState<"all" | "specific">(
    initialValues.markets.length > 0 ? "specific" : "all",
  );
  const [markets, setMarkets] = useState<string[]>(initialValues.markets);
  const marketsAll = marketScope === "all" || markets.length === 0;

  // ---------- Payment ----------
  const [paymentMode, setPaymentMode] = useState(initialValues.paymentMode);
  const [depositKind, setDepositKind] = useState(initialValues.depositKind);
  const [depositAmount, setDepositAmount] = useState(initialValues.depositAmount);
  const [balanceCaptureDays, setBalanceCaptureDays] = useState(
    initialValues.balanceCaptureDays,
  );
  const [customizePayment, setCustomizePayment] = useState(
    initialValues.paymentMode !== "pay_now",
  );

  // ---------- Advanced (per-drop only) ----------
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [internalNotes, setInternalNotes] = useState(initialValues.internalNotes);
  const [cohortName, setCohortName] = useState(initialValues.cohortName);
  const [deliveryNote, setDeliveryNote] = useState(initialValues.deliveryNote);
  const [discountEnabled, setDiscountEnabled] = useState(initialValues.discountEnabled);
  const [discountKind, setDiscountKind] = useState(initialValues.discountKind);
  const [discountAmount, setDiscountAmount] = useState(initialValues.discountAmount);

  // ---------- Button (inherited from Settings; override per rule — F0.4) ----------
  const [ctaLabel, setCtaLabel] = useState(initialValues.ctaLabel);
  const [ctaPlacement, setCtaPlacement] = useState(initialValues.ctaPlacement);

  // ---------- Trigger (R0.1 — when shoppers see the preorder) ----------
  // Seeded from the saved campaign; "date" campaigns keep their DATE trigger
  // (timing lives in startDate) and present as "always" here.
  const initialTrigger = String(
    (initialValues as unknown as { triggerType?: string }).triggerType ?? "manual",
  );
  const [trigger, setTrigger] = useState<"always" | "stock">(
    initialTrigger === "stock" ? "stock" : "always",
  );

  // ---------- Product picker (App Bridge resourcePicker — real store catalog) ----------
  // Opens Shopify's native product picker so the merchant selects THEIR products
  // and variants (not demo data). Each selected product returns its selected
  // variants; whole-product selection returns all variants. Per-variant config
  // (units offered, availability window) is preserved for variants already chosen.
  const openPicker = async () => {
    const shopify = (
      window as unknown as {
        shopify?: { resourcePicker?: (o: unknown) => Promise<unknown> };
      }
    ).shopify;
    if (!shopify?.resourcePicker) return;
    const selection = (await shopify.resourcePicker({
      type: "product",
      multiple: true,
      selectionIds: Array.from(
        new Map(
          selectedVariants.map((v) => [v.productId, { id: v.productId }]),
        ).values(),
      ),
    })) as
      | { id: string; title: string; variants?: { id: string; title?: string }[] }[]
      | undefined;
    if (!selection) return;
    const existingById = new Map(selectedVariants.map((s) => [s.variantId, s]));
    const next: SelectedVariant[] = [];
    for (const p of selection) {
      for (const v of p.variants ?? []) {
        const existing = existingById.get(v.id);
        next.push(
          existing ?? {
            productId: p.id,
            variantId: v.id,
            productTitle: p.title,
            variantTitle: v.title ?? "",
            unitsOffered: "100",
            endQty: "",
            availability: "now",
            availStart: "",
            availEnd: "",
          },
        );
      }
    }
    setSelectedVariants(next);
  };

  const updateVariant = (
    variantId: string,
    patch: Partial<SelectedVariant>,
  ) =>
    setSelectedVariants((prev) =>
      prev.map((sv) => (sv.variantId === variantId ? { ...sv, ...patch } : sv)),
    );

  const removeVariant = (variantId: string) =>
    setSelectedVariants((prev) => prev.filter((sv) => sv.variantId !== variantId));

  // ---------- DB-enum mapping ----------
  const dbPaymentMode = (
    { pay_now: "PAY_NOW", deposit: "DEPOSIT", pay_later: "PAY_LATER" } as const
  )[paymentMode];
  const dbDepositKind = ({ percent: "PERCENT", fixed: "FIXED" } as const)[depositKind];
  const dbDiscountKind = ({ percent: "PERCENT", fixed: "FIXED" } as const)[discountKind];
  const dbProductMode = (
    { specific: "SPECIFIC", collection: "COLLECTION", all: "ALL" } as const
  )[productMode];
  const dbBalanceReminder = (
    {
      "7_days_before": "7_DAYS_BEFORE",
      "3_days_before": "3_DAYS_BEFORE",
      on_ship: "ON_SHIP",
      off: "OFF",
    } as const
  )[initialValues.balanceReminder];

  // ---------- Submission ----------
  const totalUnits = selectedVariants.reduce(
    (a, v) => a + (Number(v.unitsOffered) || 0),
    0,
  );
  const uniqueProductIds = Array.from(
    new Set(selectedVariants.map((v) => v.productId)),
  );

  const buildFormData = (intent: "publish" | "draft" | "save" | "delete") => {
    const fd = new FormData();
    fd.set("intent", intent);
    if (intent === "delete") return fd;

    fd.set("name", name);
    fd.set("locale", locale); // for locale-aware auto cohort naming
    fd.set("internalNotes", internalNotes);
    fd.set("productMode", dbProductMode);
    fd.set("collectionId", collectionId);
    fd.set("productIds", JSON.stringify(uniqueProductIds));
    fd.set(
      "variantConfigs",
      JSON.stringify(
        selectedVariants.map((sv) => ({
          productId: sv.productId,
          variantId: sv.variantId,
          productTitle: sv.productTitle,
          variantTitle: sv.variantTitle,
          unitsOffered: Number(sv.unitsOffered) || 0,
          endQty: sv.endQty ? Number(sv.endQty) : undefined,
          availability: sv.availability,
          availStart: sv.availStart || undefined,
          availEnd: sv.availEnd || undefined,
        })),
      ),
    );

    // Markets — [] = all.
    fd.set("markets", JSON.stringify(marketsAll ? [] : markets));

    // R0.1 — the trigger is a real, per-campaign setting (previously this
    // hardcoded MANUAL and silently downgraded STOCK campaigns on every edit).
    fd.set(
      "triggerType",
      trigger === "stock"
        ? "STOCK"
        : initialTrigger === "date"
          ? "DATE"
          : "MANUAL",
    );
    fd.set("stockThreshold", "0");

    fd.set("shipDate", shipDate);
    fd.set("cohortName", cohortName);
    fd.set("autoNotifyShipChange", "on");

    fd.set("paymentMode", dbPaymentMode);
    fd.set("depositKind", dbDepositKind);
    fd.set("depositAmount", depositAmount);
    fd.set("balanceCaptureDays", balanceCaptureDays);
    fd.set("moqEnabled", "");

    fd.set("discountEnabled", discountEnabled ? "on" : "");
    fd.set("discountKind", dbDiscountKind);
    fd.set("discountAmount", discountAmount);
    fd.set("stackWithShopifyDiscounts", "");
    fd.set("deliveryNote", deliveryNote);

    // Inherited from Settings unless this rule overrode them (F0.4 / A4). These come
    // from `initialValues`, which the loader seeds via campaignDefaultsFromSettings —
    // so a store that sets its button text / cart mode / order tag once gets it on
    // every new rule, instead of re-typing it here.
    fd.set("ctaLabel", ctaLabel || initialValues.ctaLabel || "Preorder");
    fd.set("ctaPlacement", ctaPlacement.toUpperCase());
    fd.set("cartMode", initialValues.cartMode === "warning" ? "WARNING" : "SPLIT");
    fd.set("mixedCartWarning", initialValues.mixedCartWarning);
    fd.set("allowGuestCheckout", "on");
    fd.set("confirmationEmail", initialValues.confirmationEmail ? "on" : "");
    fd.set("restockAlert", initialValues.restockAlert ? "on" : "");
    fd.set("balanceReminder", dbBalanceReminder);
    fd.set("merchantAlertMoq", "on");
    fd.set("merchantAlertBalanceFail", "on");
    fd.set("merchantAlertCohortReady", "on");
    fd.set("alertChannel", initialValues.alertChannel.toUpperCase());

    fd.set("gateByCustomerTag", "");
    fd.set("customerTags", "[]");
    fd.set("restrictedCountries", "[]");
    fd.set("orderTags", JSON.stringify(initialValues.orderTags));
    fd.set("dunningSteps", JSON.stringify(initialValues.dunningSteps));
    fd.set("webhookUrl", initialValues.webhookUrl);
    fd.set("metafieldNamespace", initialValues.metafieldNamespace);
    return fd;
  };

  const dispatch = (intent: "publish" | "draft" | "save" | "delete") => {
    // Never fail silently: a thrown error here previously made Save/Publish
    // look dead with no feedback. Surface it and report it to the server log.
    try {
      submit(buildFormData(intent), { method: "post" });
    } catch (err) {
      const e = err as { message?: string };
      setDispatchError(e?.message ?? String(err));
    }
  };
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  const productsChosen =
    productMode === "all" ||
    (productMode === "collection" && !!collectionId) ||
    selectedVariants.length > 0;

  const canPublish =
    name.trim().length > 0 && productsChosen && shipDate !== "";

  const handleSaveDraft = () => dispatch("draft");
  const handlePublish = () => dispatch("publish");
  const handleSaveChanges = () => dispatch("save");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const handleDelete = () => setConfirmDeleteOpen(true);

  const primaryAction =
    mode === "create"
      ? {
          content: t("Publish preorder"),
          onAction: handlePublish,
          loading: isSubmitting,
          disabled: !canPublish,
        }
      : {
          content: t("Save changes"),
          onAction: handleSaveChanges,
          loading: isSubmitting,
        };

  const secondaryActions =
    mode === "create"
      ? [
          { content: t("Save draft"), onAction: handleSaveDraft },
          { content: t("Cancel"), onAction: () => navigate(backTo) },
        ]
      : [
          { content: t("Cancel"), onAction: () => navigate(backTo) },
          { content: t("Delete"), destructive: true, onAction: handleDelete },
        ];

  return (
    <s-page inlineSize="large">
      <s-button slot="breadcrumb-actions" icon="arrow-left" accessibilityLabel={t("Preorders")} {...link(backTo)} />
      <s-stack direction="block" gap="large">
        <PageHero
          icon={mode === "create" ? PlusIcon : EditIcon}
          tone={mode === "create" ? "violet" : "sky"}
          title={pageTitle}
          sub={pageSubtitle}
          actions={
            <>
              {secondaryActions.map((a) => (
                <s-button
                  key={a.content}
                  tone={(a as { destructive?: boolean }).destructive ? "critical" : "auto"}
                  onClick={a.onAction}
                >
                  {a.content}
                </s-button>
              ))}
              <s-button
                variant="primary"
                onClick={primaryAction.onAction}
                loading={flag(primaryAction.loading)}
                disabled={flag((primaryAction as { disabled?: boolean }).disabled)}
              >
                {primaryAction.content}
              </s-button>
            </>
          }
        />
        {dispatchError && (
          <s-banner
            tone="critical"
            heading={t("Something went wrong while saving")}
            dismissible onDismiss={() => setDispatchError(null)}
          >
            <s-paragraph>{dispatchError}</s-paragraph>
          </s-banner>
        )}
        <div className="encore-layout">
          {/* ----- Left column ----- */}
          <div>
            <s-stack direction="block" gap="large">
              {mode === "create" && (
                <s-banner tone="info">
                  <s-text>{t("Three quick steps: name it, pick a ship date, and choose products below. Customers pay in full by default — open \"Customize payment\" for deposits or pay-later.")}</s-text>
                </s-banner>
              )}

              <SectionCard
                title={t("Preorder name")}
                helpText={t("A short label only your team sees.")}
              >
                <s-text-field
                  label={t("Name")}
                  labelAccessibilityVisibility="exclusive"
                  value={name}
                  onInput={(e) => setName(val(e))}
                  placeholder={t("e.g. Aurora Hoodie — June drop")}
                  required
                />
              </SectionCard>

              <SectionCard
                title={t("When will it ship?")}
                helpText={t("Shown to customers and used to group orders into a fulfillment cohort.")}
              >
                <s-stack direction="block" gap="base">
                  <s-date-field
                    label={t("Expected ship date")}
                    value={shipDate}
                    onChange={(e) => setShipDate(val(e))}
                    required
                  />
                </s-stack>
              </SectionCard>

              {/* Payment */}
              <s-section>
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                    <s-stack direction="block" gap="small-300">
                      <s-heading>{t("Payment")}</s-heading>
                      <s-paragraph fontSize="small" color="subdued">
                        {(() => {
                          // When not overridden, describe the STORE DEFAULT this rule
                          // inherits from Settings (F0.4) — not a hardcoded "pay now".
                          const mode = customizePayment ? paymentMode : initialValues.paymentMode;
                          const dep = customizePayment ? depositAmount : initialValues.depositAmount;
                          const kind = customizePayment ? depositKind : initialValues.depositKind;
                          const days = customizePayment
                            ? balanceCaptureDays
                            : initialValues.balanceCaptureDays;
                          const desc =
                            mode === "deposit"
                              ? `Deposit ${dep}${kind === "percent" ? "%" : ""} at checkout, balance ${days} days before ship.`
                              : mode === "pay_later"
                                ? t("Card vaulted at checkout, charged when the cohort ships.")
                                : t("Customer pays in full at checkout.");
                          return customizePayment
                            ? desc
                            : `${desc} ${t("(from Settings)")}`;
                        })()}
                      </s-paragraph>
                    </s-stack>
                    <s-checkbox
                      label={t("Override for this preorder")}
                      checked={flag(customizePayment)}
                      onChange={(e) => {
                        const on = isChecked(e);
                        setCustomizePayment(on);
                        // Un-checking returns this rule to the store default from
                        // Settings (F0.4) rather than a hardcoded "pay now".
                        if (!on) {
                          setPaymentMode(initialValues.paymentMode);
                          setDepositKind(initialValues.depositKind);
                          setDepositAmount(initialValues.depositAmount);
                          setBalanceCaptureDays(initialValues.balanceCaptureDays);
                        }
                      }}
                    />
                  </s-stack>
                  {customizePayment && (
                  <div id="payment">
                    <s-stack direction="block" gap="base">
                      <s-divider />
                      <SelectField
                        label={t("Customer pays")}
                        options={[
                          { label: t("Full at checkout (default)"), value: "pay_now" },
                          { label: t("Deposit + balance before ship"), value: "deposit" },
                          { label: t("Pay later (vault card, charge on ship)"), value: "pay_later" },
                        ]}
                        value={paymentMode}
                        onChange={(v) =>
                          setPaymentMode(v as "pay_now" | "deposit" | "pay_later")
                        }
                      />
                      {paymentMode === "deposit" && (
                        <s-box padding="base" background="subdued" borderRadius="base">
                          <s-stack direction="block" gap="base">
                            <s-grid gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap="base">
                              <SelectField
                                label={t("Deposit type")}
                                options={[
                                  { label: t("Percentage"), value: "percent" },
                                  { label: t("Fixed amount"), value: "fixed" },
                                ]}
                                value={depositKind}
                                onChange={(v) => setDepositKind(v as "percent" | "fixed")}
                              />
                              <s-number-field
                                label={t("Deposit amount")}
                                value={depositAmount}
                                onInput={(e) => setDepositAmount(val(e))}
                                suffix={depositKind === "percent" ? "%" : currency}
                              />
                            </s-grid>
                            <s-number-field
                              label={t("Balance capture timing")}
                              value={balanceCaptureDays}
                              onInput={(e) => setBalanceCaptureDays(val(e))}
                              suffix={t("days before ship date")}
                            />
                          </s-stack>
                        </s-box>
                      )}
                      {paymentMode === "pay_later" && (
                        <s-banner tone="info">
                          <s-text>{t("No money moves until you mark the cohort ready to ship. Card vaulted via Shopify Payments.")}</s-text>
                        </s-banner>
                      )}
                    </s-stack>
                  </div>
                  )}
                </s-stack>
              </s-section>

              {/* Advanced (per-drop) */}
              <s-section>
                <s-stack direction="block" gap="base">
                  <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                    <s-stack direction="block" gap="small-300">
                      <s-stack direction="inline" gap="small-100" alignItems="center">
                        <s-heading>{t("Advanced")}</s-heading>
                        <s-icon type="info" color="subdued" interestFor="advanced-tip" />
                        <s-tooltip id="advanced-tip">{t("Optional, per this drop. Store-wide options live in Settings.")}</s-tooltip>
                      </s-stack>
                      <s-paragraph fontSize="small" color="subdued">{t("Discount, delivery note, cohort name, internal notes.")}</s-paragraph>
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
                  <div id="advanced">
                    <s-stack direction="block" gap="large">
                      <s-divider />
                      <s-stack direction="block" gap="small-100">
                        <s-heading fontSize="small">{t("Discount")}</s-heading>
                        <s-checkbox
                          label={t("Offer a discount on preorder")}
                          checked={flag(discountEnabled)}
                          onChange={(e) => setDiscountEnabled(isChecked(e))}
                        />
                        {discountEnabled && (
                          <s-box paddingInlineStart="large-100">
                            <s-stack direction="block" gap="base">
                              <s-grid gridTemplateColumns="repeat(2, minmax(0, 1fr))" gap="base">
                                <SelectField
                                  label={t("Discount type")}
                                  options={[
                                    { label: t("Percentage"), value: "percent" },
                                    { label: t("Fixed amount"), value: "fixed" },
                                  ]}
                                  value={discountKind}
                                  onChange={(v) => setDiscountKind(v as "percent" | "fixed")}
                                />
                                <s-number-field
                                  label={t("Amount")}
                                  value={discountAmount}
                                  onInput={(e) => setDiscountAmount(val(e))}
                                  suffix={discountKind === "percent" ? "%" : currency}
                                />
                              </s-grid>
                            </s-stack>
                          </s-box>
                        )}
                      </s-stack>
                      <s-divider />
                      <s-stack direction="block" gap="small-100">
                        <s-heading fontSize="small">{t("Button")}</s-heading>
                        <s-paragraph fontSize="small" color="subdued">
                          {t("Inherited from Settings. Change it here to override just this preorder.")}
                        </s-paragraph>
                        <s-stack direction="block" gap="base">
                          <s-text-field
                            label={t("Button text")}
                            value={ctaLabel}
                            onInput={(e) => setCtaLabel(val(e))}
                          />
                          <SelectField
                            label={t("Where it appears")}
                            options={[
                              { label: t("Instead of Add to cart"), value: "replace" },
                              { label: t("Next to Add to cart"), value: "beside" },
                              { label: t("Below Add to cart"), value: "stack" },
                            ]}
                            value={ctaPlacement}
                            onChange={(v) =>
                              setCtaPlacement(v as "replace" | "beside" | "stack")
                            }
                          />
                          <SelectField
                            label={t("When shoppers see it")}
                            options={[
                              { label: t("Always (presale — even while in stock)"), value: "always" },
                              { label: t("Only when sold out"), value: "stock" },
                            ]}
                            value={trigger}
                            onChange={(v) => setTrigger(v as "always" | "stock")}
                            details={t("Only when sold out: the preorder button appears once the selected variant runs out.")}
                          />
                        </s-stack>
                      </s-stack>
                      <s-divider />
                      <s-stack direction="block" gap="small-100">
                        <s-heading fontSize="small">{t("Copy & reporting")}</s-heading>
                        <s-stack direction="block" gap="base">
                          <s-text-area
                            label={t("Delivery note (under the button)")}
                            value={deliveryNote}
                            onInput={(e) => setDeliveryNote(val(e))} rows={2}
                            details={t("Inherited from Settings; change it to override just this preorder. Use {{shipping_date}} to insert the ship date.")}
                          />
                          <s-text-field
                            label={t("Cohort name")}
                            value={cohortName}
                            onInput={(e) => setCohortName(val(e))}
                            placeholder={t("Auto-generated")}
                            details={t("Admin reporting only.")}
                          />
                        </s-stack>
                      </s-stack>
                      <s-divider />
                      <s-stack direction="block" gap="small-100">
                        <s-heading fontSize="small">{t("Internal notes")}</s-heading>
                        <s-text-area
                          label={t("Notes")}
                          labelAccessibilityVisibility="exclusive"
                          value={internalNotes}
                          onInput={(e) => setInternalNotes(val(e))} rows={3}
                          placeholder={t("Ops handoff, forecasting context, etc.")}
                        />
                      </s-stack>
                    </s-stack>
                  </div>
                  )}
                </s-stack>
              </s-section>
            </s-stack>
          </div>

          {/* ----- Right column ----- */}
          <div>
            <s-stack direction="block" gap="base">
              {/* Storefront preview */}
              <s-section>
                <s-stack direction="block" gap="small">
                  <SectionHead icon={ViewIcon} tone="teal" title={t("Storefront preview")} sub={t("How the buy box will look on your product page.")} />
                  <s-divider />
                  <s-box padding="base" border="base" borderRadius="base" background="base">
                    <s-stack direction="block" gap="small-100">
                      <div><s-badge tone="warning">{t("Preorder")}</s-badge></div>
                      <s-text fontWeight="semibold">
                        {selectedVariants[0]
                          ? `${selectedVariants[0].productTitle}${selectedVariants[0].variantTitle && selectedVariants[0].variantTitle !== "Default Title" ? ` — ${selectedVariants[0].variantTitle}` : ""}`
                          : t("Your product")}
                      </s-text>
                      {selectedVariants.length > 1 && (
                        <s-text fontSize="small" color="subdued">
                          {`+${selectedVariants.length - 1} ${t("more variants")}`}
                        </s-text>
                      )}
                      <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        style={{ background: "var(--p-color-bg-inverse)", color: "var(--p-color-text-inverse)", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 600, width: "100%", cursor: "default" }}
                      >
                        {ctaLabel || t("Preorder")}
                      </button>
                      <s-text fontSize="small" color="subdued">
                        {shipDate
                          ? deliveryNote.replace(/\{\{\s*shipping_date\s*\}\}/g, shipDate)
                          : deliveryNote.replace(/\{\{\s*shipping_date\s*\}\}/g, "soon")}
                      </s-text>
                      {paymentMode !== "pay_now" && (
                        <s-text fontSize="small" color="subdued">
                          {paymentMode === "deposit"
                            ? `Deposit ${depositAmount}${depositKind === "percent" ? "%" : ` ${currency}`} today`
                            : "Pay later — charged when it ships"}
                        </s-text>
                      )}
                    </s-stack>
                  </s-box>
                </s-stack>
              </s-section>

              {/* Markets */}
              <s-section>
                <s-stack direction="block" gap="small">
                  <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                    <s-heading>{t("Markets")}</s-heading>
                    <s-badge tone={badgeTone(marketsAll ? undefined : "info")}>
                      {marketsAll ? "All markets" : `${markets.length} selected`}
                    </s-badge>
                  </s-stack>
                  <s-paragraph fontSize="small" color="subdued">{t("Where this preorder is offered. Defaults to all markets.")}</s-paragraph>
                  <s-divider />
                  <ChoiceListField
                    label={t("Market availability")}
                    labelHidden
                    choices={[
                      { label: t("All markets"), value: "all" },
                      { label: t("Specific markets"), value: "specific" },
                    ]}
                    selected={[marketScope]}
                    onChange={(v) => setMarketScope(v[0] as "all" | "specific")}
                  />
                  {marketScope === "specific" && (
                    <s-box paddingInlineStart="small-100">
                      <s-stack direction="block" gap="small-200">
                        {marketChoices.length === 0 && (
                          <s-paragraph fontSize="small" color="subdued">
                            {t("No markets found.")}
                          </s-paragraph>
                        )}
                        {marketChoices.map((m) => (
                          <s-checkbox
                            key={m.id}
                            label={m.title}
                            details={m.subtitle}
                            checked={flag(markets.includes(m.id))}
                            onChange={(e) =>
                              setMarkets((prev) =>
                                isChecked(e)
                                  ? [...prev, m.id]
                                  : prev.filter((x) => x !== m.id),
                              )
                            }
                          />
                        ))}
                      </s-stack>
                    </s-box>
                  )}
                </s-stack>
              </s-section>

              {/* Summary */}
              <s-section>
                <s-stack direction="block" gap="small">
                  <s-heading>{t("Summary")}</s-heading>
                  <s-divider />
                  <SummaryRow
                    label={t("Scope")}
                    value={
                      productMode === "all"
                        ? "All products"
                        : productMode === "collection"
                          ? "A collection"
                          : `${selectedVariants.length} variant${selectedVariants.length === 1 ? "" : "s"}`
                    }
                  />
                  <SummaryRow
                    label={t("Total units")}
                    value={totalUnits.toLocaleString()}
                  />
                  <SummaryRow label={t("Markets")} value={marketsAll ? "All" : `${markets.length}`} />
                  <SummaryRow label={t("Ships")} value={shipDate || "Not set"} />
                  <SummaryRow
                    label={t("Customer pays")}
                    value={
                      paymentMode === "pay_now"
                        ? "Full at checkout"
                        : paymentMode === "deposit"
                          ? `Deposit ${depositAmount}${depositKind === "percent" ? "%" : ` ${currency}`}`
                          : "Pay later (on ship)"
                    }
                  />
                </s-stack>
              </s-section>

              {/* Checklist */}
              <s-section>
                <s-stack direction="block" gap="small-100">
                  <s-heading>{t("Ready to publish?")}</s-heading>
                  <ChecklistItem ok={!!name} label={t("Name set")} />
                  <ChecklistItem ok={productsChosen} label={t("Products chosen")} />
                  <ChecklistItem ok={!!shipDate} label={t("Ship date set")} />
                </s-stack>
              </s-section>
            </s-stack>
          </div>
        </div>

        {/* ----- Full-width: Select product ----- */}
        <s-section padding="none">
          <s-box padding="base">
            <s-stack direction="block" gap="small-200">
              <s-heading>{t("Select product")}</s-heading>
              <s-paragraph fontSize="small" color="subdued">{t("Choose which products sell as preorders, set unit limits, and (optionally) schedule when each is available.")}</s-paragraph>
            </s-stack>
          </s-box>
          <s-box padding="base" paddingBlockStart="none">
            <s-stack direction="inline" gap="small">
              <ScopeCard
                active={productMode === "specific"}
                title={t("Specific products")}
                desc="Enable preorders for selected individual products only."
                onClick={() => setProductMode("specific")}
              />
              <ScopeCard
                active={productMode === "collection"}
                title={t("Specific collection")}
                desc="Allow preorders for all products within a collection."
                onClick={() => setProductMode("collection")}
              />
              <ScopeCard
                active={productMode === "all"}
                title={t("All products")}
                desc="Enable preorders across your entire catalog."
                onClick={() => setProductMode("all")}
              />
            </s-stack>
          </s-box>

          <s-divider />

          {productMode === "all" ? (
            <s-box padding="base">
              <s-banner tone="info">
                <s-text>{t("Preorders apply to every product, governed by the Inventory rules in Settings.")}</s-text>
              </s-banner>
            </s-box>
          ) : productMode === "collection" ? (
            <s-box padding="base">
              <SelectField
                label={t("Collection")}
                options={[
                  { label: t("Choose a collection…"), value: "" },
                  ...collectionChoices.map((c) => ({
                    label: `${c.title} (${c.count})`,
                    value: c.id,
                  })),
                ]}
                value={collectionId}
                onChange={setCollectionId}
                details={
                  collectionChoices.length === 0
                    ? t("No collections found in your store.")
                    : undefined
                }
              />
            </s-box>
          ) : (
            <s-stack direction="block" gap="none">
              <s-box padding="base">
                <s-stack direction="inline" justifyContent="space-between" alignItems="center">
                  <s-text fontSize="small" color="subdued">{t("Choose which products should use this offer.")}</s-text>
                  <s-button icon="plus" onClick={openPicker}>{t("Add products")}</s-button>
                </s-stack>
              </s-box>
              {selectedVariants.length === 0 ? (
                <s-box padding="large-100" background="subdued">
                  <s-stack direction="block" gap="small-100">
                    <s-paragraph color="subdued">{t("No products selected yet.")}</s-paragraph>
                    <s-button variant="primary" icon="plus" onClick={openPicker}>{t("Add products")}</s-button>
                  </s-stack>
                </s-box>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">{t("Product")}</s-table-header>
                    <s-table-header format="numeric">{t("Units sold")}</s-table-header>
                    <s-table-header>{t("Limit quantity")}</s-table-header>
                    <s-table-header>{t("End quantity")}</s-table-header>
                    <s-table-header>{t("Availability")}</s-table-header>
                    <s-table-header></s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                  {selectedVariants.map((sv) => (
                    <s-table-row key={sv.variantId}>
                      <s-table-cell>
                        <s-stack direction="block" gap="small-300">
                          <s-text fontWeight="semibold">
                            {sv.productTitle}
                          </s-text>
                          <s-text fontSize="small" color="subdued">
                            {sv.variantTitle}
                          </s-text>
                        </s-stack>
                      </s-table-cell>
                      <s-table-cell>
                        <s-text fontSize="small" color="subdued">—</s-text>
                      </s-table-cell>
                      <s-table-cell>
                        <s-box>
                          <s-number-field
                            label={t("Limit quantity")}
                            labelAccessibilityVisibility="exclusive"
                            value={sv.unitsOffered}
                            onInput={(e) => updateVariant(sv.variantId, { unitsOffered: val(e) })}
                            min={0}
                          />
                        </s-box>
                      </s-table-cell>
                      <s-table-cell>
                        <s-box>
                          <s-number-field
                            label={t("End quantity")}
                            labelAccessibilityVisibility="exclusive"
                            value={sv.endQty}
                            onInput={(e) => updateVariant(sv.variantId, { endQty: val(e) })}
                            placeholder="—"
                            min={0}
                          />
                        </s-box>
                      </s-table-cell>
                      <s-table-cell>
                        <s-box>
                          <s-stack direction="block" gap="small-200">
                            <SelectField
                              label={t("Availability")}
                              labelHidden
                              options={AVAIL_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
                              value={sv.availability}
                              onChange={(v) =>
                                updateVariant(sv.variantId, {
                                  availability: v as VariantAvailabilityUI,
                                })
                              }
                            />
                            {(sv.availability === "from_start" ||
                              sv.availability === "between") && (
                              <s-date-field
                                label={t("Start date")}
                                labelAccessibilityVisibility="exclusive"
                                value={sv.availStart}
                                onChange={(e) => updateVariant(sv.variantId, { availStart: val(e) })}
                              />
                            )}
                            {(sv.availability === "now_until_end" ||
                              sv.availability === "between") && (
                              <s-date-field
                                label={t("End date")}
                                labelAccessibilityVisibility="exclusive"
                                value={sv.availEnd}
                                onChange={(e) => updateVariant(sv.variantId, { availEnd: val(e) })}
                              />
                            )}
                          </s-stack>
                        </s-box>
                      </s-table-cell>
                      <s-table-cell>
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          icon="x"
                          accessibilityLabel={t("Remove product")}
                          onClick={() => removeVariant(sv.variantId)}
                        />
                      </s-table-cell>
                    </s-table-row>
                  ))}
                  </s-table-body>
                </s-table>
              )}
            </s-stack>
          )}
        </s-section>

        {/* Footer */}
        <s-section>
          <s-stack direction="inline" justifyContent="end" gap="small-100">
            <s-button onClick={() => navigate(backTo)}>Cancel</s-button>
            {mode === "create" ? (
              <>
                <s-button onClick={handleSaveDraft}>{t("Save draft")}</s-button>
                <s-button
                  variant="primary"
                  onClick={handlePublish}
                  loading={flag(isSubmitting)}
                  disabled={flag(!canPublish)}
                >{t("Publish preorder")}</s-button>
              </>
            ) : (
              <>
                <s-button icon="delete" tone="critical" onClick={handleDelete}>{t("Delete")}</s-button>
                <s-button variant="primary" onClick={handleSaveChanges} loading={flag(isSubmitting)}>{t("Save changes")}</s-button>
              </>
            )}
          </s-stack>
        </s-section>
      </s-stack>
      <ConfirmModal
        open={confirmDeleteOpen}
        title={t("Delete preorder")}
        message={t("Delete this preorder? This cannot be undone. Shopify orders already placed are not affected.")}
        confirmLabel={t("Delete")}
        onConfirm={() => {
          setConfirmDeleteOpen(false);
          dispatch("delete");
        }}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </s-page>
  );
}

// ---------- Sidebar primitives ----------
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <s-stack direction="inline" justifyContent="space-between" alignItems="center">
      <s-text fontSize="small" color="subdued">
        {label}
      </s-text>
      <s-text>
        {value}
      </s-text>
    </s-stack>
  );
}

function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <s-stack direction="inline" gap="small-100" alignItems="center">
      <s-icon type={ok ? "check-circle-filled" : "circle"} tone={ok ? "success" : "neutral"} size="small" />
      <s-text>{label}</s-text>
    </s-stack>
  );
}
