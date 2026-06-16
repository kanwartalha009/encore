/**
 * Resource route for campaign mutations.
 *
 * Submitted to from:
 *   - app.campaigns._index.tsx (bulk actions on the list)
 *   - app.campaigns.$id.tsx    (single-campaign secondary actions)
 *
 * Always 303-redirects on success so the loader re-runs and the UI
 * reflects the new state.
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticate } from "../shopify.server";
import {
  bulkSetCampaignStatus,
  deleteCampaign,
  duplicateCampaign,
  setCampaignStatus,
} from "../models/campaign.server";
import {
  deleteCampaignSellingPlan,
  syncCampaignSellingPlan,
} from "../models/selling-plan.server";

// Loader: nothing to fetch, but block direct GETs.
export const loader = async () => {
  throw new Response("Method not allowed", { status: 405 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const idsRaw = form.get("ids");
  const id = String(form.get("id") ?? "");

  let ids: string[] = [];
  if (idsRaw) {
    try {
      ids = JSON.parse(String(idsRaw));
    } catch {
      ids = String(idsRaw)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } else if (id) {
    ids = [id];
  }

  const redirectTo =
    String(form.get("redirectTo") ?? "") || "/app/campaigns";

  switch (intent) {
    case "pause":
      await bulkSetCampaignStatus(session.shop, ids, "PAUSED");
      break;
    case "resume":
      await bulkSetCampaignStatus(session.shop, ids, "LIVE");
      break;
    case "schedule":
      await bulkSetCampaignStatus(session.shop, ids, "SCHEDULED");
      break;
    case "end":
      await bulkSetCampaignStatus(session.shop, ids, "ENDED");
      break;
    case "publish":
      await bulkSetCampaignStatus(session.shop, ids, "LIVE");
      break;
    case "delete":
      // Tear down the Shopify selling plan before the rows disappear.
      await Promise.all(
        ids.map((rowId) =>
          deleteCampaignSellingPlan(admin, session.shop, rowId).catch((e) =>
            console.error("selling-plan delete failed (bulk)", e),
          ),
        ),
      );
      await Promise.all(
        ids.map((rowId) => deleteCampaign(session.shop, rowId)),
      );
      break;
    case "duplicate": {
      if (ids.length === 1) {
        const cloned = await duplicateCampaign(session.shop, ids[0]);
        return redirect(`/app/campaigns/${cloned.id}/edit`);
      }
      await Promise.all(
        ids.map((rowId) => duplicateCampaign(session.shop, rowId)),
      );
      break;
    }
    case "set_cohort_ready": {
      // Mark the campaign's primary cohort as READY_TO_SHIP via raw SQL is
      // overkill; the cohort lives on prisma but we don't need a typed update
      // here since it's a fire-and-forget admin action.
      // Defer real implementation to v1.1 when scheduled balance capture is
      // wired.
      break;
    }
    default:
      throw new Response(`Unknown intent: ${intent}`, { status: 400 });
  }

  // A status change flips selling-plan eligibility: LIVE/SCHEDULED (re)create the
  // plan, PAUSED/ENDED tear it down. Best-effort — never block the redirect.
  if (["pause", "resume", "schedule", "end", "publish"].includes(intent)) {
    await Promise.all(
      ids.map((rowId) =>
        syncCampaignSellingPlan(admin, session.shop, rowId).catch((e) =>
          console.error("selling-plan sync failed (bulk)", e),
        ),
      ),
    );
  }

  return redirect(redirectTo);
};

export default function CampaignActionsRoute() {
  return null;
}
