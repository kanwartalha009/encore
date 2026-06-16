/**
 * Campaign data layer.
 *
 * All queries are scoped by shop (multi-tenant). The Prisma schema stores
 * arrays and small objects as JSON strings (SQLite limitation); helpers in
 * this file serialize/parse so callers see clean typed data.
 */

import type { Campaign as PrismaCampaign } from "@prisma/client";
import prisma from "../db.server";

// ---------- Enum unions (mirrors Prisma schema string fields) ----------
export type CampaignStatus =
  | "DRAFT"
  | "SCHEDULED"
  | "LIVE"
  | "PAUSED"
  | "ENDED";
export type ProductMode = "SPECIFIC" | "COLLECTION" | "ALL";
export type TriggerType = "STOCK" | "DATE" | "MANUAL";
export type PaymentMode = "PAY_NOW" | "DEPOSIT" | "PAY_LATER";
export type DepositKind = "PERCENT" | "FIXED";
export type CartMode = "SPLIT" | "WARNING";
export type DiscountKind = "PERCENT" | "FIXED";
export type CtaPlacement = "REPLACE" | "BESIDE" | "STACK";
export type BalanceReminder =
  | "7_DAYS_BEFORE"
  | "3_DAYS_BEFORE"
  | "ON_SHIP"
  | "OFF";
export type AlertChannel = "EMAIL" | "SLACK" | "BOTH";

export type DunningStep = {
  id: string;
  channel: "email" | "sms";
  offsetDays: number;
  label: string;
};

export type VariantAvailability =
  | "now"
  | "from_start"
  | "now_until_end"
  | "between"
  | "not_available";

export type VariantConfig = {
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  unitsOffered: number; // "Limit quantity"
  endQty?: number; // "End quantity" — stop preorder at this cumulative count
  availability?: VariantAvailability;
  availStart?: string; // ISO date/datetime when availability is date-based
  availEnd?: string;
};

// ---------- Hydrated Campaign (JSON columns parsed) ----------
export type Campaign = Omit<
  PrismaCampaign,
  | "productIds"
  | "customerTags"
  | "restrictedCountries"
  | "orderTags"
  | "zoneOverrides"
  | "dunningSteps"
  | "variantConfigs"
  | "markets"
> & {
  productIds: string[];
  customerTags: string[];
  restrictedCountries: string[];
  orderTags: string[];
  zoneOverrides: Record<string, string>;
  dunningSteps: DunningStep[];
  variantConfigs: VariantConfig[];
  markets: string[]; // selected Shopify Market IDs; [] = all markets
};

// ---------- (De)serialization ----------
function safeParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function hydrate(c: PrismaCampaign): Campaign {
  return {
    ...c,
    productIds: safeParse<string[]>(c.productIds, []),
    customerTags: safeParse<string[]>(c.customerTags, []),
    restrictedCountries: safeParse<string[]>(c.restrictedCountries, []),
    orderTags: safeParse<string[]>(c.orderTags, []),
    zoneOverrides: safeParse<Record<string, string>>(c.zoneOverrides, {}),
    dunningSteps: safeParse<DunningStep[]>(c.dunningSteps, []),
    variantConfigs: safeParse<VariantConfig[]>(c.variantConfigs ?? "[]", []),
    markets: safeParse<string[]>(
      (c as PrismaCampaign & { markets?: string }).markets ?? "[]",
      [],
    ),
  };
}

