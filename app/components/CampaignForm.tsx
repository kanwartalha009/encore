/**
 * Preorder setup form (create + edit).
 *
 * Layout v3 (2026-09-25) — Shopify product-page pattern:
 *   - Title bar: native s-page heading, breadcrumb, Publish/Save as the primary
 *     action (no custom hero; the admin's own chrome carries the title).
 *   - Main column, in the order a merchant thinks: Products (with thumbnails
 *     and per-variant limits/availability) → Details (name + ship date) →
 *     Payment (three plain choices, store default marked) → More options.
 *   - Sticky sidebar: live storefront buy-box preview, a summary that doubles
 *     as the publish checklist, Markets.
 *
 * Store-wide behaviours (inventory rules, mixed-cart, button text, notification
 * cadence, CSS) live in Settings — not here. Those fields are still serialized
 * with sensible defaults so existing preorders keep working.
 */

import { useState } from "react";
import ConfirmModal from "./ConfirmModal";
import { useLocale } from "../lib/i18n";
import { useNavigate, useNavigation, useSubmit } from "react-router";
import { ProductIcon } from "@shopify/polaris-icons";
import { ProductThumb } from "./ui";
import { prettyDate } from "../lib/format";
import { SelectField, ChoiceListField, flag, isChecked, val, useLinkProps } from "./wc";


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
  /** UI-only thumbnail (picker result or loader lookup); never submitted. */
  image?: string | null;
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

