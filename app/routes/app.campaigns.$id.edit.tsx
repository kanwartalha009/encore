import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { redirect, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { authenticate } from "../shopify.server";
import {
  dbToFormValues,
  deleteCampaign,
  getCampaign,
  parseCampaignFormData,
  updateCampaign,
  type CampaignStatus,
} from "../models/campaign.server";
import { useLocale } from "../lib/i18n";
import {
  deleteCampaignSellingPlan,
  syncCampaignSellingPlan,
} from "../models/selling-plan.server";
import prisma from "../db.server";
import { notifyShipDateChanged } from "../services/notify-events.server";
import CampaignForm, {
  type CampaignFormValues,
} from "../components/CampaignForm";

const STATUS_BY_INTENT: Record<string, CampaignStatus | undefined> = {
  publish: "LIVE",
  schedule: "SCHEDULED",
  draft: "DRAFT",
  save: undefined, // preserve existing status
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const campaign = await getCampaign(session.shop, id);
  if (!campaign) throw new Response("Not found", { status: 404 });

  return {
    id: campaign.id,
    name: campaign.name,
    initialValues: dbToFormValues(campaign) as CampaignFormValues,
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");

  if (intent === "delete") {
    // Remove the Shopify selling plan before the campaign row disappears.
    try {
      await deleteCampaignSellingPlan(admin, session.shop, id);
    } catch (e) {
      console.error("selling-plan delete failed", e);
    }
    await deleteCampaign(session.shop, id);
    return redirect("/app/campaigns");
  }

  const parsed = parseCampaignFormData(form);
  if (!parsed.ok) {
    return Response.json({ ok: false, error: parsed.error }, { status: 400 });
  }

  // Snapshot the ship date before the update so we can detect a change.
  const before = await prisma.campaign.findFirst({
    where: { shop: session.shop, id },
    select: { name: true, shipDate: true },
  });

  const statusOverride = STATUS_BY_INTENT[intent];
  await updateCampaign(session.shop, id, {
    ...parsed.input,
    ...(statusOverride ? { status: statusOverride } : {}),
  });

  // Ship-date change → notify pre-order customers (best-effort; routes by the
  // chosen provider, per affected customer).
  try {
    const newShip = parsed.input.shipDate;
    const oldShip = before?.shipDate ?? null;
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    if (newShip && oldShip && fmt(newShip) !== fmt(oldShip)) {
      await notifyShipDateChanged(
        session.shop,
        id,
        before?.name ?? "",
        fmt(oldShip),
        fmt(newShip),
      );
    }
  } catch (e) {
    console.error("ship-date notify failed", e);
  }

  // Re-sync the selling plan to match the new config / status (creates, updates,
  // or tears down as eligibility changes). Best-effort.
  try {
    await syncCampaignSellingPlan(admin, session.shop, id);
  } catch (e) {
    console.error("selling-plan sync failed (update)", e);
  }

  return redirect(`/app/campaigns/${id}`);
};

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export default function CampaignsEdit() {
  const { id, name, initialValues } = useLoaderData<typeof loader>();
  const { t } = useLocale();

  return (
    <CampaignForm
      mode="edit"
      initialValues={initialValues}
      pageTitle={name}
      pageSubtitle={t("Edit preorder — changes go live the moment you save.")}
      backTo={`/app/campaigns/${id}`}
    />
  );
}