// ---------- Input shape (everything optional except shop + name) ----------
export type CampaignInput = {
  name: string;
  status?: CampaignStatus;
  internalNotes?: string | null;

  productMode?: ProductMode;
  productIds?: string[];
  collectionId?: string | null;
  perVariantRules?: boolean;
  markets?: string[];

  triggerType?: TriggerType;
  stockThreshold?: number;
  startDate?: Date | null;
  endDate?: Date | null;

  shipDate?: Date | null;
  cohortName?: string | null;
  shipBufferDays?: number;
  autoNotifyShipChange?: boolean;

  paymentMode?: PaymentMode;
  depositKind?: DepositKind;
  depositAmount?: number;
  balanceCaptureDays?: number;
  moqEnabled?: boolean;
  moqUnits?: number | null;
  moqDeadline?: Date | null;

  cartMode?: CartMode;
  mixedCartWarning?: string;
  allowGuestCheckout?: boolean;

  discountEnabled?: boolean;
  discountKind?: DiscountKind;
  discountAmount?: number;
  stackWithShopifyDiscounts?: boolean;

  ctaLabel?: string;
  ctaPlacement?: CtaPlacement;
  deliveryNote?: string;
  zoneOverrides?: Record<string, string>;

  confirmationEmail?: boolean;
  restockAlert?: boolean;
  balanceReminder?: BalanceReminder;
  merchantAlertMoq?: boolean;
  merchantAlertBalanceFail?: boolean;
  merchantAlertCohortReady?: boolean;
  alertChannel?: AlertChannel;

  gateByCustomerTag?: boolean;
  customerTags?: string[];
  vipEarlyAccessUntil?: Date | null;
  restrictedCountries?: string[];

  maxPerCustomer?: number | null;
  maxPerCampaign?: number | null;

  orderTags?: string[];
  dunningSteps?: DunningStep[];

  variantConfigs?: VariantConfig[];

  webhookUrl?: string | null;
  metafieldNamespace?: string;
};

