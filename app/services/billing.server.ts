/**
 * Shopify app billing (Nova-priced). We call `appSubscriptionCreate` directly with
 * the price fetched from Nova (not the library's static billing config) so pricing
 * is controlled in the Nova admin. `BillingState` records the shop's current plan;
 * `app_subscriptions/update` keeps it authoritative.
 */
import prisma from "../db.server";
import { getPlan, getPlanOverride } from "./plans.server";

type AdminGraphql = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type BillingRow = {
  shop: string;
  planCode: string | null;
  interval: string | null;
  status: string | null;
  subscriptionId: string | null;
  currentPeriodEnd: Date | null;
};

const billingState = (
  prisma as unknown as {
    billingState: {
      findUnique(a: { where: { shop: string } }): Promise<BillingRow | null>;
      upsert(a: {
        where: { shop: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }): Promise<unknown>;
    };
  }
).billingState;

export async function getBillingState(shop: string): Promise<BillingRow | null> {
  return billingState.findUnique({ where: { shop } });
}

export async function saveBillingState(
  shop: string,
  data: Partial<BillingRow>,
): Promise<void> {
  await billingState.upsert({
    where: { shop },
    create: { shop, ...data },
    update: { ...data },
  });
}

// Test charges in any non-production environment (no real money in dev/pilot).
function isTest(): boolean {
  return (
    process.env.ENCORE_BILLING_TEST === "1" ||
    (process.env.NODE_ENV ?? "") !== "production"
  );
}

const CREATE = `#graphql
mutation EncoreSubscriptionCreate(
  $name: String!
  $lineItems: [AppSubscriptionLineItemInput!]!
  $returnUrl: URL!
  $trialDays: Int
  $test: Boolean
) {
  appSubscriptionCreate(
    name: $name
    returnUrl: $returnUrl
    lineItems: $lineItems
    trialDays: $trialDays
    test: $test
  ) {
    userErrors { field message }
    confirmationUrl
    appSubscription { id }
  }
}`;

export async function createSubscription(
  admin: AdminGraphql,
  shop: string,
  planCode: string,
  interval: "EVERY_30_DAYS" | "ANNUAL",
  returnUrl: string,
): Promise<{ confirmationUrl?: string; comped?: boolean; error?: string }> {
  const plan = await getPlan(planCode);
  if (!plan) return { error: "unknown_plan" };

  const override = await getPlanOverride(shop);
  const amount = (interval === "ANNUAL" ? plan.amountAnnual : plan.amountMonthly) / 100;

  // Free comp → no Shopify charge; record ACTIVE locally.
  if (override.type === "FREE") {
    await saveBillingState(shop, {
      planCode,
      interval,
      status: "ACTIVE",
      subscriptionId: null,
    });
    return { comped: true };
  }

  const pricing: Record<string, unknown> = {
    price: { amount, currencyCode: plan.currency },
    interval,
  };
  if (override.type === "PERCENT" && override.value > 0) {
    pricing.discount = { value: { percentage: Math.min(1, override.value / 100) } };
  } else if (override.type === "FIXED" && override.value > 0) {
    pricing.discount = { value: { amount: override.value / 100 } };
  }

  const res = await admin.graphql(CREATE, {
    variables: {
      name: `Encore — ${plan.name} (${interval === "ANNUAL" ? "Annual" : "Monthly"})`,
      returnUrl,
      trialDays: plan.trialDays,
      test: isTest(),
      lineItems: [{ plan: { appRecurringPricingDetails: pricing } }],
    },
  });
  const body = (await res.json()) as {
    data?: {
      appSubscriptionCreate?: {
        userErrors?: { message: string }[];
        confirmationUrl?: string;
        appSubscription?: { id: string };
      };
    };
  };
  const r = body.data?.appSubscriptionCreate;
  if (r?.userErrors?.length) {
    return { error: r.userErrors.map((e) => e.message).join("; ") };
  }
  // Record PENDING; app_subscriptions/update flips it to ACTIVE on approval.
  await saveBillingState(shop, {
    planCode,
    interval,
    status: "PENDING",
    subscriptionId: r?.appSubscription?.id ?? null,
  });
  return { confirmationUrl: r?.confirmationUrl };
}
