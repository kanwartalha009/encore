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

import { useMemo, useState } from "react";
import { useLocale } from "../lib/i18n";
import { useNavigate, useNavigation, useSubmit } from "react-router";
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
  ChoiceList,
  Divider,
  Collapsible,
  Banner,
  Icon,
  Tooltip,
  FormLayout,
  Modal,
  ResourceList,
  ResourceItem,
  Filters,
  IndexTable,
} from "@shopify/polaris";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  InfoIcon,
  PlusIcon,
  DeleteIcon,
  XIcon,
} from "@shopify/polaris-icons";

import { DEMO_VARIANT_LIST, DEMO_MARKETS, DEMO_COLLECTIONS } from "../lib/demoProducts";

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

  // Store-wide (moved to Settings; preserved here for serialization).
  ctaLabel: string;
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
  metafieldNamespace: "preorder_novafied",
};

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
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          {helpText && (
            <Text as="p" variant="bodySm" tone="subdued">
              {helpText}
            </Text>
          )}
        </BlockStack>
        <Divider />
        {children}
      </BlockStack>
    </Card>
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
    <button
      type="button"
      onClick={onClick}
      style={{ all: "unset", cursor: "pointer", display: "block", flex: 1, minWidth: 0 }}
    >
      <Box
        padding="400"
        borderWidth={active ? "050" : "025"}
        borderColor={active ? "border-emphasis" : "border"}
        borderRadius="300"
        background={active ? "bg-surface-secondary" : undefined}
      >
        <BlockStack gap="100">
          <Text as="span" variant="headingSm">
            {title}
          </Text>
          <Text as="span" variant="bodySm" tone="subdued">
            {desc}
          </Text>
        </BlockStack>
      </Box>
    </button>
  );
}

// ---------- Props ----------
export type CampaignFormProps = {
  mode: "create" | "edit";
  initialValues: CampaignFormValues;
  pageTitle: string;
  pageSubtitle: string;
  backTo: string;
};