// ---------- Layout helpers ----------
function FormCard({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <s-section>
      <div className="encore-form-card">
        <div className="encore-form-card__head">
          <div className="encore-form-card__titles">
            <h2 className="encore-form-card__title">{title}</h2>
            {sub && <p className="encore-form-card__sub">{sub}</p>}
          </div>
          {action}
        </div>
        {children}
      </div>
    </s-section>
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
  /** productId → thumbnail URL for variants already on the rule (edit). */
  thumbs?: Record<string, string> | null;
};

// ---------- Component ----------
export default function CampaignForm({
  mode,
  initialValues,
  pageTitle,
  backTo,
  collections,
  marketsList,
  thumbs,
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
  const [selectedVariants, setSelectedVariants] = useState<SelectedVariant[]>(() =>
    initialValues.selectedVariants.map((v) => ({ ...v, image: v.image ?? thumbs?.[v.productId] ?? null })),
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
      | {
          id: string;
          title: string;
          images?: { originalSrc?: string; url?: string }[];
          variants?: { id: string; title?: string }[];
        }[]
      | undefined;
    if (!selection) return;
    const existingById = new Map(selectedVariants.map((s) => [s.variantId, s]));
    const next: SelectedVariant[] = [];
    for (const p of selection) {
      const image = p.images?.[0]?.originalSrc ?? p.images?.[0]?.url ?? null;
      for (const v of p.variants ?? []) {
        const existing = existingById.get(v.id);
        next.push(
          existing ? { ...existing, image: existing.image ?? image } : {
            productId: p.id,
            variantId: v.id,
            productTitle: p.title,
            variantTitle: v.title ?? "",
            unitsOffered: "100",
            endQty: "",
            availability: "now",
            availStart: "",
            availEnd: "",
            image,
          },
        );
      }
    }
    setSelectedVariants(next);
    // One less field to fill: name the rule after the first product until the
    // merchant types their own (they can always change it).
    if (!name.trim() && selection[0]?.title) {
      setName(`${selection[0].title} — ${t("Preorder")}`);
    }
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

  // ---------- Derived view values ----------
  const storeDefaultMode = initialValues.paymentMode;
  const PAYMENT_CHOICES: { value: "pay_now" | "deposit" | "pay_later"; label: string; helpText: string }[] = [
    {
      value: "pay_now",
      label: t("Full payment at checkout"),
      helpText: t("Customer pays the full price when they order."),
    },
    {
      value: "deposit",
      label: t("Deposit now, balance before shipping"),
      helpText: t("Take a deposit at checkout; the rest is charged automatically before the ship date."),
    },
    {
      value: "pay_later",
      label: t("Pay later"),
      helpText: t("Card is saved at checkout and charged when the order ships."),
    },
  ];
  const paymentChoices = PAYMENT_CHOICES.map((c) => ({
    ...c,
    label: c.value === storeDefaultMode ? `${c.label} · ${t("store default")}` : c.label,
  }));
  const paySummary =
    paymentMode === "pay_now"
      ? t("Full at checkout")
      : paymentMode === "deposit"
        ? `${t("Deposit")} ${depositAmount}${depositKind === "percent" ? "%" : ` ${currency}`}`
        : t("Pay later (on ship)");
  const productsSummary =
    productMode === "all"
      ? t("All products")
      : productMode === "collection"
        ? collectionId
          ? (collectionChoices.find((c) => c.id === collectionId)?.title ?? t("A collection"))
          : ""
        : selectedVariants.length > 0
          ? `${uniqueProductIds.length} ${uniqueProductIds.length === 1 ? t("product") : t("products")} · ${selectedVariants.length} ${selectedVariants.length === 1 ? t("variant") : t("variants")}`
          : "";
  const stepsLeft = [productsChosen, !!shipDate, name.trim().length > 0].filter((x) => !x).length;
  const first = selectedVariants[0];
  const shipPretty = shipDate ? prettyDate(shipDate, locale) : "";
  const previewNote = deliveryNote.replace(/\{\{\s*shipping_date\s*\}\}/g, shipPretty || t("soon"));
  const SCOPES: { value: "specific" | "collection" | "all"; label: string; desc: string }[] = [
    { value: "specific", label: t("Specific products"), desc: t("Only the products and variants you pick.") },
    { value: "collection", label: t("Collection"), desc: t("Every product in one collection.") },
    { value: "all", label: t("All products"), desc: t("Your whole catalog, governed by the inventory rules in Settings.") },
  ];

  const primaryButton =
    mode === "create" ? (
      <s-button variant="primary" onClick={handlePublish} loading={flag(isSubmitting)} disabled={flag(!canPublish)}>
        {t("Publish preorder")}
      </s-button>
    ) : (
      <s-button variant="primary" onClick={handleSaveChanges} loading={flag(isSubmitting)}>
        {t("Save changes")}
      </s-button>
    );

  return (
    <s-page heading={pageTitle} inlineSize="base">
      <s-link slot="breadcrumb-actions" {...link(backTo)}>
        {t("Preorders")}
      </s-link>
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={mode === "create" ? handlePublish : handleSaveChanges}
        loading={flag(isSubmitting)}
        disabled={flag(mode === "create" && !canPublish)}
      >
        {mode === "create" ? t("Publish preorder") : t("Save changes")}
      </s-button>
      {mode === "create" ? (
        <s-button slot="secondary-actions" onClick={handleSaveDraft}>
          {t("Save draft")}
        </s-button>
      ) : (
        <s-button slot="secondary-actions" tone="critical" onClick={handleDelete}>
          {t("Delete")}
        </s-button>
      )}

      <div className="encore-stack">
        {dispatchError && (
          <s-banner
            tone="critical"
            heading={t("Something went wrong while saving")}
            dismissible
            onDismiss={() => setDispatchError(null)}
          >
            <s-paragraph>{dispatchError}</s-paragraph>
          </s-banner>
        )}

        <div className="encore-layout encore-layout--form">
          {/* ================= Main column ================= */}
          <div className="encore-stack">
            {/* ---- Products ---- */}
            <FormCard
              title={t("Products")}
              sub={t("What customers can preorder.")}
              action={
                productMode === "specific" && selectedVariants.length > 0 ? (
                  <s-button icon="plus" onClick={openPicker}>
                    {t("Add products")}
                  </s-button>
                ) : undefined
              }
            >
              <div className="encore-seg" role="radiogroup" aria-label={t("Products")}>
                {SCOPES.map((sc) => (
                  <button
                    key={sc.value}
                    type="button"
                    role="radio"
                    aria-checked={productMode === sc.value}
                    className={`encore-seg__btn${productMode === sc.value ? " encore-seg__btn--active" : ""}`}
                    onClick={() => setProductMode(sc.value)}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>
              <p className="encore-form-card__hint">{SCOPES.find((sc) => sc.value === productMode)?.desc}</p>

              {productMode === "all" ? null : productMode === "collection" ? (
                <SelectField
                  label={t("Collection")}
                  options={[
                    { label: t("Choose a collection…"), value: "" },
                    ...collectionChoices.map((c) => ({ label: `${c.title} (${c.count})`, value: c.id })),
                  ]}
                  value={collectionId}
                  onChange={setCollectionId}
                  details={collectionChoices.length === 0 ? t("No collections found in your store.") : undefined}
                />
              ) : selectedVariants.length === 0 ? (
                <button type="button" className="encore-dropzone" onClick={openPicker}>
                  <span className="encore-dropzone__icon" aria-hidden="true">
                    <ProductIcon />
                  </span>
                  <span className="encore-dropzone__title">{t("Choose the products to sell on preorder")}</span>
                  <span className="encore-dropzone__sub">{t("Pick whole products or single variants from your catalog.")}</span>
                  <span className="encore-dropzone__cta">{t("Add products")}</span>
                </button>
              ) : (
                <div className="encore-vlist">
                  <div className="encore-vlist__head" aria-hidden="true">
                    <span>{t("Limit quantity")}</span>
                    <span title={t("Stop taking preorders once this many have sold. Leave empty for no cap.")}>
                      {t("End quantity")}
                    </span>
                    <span>{t("Availability")}</span>
                  </div>
                  {selectedVariants.map((sv) => {
                    const variantLabel =
                      sv.variantTitle && sv.variantTitle !== "Default Title" ? sv.variantTitle : t("Default variant");
                    return (
                      <div key={sv.variantId} className="encore-vrow">
                        <div className="encore-vrow__head">
                          <ProductThumb src={sv.image} alt={sv.productTitle} />
                          <div className="encore-vrow__text">
                            <span className="encore-vrow__title">{sv.productTitle}</span>
                            <span className="encore-vrow__sub">{variantLabel}</span>
                          </div>
                          <s-button
                            variant="tertiary"
                            icon="x"
                            accessibilityLabel={`${t("Remove product")}: ${sv.productTitle} ${variantLabel}`}
                            onClick={() => removeVariant(sv.variantId)}
                          />
                        </div>
                        <div className="encore-vrow__fields">
                          <s-number-field
                            label={t("Limit quantity")}
                            labelAccessibilityVisibility="exclusive"
                            value={sv.unitsOffered}
                            onInput={(e) => updateVariant(sv.variantId, { unitsOffered: val(e) })}
                            min={0}
                          />
                          <s-number-field
                            label={t("End quantity")}
                            labelAccessibilityVisibility="exclusive"
                            value={sv.endQty}
                            onInput={(e) => updateVariant(sv.variantId, { endQty: val(e) })}
                            placeholder={t("None")}
                            min={0}
                          />
                          <SelectField
                            label={t("Availability")}
                            labelHidden
                            options={AVAIL_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
                            value={sv.availability}
                            onChange={(v) => updateVariant(sv.variantId, { availability: v as VariantAvailabilityUI })}
                          />
                          {sv.availability !== "now" && sv.availability !== "not_available" && (
                            <div className="encore-vrow__dates">
                          {(sv.availability === "from_start" || sv.availability === "between") && (
                            <s-date-field
                              label={t("Start date")}
                              value={sv.availStart}
                              onChange={(e) => updateVariant(sv.variantId, { availStart: val(e) })}
                            />
                          )}
                          {(sv.availability === "now_until_end" || sv.availability === "between") && (
                            <s-date-field
                              label={t("End date")}
                              value={sv.availEnd}
                              onChange={(e) => updateVariant(sv.variantId, { availEnd: val(e) })}
                            />
                          )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </FormCard>

            {/* ---- Details ---- */}
            <FormCard title={t("Details")}>
              <div className="encore-form-grid">
                <s-text-field
                  label={t("Preorder name")}
                  value={name}
                  onInput={(e) => setName(val(e))}
                  placeholder={t("e.g. Aurora Hoodie — June drop")}
                  details={t("Only your team sees this.")}
                  required
                />
                <s-date-field
                  label={t("Expected ship date")}
                  value={shipDate}
                  onChange={(e) => setShipDate(val(e))}
                  details={t("Shown to customers on the product page and in emails.")}
                  required
                />
              </div>
            </FormCard>

            {/* ---- Payment ---- */}
            <FormCard title={t("Payment")} sub={t("How customers pay for this preorder. The store default comes from Settings.")}>
              <ChoiceListField
                label={t("Customer pays")}
                labelHidden
                choices={paymentChoices}
                selected={[paymentMode]}
                onChange={(v) => setPaymentMode((v[0] ?? storeDefaultMode) as "pay_now" | "deposit" | "pay_later")}
              />
              {paymentMode === "deposit" && (
                <div className="encore-subpanel">
                  <div className="encore-form-grid encore-form-grid--3">
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
                    <s-number-field
                      label={t("Charge balance")}
                      value={balanceCaptureDays}
                      onInput={(e) => setBalanceCaptureDays(val(e))}
                      suffix={t("days before ship")}
                    />
                  </div>
                </div>
              )}
              {paymentMode === "pay_later" && (
                <div className="encore-subpanel">
                  <s-text color="subdued">
                    {t("No money moves until you mark the cohort ready to ship. Card vaulted via Shopify Payments.")}
                  </s-text>
                </div>
              )}
            </FormCard>

            {/* ---- More options (per-drop, collapsed) ---- */}
            <s-section>
              <button
                type="button"
                className="encore-disclosure"
                aria-expanded={advancedOpen}
                aria-controls="advanced"
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                <span className="encore-form-card__titles">
                  <span className="encore-form-card__title">{t("More options")}</span>
                  <span className="encore-form-card__sub">{t("Discount, button text, delivery note, cohort name, internal notes.")}</span>
                </span>
                <s-icon type={advancedOpen ? "chevron-up" : "chevron-down"} />
              </button>

              {advancedOpen && (
                <div id="advanced" className="encore-adv">
                  <div className="encore-adv__group">
                    <h3 className="encore-adv__title">{t("Discount")}</h3>
                    <s-checkbox
                      label={t("Offer a discount on preorder")}
                      checked={flag(discountEnabled)}
                      onChange={(e) => setDiscountEnabled(isChecked(e))}
                    />
                    {discountEnabled && (
                      <div className="encore-form-grid">
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
                      </div>
                    )}
                  </div>

                  <div className="encore-adv__group">
                    <h3 className="encore-adv__title">{t("Button")}</h3>
                    <p className="encore-form-card__sub">{t("Inherited from Settings. Change it here to override just this preorder.")}</p>
                    <div className="encore-form-grid">
                      <s-text-field label={t("Button text")} value={ctaLabel} onInput={(e) => setCtaLabel(val(e))} />
                      <SelectField
                        label={t("Where it appears")}
                        options={[
                          { label: t("Instead of Add to cart"), value: "replace" },
                          { label: t("Next to Add to cart"), value: "beside" },
                          { label: t("Below Add to cart"), value: "stack" },
                        ]}
                        value={ctaPlacement}
                        onChange={(v) => setCtaPlacement(v as "replace" | "beside" | "stack")}
                      />
                    </div>
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
                  </div>

                  <div className="encore-adv__group">
                    <h3 className="encore-adv__title">{t("Copy & reporting")}</h3>
                    <s-text-area
                      label={t("Delivery note (under the button)")}
                      value={deliveryNote}
                      onInput={(e) => setDeliveryNote(val(e))}
                      rows={2}
                      details={t("Inherited from Settings; change it to override just this preorder. Use {{shipping_date}} to insert the ship date.")}
                    />
                    <s-text-field
                      label={t("Cohort name")}
                      value={cohortName}
                      onInput={(e) => setCohortName(val(e))}
                      placeholder={t("Auto-generated")}
                      details={t("Admin reporting only.")}
                    />
                  </div>

                  <div className="encore-adv__group">
                    <h3 className="encore-adv__title">{t("Internal notes")}</h3>
                    <s-text-area
                      label={t("Notes")}
                      labelAccessibilityVisibility="exclusive"
                      value={internalNotes}
                      onInput={(e) => setInternalNotes(val(e))}
                      rows={3}
                      placeholder={t("Ops handoff, forecasting context, etc.")}
                    />
                  </div>
                </div>
              )}
            </s-section>
          </div>

          {/* ================= Sidebar ================= */}
          <div className="encore-stack">
            {/* Summary + publish checklist */}
            <s-section>
              <div className="encore-form-card">
                <div className="encore-form-card__head">
                  <h2 className="encore-form-card__title">{t("Summary")}</h2>
                  {mode === "create" &&
                    (stepsLeft === 0 ? (
                      <s-badge tone="success">{t("Ready to publish")}</s-badge>
                    ) : (
                      <s-badge tone="caution">
                        {stepsLeft === 1 ? t("1 step left") : `${stepsLeft} ${t("steps left")}`}
                      </s-badge>
                    ))}
                </div>
                <div className="encore-checklist">
                  <CheckRow ok={productsChosen} label={t("Products")} value={productsSummary || t("Not chosen")} />
                  <CheckRow ok={!!shipDate} label={t("Ship date")} value={shipPretty || t("Not set")} />
                  <CheckRow ok={name.trim().length > 0} label={t("Name")} value={name.trim() || t("Not set")} />
                </div>
                <div className="encore-kv">
                  <SummaryRow label={t("Customer pays")} value={paySummary} />
                  <SummaryRow label={t("Units offered")} value={productMode === "specific" ? totalUnits.toLocaleString() : "—"} />
                  <SummaryRow label={t("Markets")} value={marketsAll ? t("All markets") : `${markets.length} ${t("selected")}`} />
                </div>
              </div>
            </s-section>

            {/* Storefront preview */}
            <s-section>
              <div className="encore-form-card">
                <div className="encore-form-card__head">
                  <h2 className="encore-form-card__title">{t("Storefront preview")}</h2>
                </div>
                <div className="encore-preview" aria-label={t("How the buy box will look on your product page.")}>
                  <div className="encore-preview__media">
                    {first?.image ? (
                      <img src={first.image} alt="" />
                    ) : (
                      <span className="encore-preview__ph" aria-hidden="true">
                        <ProductIcon />
                      </span>
                    )}
                    <span className="encore-preview__badge">{t("Preorder")}</span>
                  </div>
                  <div className="encore-preview__body">
                    <span className="encore-preview__title">{first ? first.productTitle : t("Your product")}</span>
                    {first && selectedVariants.length > 1 && (
                      <span className="encore-preview__meta">{`+${selectedVariants.length - 1} ${t("more variants")}`}</span>
                    )}
                    <span className="encore-preview__btn">{ctaLabel || t("Preorder")}</span>
                    <span className="encore-preview__note">{previewNote}</span>
                    {paymentMode !== "pay_now" && (
                      <span className="encore-preview__pay">
                        {paymentMode === "deposit"
                          ? `${t("Deposit")} ${depositAmount}${depositKind === "percent" ? "%" : ` ${currency}`} ${t("today")}`
                          : t("Pay later — charged when it ships")}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </s-section>

            {/* Markets */}
            <s-section>
              <div className="encore-form-card">
                <div className="encore-form-card__head">
                  <div className="encore-form-card__titles">
                    <h2 className="encore-form-card__title">{t("Markets")}</h2>
                    <p className="encore-form-card__sub">{t("Where this preorder is offered. Defaults to all markets.")}</p>
                  </div>
                </div>
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
                  <div className="encore-subpanel">
                    {marketChoices.length === 0 && (
                      <s-paragraph color="subdued">{t("No markets found.")}</s-paragraph>
                    )}
                    {marketChoices.map((m) => (
                      <s-checkbox
                        key={m.id}
                        label={m.title}
                        details={m.subtitle}
                        checked={flag(markets.includes(m.id))}
                        onChange={(e) =>
                          setMarkets((prev) => (isChecked(e) ? [...prev, m.id] : prev.filter((x) => x !== m.id)))
                        }
                      />
                    ))}
                  </div>
                )}
              </div>
            </s-section>
          </div>
        </div>

        {/* Bottom action bar — mirrors the title bar for long forms */}
        <div className="encore-actionbar">
          {mode === "edit" ? (
            <s-button tone="critical" onClick={handleDelete}>
              {t("Delete preorder")}
            </s-button>
          ) : (
            <span />
          )}
          <div className="encore-actionbar__right">
            <s-button onClick={() => navigate(backTo)}>{t("Cancel")}</s-button>
            {mode === "create" && <s-button onClick={handleSaveDraft}>{t("Save draft")}</s-button>}
            {primaryButton}
          </div>
        </div>
      </div>
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
    <div className="encore-kv__row">
      <span className="encore-kv__label">{label}</span>
      <span className="encore-kv__value">{value}</span>
    </div>
  );
}

function CheckRow({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className={`encore-check${ok ? " encore-check--ok" : ""}`}>
      <s-icon type={ok ? "check-circle-filled" : "circle"} tone={ok ? "success" : "neutral"} size="small" />
      <span className="encore-check__label">{label}</span>
      <span className="encore-check__value">{value}</span>
    </div>
  );
}
