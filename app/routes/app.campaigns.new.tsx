import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { useLoaderData } from "react-router";

import { authenticate } from "../shopify.server";
import {
  createCampaign,
  parseCampaignFormData,
  type CampaignStatus,
} from "../models/campaign.server";
import { useLocale } from "../lib/i18n";
import { syncCampaignSellingPlan } from "../models/selling-plan.server";
import { listCollections } from "../models/collections.server";
import { fetchMarkets } from "../models/markets.server";
import { getSettings } from "../models/settings.server";
import { getShopCurrency } from "../models/shop.server";
import CampaignForm, {
  campaignDefaultsFromSettings,
} from "../components/CampaignForm";

const STATUS_BY_INTENT: Record<string, CampaignStatus> = {
  publish: "LIVE",
  schedule: "SCHEDULED",
  draft: "DRAFT",
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [collections, markets, settings, currency] = await Promise.all([
    listCollections(admin),
    fetchMarkets(admin),
    getSettings(session.shop),
    getShopCurrency(admin, session.shop),
  ]);
  return {
    currency,
    collections,
    marketsList:
      markets?.map((m) => ({ id: m.id, title: m.name, subtitle: m.handle })) ?? null,
    // F0.4 / A4: a new rule INHERITS the store's defaults (payment, deposit, button,
    // cart, delivery note, order tag) instead of re-asking for them.
    initialValues: campaignDefaultsFromSettings(
      settings.general as Record<string, unknown>,
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();

  const intent = String(form.get("intent") ?? "draft");
  const parsed = parseCampaignFormData(form);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  const status = STATUS_BY_INTENT[intent] ?? "DRAFT";
  const created = await createCampaign(session.shop, {
    ...parsed.input,
    status,
  });

  // Sync the Shopify pre-order selling plan (deposit / pay-later). Best-effort:
  // a transient API hiccup must never block the campaign being saved.
  try {
    await syncCampaignSellingPlan(admin, session.shop, created.id);
  } catch (e) {
    console.error("selling-plan sync failed (create)", e);
  }

  return redirect(`/app/campaigns/${created.id}`);
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function CampaignsNew() {
  const { t } = useLocale();
  const { collections, marketsList, initialValues, currency } = useLoaderData<typeof loader>();
  return (
    <CampaignForm
      mode="create"
      initialValues={initialValues}
      currency={currency}
      pageTitle={t("New preorder")}
      pageSubtitle={t("Three quick fields and you're live: name, variants, ship date.")}
      backTo="/app/campaigns"
      collections={collections}
      marketsList={marketsList}
    />
  );
}