function toStorage(input: Partial<CampaignInput>) {
  // Map an input partial → Prisma column shape. JSON columns get stringified,
  // everything else passes through. Undefined keys are dropped so create/update
  // semantics work the same.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (
      k === "productIds" ||
      k === "customerTags" ||
      k === "restrictedCountries" ||
      k === "orderTags" ||
      k === "zoneOverrides" ||
      k === "dunningSteps" ||
      k === "variantConfigs" ||
      k === "markets"
    ) {
      out[k] = JSON.stringify(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------- Aggregate row used by the list page ----------
export type CampaignWithStats = Campaign & {
  unitsSold: number;
  unitsTarget: number | null;
  gmvCents: number;
  cohortName: string | null;
};

function moneyFmt(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatGmv(cents: number) {
  return moneyFmt(cents);
}

// ---------- Queries ----------
export async function listCampaigns(shop: string): Promise<CampaignWithStats[]> {
  const rows = await prisma.campaign.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
    include: {
      cohorts: {
        orderBy: { shipDate: "asc" },
        take: 1,
      },
      preOrders: {
        select: { units: true, amount: true },
      },
    },
  });

  return rows.map((r) => {
    const unitsSold = r.preOrders.reduce((acc, p) => acc + p.units, 0);
    const gmvCents = Math.round(
      r.preOrders.reduce((acc, p) => acc + p.amount, 0) * 100,
    );
    const cohort = r.cohorts[0] ?? null;
    return {
      ...hydrate(r),
      unitsSold,
      unitsTarget: cohort?.unitsTarget ?? null,
      gmvCents,
      cohortName: cohort?.name ?? null,
    };
  });
}

export type CampaignDetail = Campaign & {
  cohort: {
    id: string;
    name: string;
    shipDate: Date;
    status: string;
    unitsTarget: number | null;
  } | null;
  unitsSold: number;
  gmvCents: number;
  depositCollectedCents: number;
  balancePendingCents: number;
};

export async function getCampaign(
  shop: string,
  id: string,
): Promise<CampaignDetail | null> {
  const row = await prisma.campaign.findFirst({
    where: { shop, id },
    include: {
      cohorts: { orderBy: { shipDate: "asc" }, take: 1 },
      preOrders: {
        select: {
          units: true,
          amount: true,
          depositAmount: true,
          balanceAmount: true,
          paymentStatus: true,
        },
      },
    },
  });
  if (!row) return null;

  const unitsSold = row.preOrders.reduce((a, p) => a + p.units, 0);
  const gmvCents = Math.round(
    row.preOrders.reduce((a, p) => a + p.amount, 0) * 100,
  );
  const depositCollectedCents = Math.round(
    row.preOrders.reduce((a, p) => a + (p.depositAmount ?? 0), 0) * 100,
  );
  const balancePendingCents = Math.round(
    row.preOrders
      .filter((p) => p.paymentStatus !== "BALANCE_PAID" && p.paymentStatus !== "REFUNDED")
      .reduce((a, p) => a + (p.balanceAmount ?? 0), 0) * 100,
  );

  const cohort = row.cohorts[0]
    ? {
        id: row.cohorts[0].id,
        name: row.cohorts[0].name,
        shipDate: row.cohorts[0].shipDate,
        status: row.cohorts[0].status,
        unitsTarget: row.cohorts[0].unitsTarget,
      }
    : null;

  return {
    ...hydrate(row),
    cohort,
    unitsSold,
    gmvCents,
    depositCollectedCents,
    balancePendingCents,
  };
}

export async function listCustomersForCampaign(shop: string, campaignId: string) {
  return prisma.preOrder.findMany({
    where: { shop, campaignId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

// ---------- Mutations ----------
export async function createCampaign(shop: string, input: CampaignInput) {
  const data = toStorage({
    ...input,
    // Sensible defaults for fields that have unioned enums
    status: input.status ?? "DRAFT",
  });

  const created = await prisma.campaign.create({
    data: {
      shop,
      name: input.name,
      ...data,
    },
  });

  // Auto-create the cohort if the merchant supplied a ship date.
  if (input.shipDate) {
    await prisma.cohort.create({
      data: {
        shop,
        campaignId: created.id,
        shipDate: input.shipDate,
        name: input.cohortName?.trim() || autoCohortName(input.shipDate, input.name),
        unitsTarget: input.moqEnabled ? input.moqUnits ?? null : null,
        status: "ON_TRACK",
      },
    });
  }

  return created;
}

export async function updateCampaign(
  shop: string,
  id: string,
  input: Partial<CampaignInput>,
) {
  return prisma.campaign.update({
    where: { id, shop },
    data: toStorage(input),
  });
}

export async function deleteCampaign(shop: string, id: string) {
  return prisma.campaign.delete({ where: { id, shop } });
}

export async function setCampaignStatus(
  shop: string,
  id: string,
  status: CampaignStatus,
) {
  return prisma.campaign.update({
    where: { id, shop },
    data: { status },
  });
}

/**
 * Bulk status mutation. Returns the number of rows changed.
 */
export async function bulkSetCampaignStatus(
  shop: string,
  ids: string[],
  status: CampaignStatus,
) {
  if (ids.length === 0) return 0;
  const res = await prisma.campaign.updateMany({
    where: { shop, id: { in: ids } },
    data: { status },
  });
  return res.count;
}

/**
 * Clone a campaign + its primary cohort. PreOrders are NOT cloned (they belong
 * to the source campaign's history). The clone starts as DRAFT.
 */
export async function duplicateCampaign(shop: string, id: string) {
  const src = await prisma.campaign.findFirst({
    where: { shop, id },
    include: { cohorts: { orderBy: { shipDate: "asc" }, take: 1 } },
  });
  if (!src) throw new Error("Campaign not found");

  const cohort = src.cohorts[0];

  // Strip immutable fields and let Prisma re-generate them.
  const {
    id: _id,
    createdAt: _ca,
    updatedAt: _ua,
    cohorts: _coh,
    ...rest
  } = src;
  void _id;
  void _ca;
  void _ua;
  void _coh;

  const cloned = await prisma.campaign.create({
    data: {
      ...rest,
      name: `${src.name} (copy)`,
      status: "DRAFT",
    },
  });

  if (cohort) {
    await prisma.cohort.create({
      data: {
        shop,
        campaignId: cloned.id,
        shipDate: cohort.shipDate,
        name: `${cohort.name} (copy)`,
        unitsTarget: cohort.unitsTarget,
        status: "ON_TRACK",
      },
    });
  }

  return cloned;
}

// ---------- Helpers ----------
function autoCohortName(shipDate: Date, campaignName: string) {
  const month = shipDate.toLocaleString("en-US", { month: "long" });
  const year = shipDate.getFullYear();
  return `${month} ${year} — ${campaignName}`;
}

// ---------- DB → form-state mapping ----------
// Used by the edit route to pre-populate the shared CampaignForm component.
// Mirrors CampaignFormValues from app/components/CampaignForm.tsx — kept here
// to avoid the model layer importing UI code.

const PAYMENT_MODE_FROM_DB = {
  PAY_NOW: "pay_now",
  DEPOSIT: "deposit",
  PAY_LATER: "pay_later",
} as const;

const DEPOSIT_KIND_FROM_DB = {
  PERCENT: "percent",
  FIXED: "fixed",
} as const;

const CART_MODE_FROM_DB = {
  SPLIT: "split",
  WARNING: "warning",
} as const;

const DISCOUNT_KIND_FROM_DB = DEPOSIT_KIND_FROM_DB;

const CTA_PLACEMENT_FROM_DB = {
  REPLACE: "replace",
  BESIDE: "beside",
  STACK: "stack",
} as const;

const TRIGGER_TYPE_FROM_DB = {
  STOCK: "stock",
  DATE: "date",
  MANUAL: "manual",
} as const;

const BALANCE_REMINDER_FROM_DB = {
  "7_DAYS_BEFORE": "7_days_before",
  "3_DAYS_BEFORE": "3_days_before",
  ON_SHIP: "on_ship",
  OFF: "off",
} as const;

const ALERT_CHANNEL_FROM_DB = {
  EMAIL: "email",
  SLACK: "slack",
  BOTH: "both",
} as const;

const PRODUCT_MODE_FROM_DB = {
  SPECIFIC: "specific",
  COLLECTION: "collection",
  ALL: "all",
} as const;

function dateToInput(d: Date | null | undefined): string {
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function datetimeLocalToInput(d: Date | null | undefined): string {
  if (!d) return "";
  // datetime-local expects YYYY-MM-DDTHH:mm in local time
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Convert a DB Campaign into the shape the React form expects.
 * Returns an object that can be assigned directly to CampaignFormValues.
 *
 * Imports demoProducts only for title/variant-count lookup, so edit pages
 * show real product names. When the real Shopify ResourcePicker is wired,
 * this import should become a dynamic Admin GraphQL fetch instead.
 */
export function dbToFormValues(c: Campaign) {
  // Lazy-loaded to avoid pulling demo data into bundles that don't need it.
  // (At runtime in the loader this is a no-op cost.)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { lookupDemoProduct } = require("../lib/demoProducts") as typeof import("../lib/demoProducts");

  return {
    name: c.name,
    internalNotes: c.internalNotes ?? "",
    markets: c.markets,

    productMode: PRODUCT_MODE_FROM_DB[
      c.productMode as keyof typeof PRODUCT_MODE_FROM_DB
    ] ?? "specific",
    selectedProducts: c.productIds.map((id) => {
      const demo = lookupDemoProduct(id);
      return {
        id,
        title: demo?.title ?? id.split("/").pop() ?? id,
        variants: demo?.variants?.length ?? 1,
      };
    }),
    selectedVariants: c.variantConfigs.map((vc) => ({
      productId: vc.productId,
      variantId: vc.variantId,
      productTitle: vc.productTitle,
      variantTitle: vc.variantTitle,
      unitsOffered: String(vc.unitsOffered),
      endQty: vc.endQty != null ? String(vc.endQty) : "",
      availability: vc.availability ?? "now",
      availStart: vc.availStart ?? "",
      availEnd: vc.availEnd ?? "",
    })),
    perVariantRules: c.perVariantRules,
    collectionId: c.collectionId ?? "",

    triggerType: TRIGGER_TYPE_FROM_DB[
      c.triggerType as keyof typeof TRIGGER_TYPE_FROM_DB
    ] ?? "stock",
    stockThreshold: String(c.stockThreshold ?? 0),
    startDate: dateToInput(c.startDate),
    endDate: dateToInput(c.endDate),

    shipDate: dateToInput(c.shipDate),
    cohortName: c.cohortName ?? "",
    shipBufferDays: String(c.shipBufferDays ?? 0),
    autoNotifyShipChange: c.autoNotifyShipChange,

    paymentMode: PAYMENT_MODE_FROM_DB[
      c.paymentMode as keyof typeof PAYMENT_MODE_FROM_DB
    ] ?? "deposit",
    depositKind: DEPOSIT_KIND_FROM_DB[
      c.depositKind as keyof typeof DEPOSIT_KIND_FROM_DB
    ] ?? "percent",
    depositAmount: String(c.depositAmount ?? 20),
    balanceCaptureDays: String(c.balanceCaptureDays ?? 7),
    moqEnabled: c.moqEnabled,
    moqUnits: c.moqUnits != null ? String(c.moqUnits) : "100",
    moqDeadline: dateToInput(c.moqDeadline),

    cartMode: CART_MODE_FROM_DB[
      c.cartMode as keyof typeof CART_MODE_FROM_DB
    ] ?? "split",
    mixedCartWarning: c.mixedCartWarning,
    allowGuestCheckout: c.allowGuestCheckout,

    discountEnabled: c.discountEnabled,
    discountKind: DISCOUNT_KIND_FROM_DB[
      c.discountKind as keyof typeof DISCOUNT_KIND_FROM_DB
    ] ?? "percent",
    discountAmount: String(c.discountAmount ?? 0),
    stackWithShopifyDiscounts: c.stackWithShopifyDiscounts,

    ctaLabel: c.ctaLabel,
    ctaPlacement: CTA_PLACEMENT_FROM_DB[
      c.ctaPlacement as keyof typeof CTA_PLACEMENT_FROM_DB
    ] ?? "replace",
    deliveryNote: c.deliveryNote,

    confirmationEmail: c.confirmationEmail,
    restockAlert: c.restockAlert,
    balanceReminder: BALANCE_REMINDER_FROM_DB[
      c.balanceReminder as keyof typeof BALANCE_REMINDER_FROM_DB
    ] ?? "7_days_before",
    merchantAlertMoq: c.merchantAlertMoq,
    merchantAlertBalanceFail: c.merchantAlertBalanceFail,
    merchantAlertCohortReady: c.merchantAlertCohortReady,
    alertChannel: ALERT_CHANNEL_FROM_DB[
      c.alertChannel as keyof typeof ALERT_CHANNEL_FROM_DB
    ] ?? "email",

    gateByCustomerTag: c.gateByCustomerTag,
    customerTags: c.customerTags,
    vipEarlyAccessEnabled: !!c.vipEarlyAccessUntil,
    vipEarlyAccessUntil: datetimeLocalToInput(c.vipEarlyAccessUntil),
    restrictedCountries: c.restrictedCountries,

    maxPerCustomer: c.maxPerCustomer != null ? String(c.maxPerCustomer) : "",
    maxPerCampaign: c.maxPerCampaign != null ? String(c.maxPerCampaign) : "",

    orderTags: c.orderTags,

    dunningSteps: c.dunningSteps,

    webhookUrl: c.webhookUrl ?? "",
    metafieldNamespace: c.metafieldNamespace ?? "preorder_novafied",
  };
}

// ---------- FormData → CampaignInput ----------
// Centralized so both the create and edit actions parse the same way.

function asInt(v: FormDataEntryValue | null, fallback: number) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}
function asFloat(v: FormDataEntryValue | null, fallback: number) {
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function asBool(v: FormDataEntryValue | null) {
  return v === "on" || v === "true" || v === "1";
}
function asStr(v: FormDataEntryValue | null) {
  return v == null ? "" : String(v);
}
function asNullableStr(v: FormDataEntryValue | null) {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}
function asDate(v: FormDataEntryValue | null): Date | null {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}
function asJson<T>(v: FormDataEntryValue | null, fallback: T): T {
  if (v == null) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}

export function parseCampaignFormData(
  form: FormData,
): { ok: true; input: CampaignInput } | { ok: false; error: string } {
  const name = asStr(form.get("name")).trim();
  if (!name) return { ok: false, error: "Campaign name is required." };

  const input: CampaignInput = {
    name,
    internalNotes: asNullableStr(form.get("internalNotes")),

    productMode: asStr(form.get("productMode")) as ProductMode,
    productIds: asJson<string[]>(form.get("productIds"), []),
    collectionId: asNullableStr(form.get("collectionId")),
    perVariantRules: asBool(form.get("perVariantRules")),
    markets: asJson<string[]>(form.get("markets"), []),

    triggerType: asStr(form.get("triggerType")) as TriggerType,
    stockThreshold: asInt(form.get("stockThreshold"), 0),
    startDate: asDate(form.get("startDate")),
    endDate: asDate(form.get("endDate")),

    shipDate: asDate(form.get("shipDate")),
    cohortName: asNullableStr(form.get("cohortName")),
    shipBufferDays: asInt(form.get("shipBufferDays"), 0),
    autoNotifyShipChange: asBool(form.get("autoNotifyShipChange")),

    paymentMode: asStr(form.get("paymentMode")) as PaymentMode,
    depositKind: asStr(form.get("depositKind")) as DepositKind,
    depositAmount: asFloat(form.get("depositAmount"), 20),
    balanceCaptureDays: asInt(form.get("balanceCaptureDays"), 7),
    moqEnabled: asBool(form.get("moqEnabled")),
    moqUnits: form.get("moqUnits") ? asInt(form.get("moqUnits"), 0) : null,
    moqDeadline: asDate(form.get("moqDeadline")),

    cartMode: asStr(form.get("cartMode")) as CartMode,
    mixedCartWarning: asStr(form.get("mixedCartWarning")),
    allowGuestCheckout: asBool(form.get("allowGuestCheckout")),

    discountEnabled: asBool(form.get("discountEnabled")),
    discountKind: asStr(form.get("discountKind")) as DiscountKind,
    discountAmount: asFloat(form.get("discountAmount"), 0),
    stackWithShopifyDiscounts: asBool(form.get("stackWithShopifyDiscounts")),

    ctaLabel: asStr(form.get("ctaLabel")) || "Preorder",
    ctaPlacement: asStr(form.get("ctaPlacement")) as CtaPlacement,
    deliveryNote: asStr(form.get("deliveryNote")),

    confirmationEmail: asBool(form.get("confirmationEmail")),
    restockAlert: asBool(form.get("restockAlert")),
    balanceReminder: asStr(form.get("balanceReminder")) as BalanceReminder,
    merchantAlertMoq: asBool(form.get("merchantAlertMoq")),
    merchantAlertBalanceFail: asBool(form.get("merchantAlertBalanceFail")),
    merchantAlertCohortReady: asBool(form.get("merchantAlertCohortReady")),
    alertChannel: asStr(form.get("alertChannel")) as AlertChannel,

    gateByCustomerTag: asBool(form.get("gateByCustomerTag")),
    customerTags: asJson<string[]>(form.get("customerTags"), []),
    vipEarlyAccessUntil: asDate(form.get("vipEarlyAccessUntil")),
    restrictedCountries: asJson<string[]>(form.get("restrictedCountries"), []),

    maxPerCustomer: form.get("maxPerCustomer")
      ? asInt(form.get("maxPerCustomer"), 0)
      : null,
    maxPerCampaign: form.get("maxPerCampaign")
      ? asInt(form.get("maxPerCampaign"), 0)
      : null,

    orderTags: asJson<string[]>(form.get("orderTags"), []),
    dunningSteps: asJson<DunningStep[]>(form.get("dunningSteps"), []),

    variantConfigs: asJson<VariantConfig[]>(
      form.get("variantConfigs"),
      [],
    ),

    webhookUrl: asNullableStr(form.get("webhookUrl")),
    metafieldNamespace:
      asStr(form.get("metafieldNamespace")) || "preorder_novafied",
  };

  return { ok: true, input };
}