// ---------- Component ----------
export default function CampaignForm({
  mode,
  initialValues,
  pageTitle,
  pageSubtitle,
  backTo,
}: CampaignFormProps) {
  const { t } = useLocale();
  const navigate = useNavigate();
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

  // ---------- Variant picker modal ----------
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerSelected, setPickerSelected] = useState<string[]>([]);

  const visibleVariants = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return DEMO_VARIANT_LIST;
    return DEMO_VARIANT_LIST.filter((v) =>
      `${v.productTitle} ${v.variantTitle} ${v.vendor}`.toLowerCase().includes(q),
    );
  }, [pickerQuery]);

  const openPicker = () => {
    setPickerSelected(selectedVariants.map((sv) => sv.variantId));
    setPickerOpen(true);
  };

  const confirmPicker = () => {
    const existingById = new Map(selectedVariants.map((s) => [s.variantId, s]));
    const next: SelectedVariant[] = pickerSelected.map((variantId) => {
      const existing = existingById.get(variantId);
      if (existing) return existing;
      const v = DEMO_VARIANT_LIST.find((x) => x.variantId === variantId);
      if (!v) return null as never;
      return {
        productId: v.productId,
        variantId: v.variantId,
        productTitle: v.productTitle,
        variantTitle: v.variantTitle,
        unitsOffered: "100",
        endQty: "",
        availability: "now",
        availStart: "",
        availEnd: "",
      };
    });
    setSelectedVariants(next.filter(Boolean));
    setPickerOpen(false);
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

    // Trigger handled by store-wide Inventory rules (Settings).
    fd.set("triggerType", "MANUAL");
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

    // Store-wide defaults (configured in Settings) — preserved on save.
    fd.set("ctaLabel", initialValues.ctaLabel || "Preorder");
    fd.set("ctaPlacement", "REPLACE");
    fd.set("cartMode", initialValues.cartMode === "warning" ? "WARNING" : "SPLIT");
    fd.set("mixedCartWarning", initialValues.mixedCartWarning);
    fd.set("allowGuestCheckout", "on");
    fd.set("confirmationEmail", initialValues.confirmationEmail ? "on" : "");
    fd.set("restockAlert", "on");
    fd.set("balanceReminder", dbBalanceReminder);
    fd.set("merchantAlertMoq", "on");
    fd.set("merchantAlertBalanceFail", "on");
    fd.set("merchantAlertCohortReady", "on");
    fd.set("alertChannel", initialValues.alertChannel.toUpperCase());

    fd.set("gateByCustomerTag", "");
    fd.set("customerTags", "[]");
    fd.set("restrictedCountries", "[]");
    fd.set("orderTags", JSON.stringify(["preorder"]));
    fd.set("dunningSteps", JSON.stringify(initialValues.dunningSteps));
    fd.set("webhookUrl", "");
    fd.set("metafieldNamespace", "preorder_novafied");
    return fd;
  };

  const dispatch = (intent: "publish" | "draft" | "save" | "delete") =>
    submit(buildFormData(intent), { method: "post" });

  const productsChosen =
    productMode === "all" ||
    (productMode === "collection" && !!collectionId) ||
    selectedVariants.length > 0;

  const canPublish =
    name.trim().length > 0 && productsChosen && shipDate !== "";

  const handleSaveDraft = () => dispatch("draft");
  const handlePublish = () => dispatch("publish");
  const handleSaveChanges = () => dispatch("save");
  const handleDelete = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        "Delete this preorder? This cannot be undone. Existing preorders will be cascaded.",
      )
    )
      return;
    dispatch("delete");
  };

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
    <Page
      backAction={{ content: t("Preorders"), url: backTo }}
      title={pageTitle}
      subtitle={pageSubtitle}
      primaryAction={primaryAction}
      secondaryActions={secondaryActions}
    >
      <BlockStack gap="500">
        <Layout>
          {/* ----- Left column ----- */}
          <Layout.Section>
            <BlockStack gap="500">
              {mode === "create" && (
                <Banner tone="info" onDismiss={() => {}}>
                  <Text as="span">{t("Three quick steps: name it, pick a ship date, and choose products below. Customers pay in full by default — open \"Customize payment\" for deposits or pay-later.")}</Text>
                </Banner>
              )}

              <SectionCard
                title={t("Preorder name")}
                helpText={t("A short label only your team sees.")}
              >
                <TextField
                  label={t("Name")}
                  labelHidden
                  value={name}
                  onChange={setName}
                  autoComplete="off"
                  placeholder={t("e.g. Aurora Hoodie — June drop")}
                  requiredIndicator
                />
              </SectionCard>

              <SectionCard
                title={t("When will it ship?")}
                helpText={t("Shown to customers and used to group orders into a fulfillment cohort.")}
              >
                <FormLayout>
                  <TextField
                    label={t("Expected ship date")}
                    type="date"
                    value={shipDate}
                    onChange={setShipDate}
                    autoComplete="off"
                    requiredIndicator
                  />
                </FormLayout>
              </SectionCard>

              {/* Payment */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingMd">{t("Payment")}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {customizePayment
                          ? paymentMode === "deposit"
                            ? `Deposit ${depositAmount}${depositKind === "percent" ? "%" : " USD"} at checkout, balance ${balanceCaptureDays} days before ship.`
                            : paymentMode === "pay_later"
                              ? "Card vaulted at checkout, charged when the cohort ships."
                              : "Customer pays in full at checkout."
                          : "Customer pays in full at checkout."}
                      </Text>
                    </BlockStack>
                    <Checkbox
                      label={t("Customize payment")}
                      checked={customizePayment}
                      onChange={(v) => {
                        setCustomizePayment(v);
                        if (!v) {
                          setPaymentMode("pay_now");
                        }
                      }}
                    />
                  </InlineStack>
                  <Collapsible
                    id="payment"
                    open={customizePayment}
                    transition={{ duration: "200ms", timingFunction: "ease" }}
                  >
                    <BlockStack gap="400">
                      <Divider />
                      <Select
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
                        <Box padding="400" background="bg-surface-secondary" borderRadius="200">
                          <FormLayout>
                            <FormLayout.Group>
                              <Select
                                label={t("Deposit type")}
                                options={[
                                  { label: t("Percentage"), value: "percent" },
                                  { label: t("Fixed amount"), value: "fixed" },
                                ]}
                                value={depositKind}
                                onChange={(v) => setDepositKind(v as "percent" | "fixed")}
                              />
                              <TextField
                                label={t("Deposit amount")}
                                type="number"
                                value={depositAmount}
                                onChange={setDepositAmount}
                                autoComplete="off"
                                suffix={depositKind === "percent" ? "%" : "USD"}
                              />
                            </FormLayout.Group>
                            <TextField
                              label={t("Balance capture timing")}
                              type="number"
                              value={balanceCaptureDays}
                              onChange={setBalanceCaptureDays}
                              autoComplete="off"
                              suffix={t("days before ship date")}
                            />
                          </FormLayout>
                        </Box>
                      )}
                      {paymentMode === "pay_later" && (
                        <Banner tone="info">
                          <Text as="span">{t("No money moves until you mark the cohort ready to ship. Card vaulted via Shopify Payments.")}</Text>
                        </Banner>
                      )}
                    </BlockStack>
                  </Collapsible>
                </BlockStack>
              </Card>

              {/* Advanced (per-drop) */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <BlockStack gap="050">
                      <InlineStack gap="200" blockAlign="center">
                        <Text as="h2" variant="headingMd">{t("Advanced")}</Text>
                        <Tooltip content={t("Optional, per this drop. Store-wide options live in Settings.")}>
                          <Icon source={InfoIcon} tone="subdued" />
                        </Tooltip>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">{t("Discount, delivery note, cohort name, internal notes.")}</Text>
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
                    id="advanced"
                    open={advancedOpen}
                    transition={{ duration: "200ms", timingFunction: "ease" }}
                  >
                    <BlockStack gap="500">
                      <Divider />
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{t("Discount")}</Text>
                        <Checkbox
                          label={t("Offer a discount on preorder")}
                          checked={discountEnabled}
                          onChange={setDiscountEnabled}
                        />
                        {discountEnabled && (
                          <Box paddingInlineStart="600">
                            <FormLayout>
                              <FormLayout.Group>
                                <Select
                                  label={t("Discount type")}
                                  options={[
                                    { label: t("Percentage"), value: "percent" },
                                    { label: t("Fixed amount"), value: "fixed" },
                                  ]}
                                  value={discountKind}
                                  onChange={(v) => setDiscountKind(v as "percent" | "fixed")}
                                />
                                <TextField
                                  label={t("Amount")}
                                  type="number"
                                  value={discountAmount}
                                  onChange={setDiscountAmount}
                                  autoComplete="off"
                                  suffix={discountKind === "percent" ? "%" : "USD"}
                                />
                              </FormLayout.Group>
                            </FormLayout>
                          </Box>
                        )}
                      </BlockStack>
                      <Divider />
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{t("Copy & reporting")}</Text>
                        <FormLayout>
                          <TextField
                            label={t("Delivery note (under the button)")}
                            value={deliveryNote}
                            onChange={setDeliveryNote}
                            autoComplete="off"
                            multiline={2}
                            helpText="Defaults from Settings; override for this drop. Use {{shipping_date}} to insert the ship date."
                          />
                          <TextField
                            label={t("Cohort name")}
                            value={cohortName}
                            onChange={setCohortName}
                            autoComplete="off"
                            placeholder={t("Auto-generated")}
                            helpText={t("Admin reporting only.")}
                          />
                        </FormLayout>
                      </BlockStack>
                      <Divider />
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">{t("Internal notes")}</Text>
                        <TextField
                          label={t("Notes")}
                          labelHidden
                          value={internalNotes}
                          onChange={setInternalNotes}
                          multiline={3}
                          autoComplete="off"
                          placeholder={t("Ops handoff, forecasting context, etc.")}
                        />
                      </BlockStack>
                    </BlockStack>
                  </Collapsible>
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>

          {/* ----- Right column ----- */}
          <Layout.Section variant="oneThird">
            <BlockStack gap="400">
              {/* Storefront preview */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">{t("Storefront preview")}</Text>
                  <Divider />
                  <Box padding="400" borderWidth="025" borderColor="border" borderRadius="300" background="bg-surface">
                    <BlockStack gap="200">
                      <div><Badge tone="warning">Preorder</Badge></div>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{t("Aurora Hoodie — Indigo")}</Text>
                      <Text as="span" tone="subdued">$54.00</Text>
                      <button
                        type="button"
                        style={{ background: "#202223", color: "#fff", border: "none", borderRadius: 8, padding: "10px 14px", fontWeight: 600, width: "100%", cursor: "default" }}
                      >
                        {initialValues.ctaLabel || "Preorder"}
                      </button>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {shipDate
                          ? deliveryNote.replace(/\{\{\s*shipping_date\s*\}\}/g, shipDate)
                          : deliveryNote.replace(/\{\{\s*shipping_date\s*\}\}/g, "soon")}
                      </Text>
                      {paymentMode !== "pay_now" && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {paymentMode === "deposit"
                            ? `Deposit ${depositAmount}${depositKind === "percent" ? "%" : " USD"} today`
                            : "Pay later — charged when it ships"}
                        </Text>
                      )}
                    </BlockStack>
                  </Box>
                </BlockStack>
              </Card>

              {/* Markets */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">{t("Markets")}</Text>
                    <Badge tone={marketsAll ? undefined : "info"}>
                      {marketsAll ? "All markets" : `${markets.length} selected`}
                    </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">{t("Where this preorder is offered. Defaults to all markets.")}</Text>
                  <Divider />
                  <ChoiceList
                    title={t("Market availability")}
                    titleHidden
                    choices={[
                      { label: t("All markets"), value: "all" },
                      { label: t("Specific markets"), value: "specific" },
                    ]}
                    selected={[marketScope]}
                    onChange={(v) => setMarketScope(v[0] as "all" | "specific")}
                  />
                  {marketScope === "specific" && (
                    <Box paddingInlineStart="200">
                      <BlockStack gap="150">
                        {DEMO_MARKETS.map((m) => (
                          <Checkbox
                            key={m.id}
                            label={m.title}
                            helpText={m.subtitle}
                            checked={markets.includes(m.id)}
                            onChange={(c) =>
                              setMarkets((prev) =>
                                c
                                  ? [...prev, m.id]
                                  : prev.filter((x) => x !== m.id),
                              )
                            }
                          />
                        ))}
                      </BlockStack>
                    </Box>
                  )}
                </BlockStack>
              </Card>

              {/* Summary */}
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">{t("Summary")}</Text>
                  <Divider />
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
                          ? `Deposit ${depositAmount}${depositKind === "percent" ? "%" : " USD"}`
                          : "Pay later (on ship)"
                    }
                  />
                </BlockStack>
              </Card>

              {/* Checklist */}
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">{t("Ready to publish?")}</Text>
                  <ChecklistItem ok={!!name} label={t("Name set")} />
                  <ChecklistItem ok={productsChosen} label={t("Products chosen")} />
                  <ChecklistItem ok={!!shipDate} label={t("Ship date set")} />
                </BlockStack>
              </Card>
            </BlockStack>
          </Layout.Section>
        </Layout>

        {/* ----- Full-width: Select product ----- */}
        <Card padding="0">
          <Box padding="400">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">{t("Select product")}</Text>
              <Text as="p" variant="bodySm" tone="subdued">{t("Choose which products sell as preorders, set unit limits, and (optionally) schedule when each is available.")}</Text>
            </BlockStack>
          </Box>
          <Box padding="400" paddingBlockStart="0">
            <InlineStack gap="300" wrap={false}>
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
            </InlineStack>
          </Box>

          <Divider />

          {productMode === "all" ? (
            <Box padding="400">
              <Banner tone="info">
                <Text as="span">{t("Preorders apply to every product, governed by the Inventory rules in Settings.")}</Text>
              </Banner>
            </Box>
          ) : productMode === "collection" ? (
            <Box padding="400">
              <Select
                label={t("Collection")}
                options={[
                  { label: t("Choose a collection…"), value: "" },
                  ...DEMO_COLLECTIONS.map((c) => ({
                    label: `${c.title} (${c.count})`,
                    value: c.id,
                  })),
                ]}
                value={collectionId}
                onChange={setCollectionId}
              />
            </Box>
          ) : (
            <BlockStack gap="0">
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">{t("Choose which products should use this offer.")}</Text>
                  <Button icon={PlusIcon} onClick={openPicker}>{t("Add products")}</Button>
                </InlineStack>
              </Box>
              {selectedVariants.length === 0 ? (
                <Box padding="600" background="bg-surface-secondary">
                  <BlockStack gap="200" inlineAlign="center">
                    <Text as="p" variant="bodyMd" tone="subdued">{t("No products selected yet.")}</Text>
                    <Button variant="primary" icon={PlusIcon} onClick={openPicker}>{t("Add products")}</Button>
                  </BlockStack>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: "product", plural: "products" }}
                  itemCount={selectedVariants.length}
                  selectable={false}
                  headings={[
                    { title: t("Product") },
                    { title: t("Units sold") },
                    { title: t("Limit quantity") },
                    { title: t("End quantity") },
                    { title: t("Availability") },
                    { title: "" },
                  ]}
                >
                  {selectedVariants.map((sv, index) => (
                    <IndexTable.Row id={sv.variantId} key={sv.variantId} position={index}>
                      <IndexTable.Cell>
                        <BlockStack gap="050">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">
                            {sv.productTitle}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {sv.variantTitle}
                          </Text>
                        </BlockStack>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodySm" tone="subdued">{t("0 units")}</Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Box minWidth="120px">
                          <TextField
                            label={t("Limit quantity")}
                            labelHidden
                            type="number"
                            value={sv.unitsOffered}
                            onChange={(v) => updateVariant(sv.variantId, { unitsOffered: v })}
                            autoComplete="off"
                            min={0}
                          />
                        </Box>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Box minWidth="120px">
                          <TextField
                            label={t("End quantity")}
                            labelHidden
                            type="number"
                            value={sv.endQty}
                            onChange={(v) => updateVariant(sv.variantId, { endQty: v })}
                            autoComplete="off"
                            placeholder="—"
                            min={0}
                          />
                        </Box>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Box minWidth="220px">
                          <BlockStack gap="100">
                            <Select
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
                              <TextField
                                label={t("Start date")}
                                labelHidden
                                type="date"
                                value={sv.availStart}
                                onChange={(v) => updateVariant(sv.variantId, { availStart: v })}
                                autoComplete="off"
                                prefix={t("From")}
                              />
                            )}
                            {(sv.availability === "now_until_end" ||
                              sv.availability === "between") && (
                              <TextField
                                label={t("End date")}
                                labelHidden
                                type="date"
                                value={sv.availEnd}
                                onChange={(v) => updateVariant(sv.variantId, { availEnd: v })}
                                autoComplete="off"
                                prefix={t("Until")}
                              />
                            )}
                          </BlockStack>
                        </Box>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Button
                          variant="tertiary"
                          tone="critical"
                          icon={XIcon}
                          accessibilityLabel={t("Remove product")}
                          onClick={() => removeVariant(sv.variantId)}
                        />
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </BlockStack>
          )}
        </Card>

        {/* Footer */}
        <Card>
          <InlineStack align="end" gap="200">
            <Button onClick={() => navigate(backTo)}>Cancel</Button>
            {mode === "create" ? (
              <>
                <Button onClick={handleSaveDraft}>{t("Save draft")}</Button>
                <Button
                  variant="primary"
                  onClick={handlePublish}
                  loading={isSubmitting}
                  disabled={!canPublish}
                >{t("Publish preorder")}</Button>
              </>
            ) : (
              <>
                <Button icon={DeleteIcon} tone="critical" onClick={handleDelete}>{t("Delete")}</Button>
                <Button variant="primary" onClick={handleSaveChanges} loading={isSubmitting}>{t("Save changes")}</Button>
              </>
            )}
          </InlineStack>
        </Card>
      </BlockStack>

      {/* Variant picker modal */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t("Add products to this preorder")}
        primaryAction={{
          content: `Use ${pickerSelected.length} variant${pickerSelected.length === 1 ? "" : "s"}`,
          onAction: confirmPicker,
          disabled: pickerSelected.length === 0,
        }}
        secondaryActions={[{ content: t("Cancel"), onAction: () => setPickerOpen(false) }]}
      >
        <Modal.Section>
          <Filters
            queryValue={pickerQuery}
            queryPlaceholder="Search by product, variant, or vendor"
            onQueryChange={setPickerQuery}
            onQueryClear={() => setPickerQuery("")}
            filters={[]}
            onClearAll={() => setPickerQuery("")}
          />
        </Modal.Section>
        <ResourceList
          resourceName={{ singular: "variant", plural: "variants" }}
          items={visibleVariants}
          selectable
          selectedItems={pickerSelected}
          onSelectionChange={(s) => setPickerSelected(Array.isArray(s) ? s : [])}
          idForItem={(v) => v.variantId}
          renderItem={(v) => (
            <ResourceItem
              id={v.variantId}
              accessibilityLabel={`${v.productTitle} ${v.variantTitle}`}
              onClick={() =>
                setPickerSelected((prev) =>
                  prev.includes(v.variantId)
                    ? prev.filter((x) => x !== v.variantId)
                    : [...prev, v.variantId],
                )
              }
            >
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {v.productTitle}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {v.variantTitle} · {v.vendor}
                  </Text>
                </BlockStack>
                <Text as="span" variant="bodyMd">
                  ${(v.priceCents / 100).toFixed(2)}
                </Text>
              </InlineStack>
            </ResourceItem>
          )}
        />
      </Modal>
    </Page>
  );
}

// ---------- Sidebar primitives ----------
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <InlineStack align="space-between" blockAlign="center">
      <Text as="span" variant="bodySm" tone="subdued">
        {label}
      </Text>
      <Text as="span" variant="bodyMd">
        {value}
      </Text>
    </InlineStack>
  );
}

function ChecklistItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <InlineStack gap="200" blockAlign="center">
      <Box
        background={ok ? "bg-fill-success" : "bg-surface-secondary"}
        padding="100"
        borderRadius="full"
        minWidth="20px"
        minHeight="20px"
      />
      <Text as="span" variant="bodyMd" tone={ok ? undefined : "subdued"}>
        {label}
      </Text>
    </InlineStack>
  );
}
