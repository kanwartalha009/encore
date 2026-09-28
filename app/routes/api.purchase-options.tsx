/**
 * Backend for the product-page Purchase options admin extension
 * (extensions/encore-purchase-options). Resource route — no UI.
 *
 * Auth: the extension's fetch() carries a Shopify ID token (Bearer), which
 * `authenticate.admin` validates. `authenticate.admin` also answers the CORS
 * preflight (OPTIONS → action → thrown 204), and `cors()` adds the headers the
 * extension origin (extensions.shopifycdn.com) needs on every reply.
 *
 *   GET  ?productId=gid|&variantId=gid[&sellingPlanId=gid]
 *        → { ok, target, current, matchedBy, campaigns, defaults }
 *   POST JSON { action: attach|create|update|detach|pause|resume, ... }
 *        → { ok, campaign, warning?, emptied? } | { ok:false, error }
 *
 * Trap-safe: `.server` values are only used in loader/action (no component).
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";
import {
  loadPurchaseOptions,
  PoError,
  runPurchaseOptionAction,
} from "../services/purchase-options.server";
import { parsePurchaseOptionAction, parseTargetParams } from "../lib/purchase-options-shared";
import { needsPlan } from "../services/app-pricing.server";

type Cors = (response: Response) => Response;

function fail(cors: Cors, e: unknown) {
  if (e instanceof Response) return cors(e);
  if (e instanceof PoError) return cors(Response.json({ ok: false, error: e.code }, { status: e.status }));
  console.error("[api.purchase-options] failed", e);
  return cors(Response.json({ ok: false, error: "server_error" }, { status: 500 }));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session, cors } = await authenticate.admin(request);
  try {
    const parsed = parseTargetParams(new URL(request.url).searchParams);
    if (!parsed.ok) return cors(Response.json({ ok: false, error: parsed.error }, { status: 400 }));
    const { productId, variantId, sellingPlanId } = parsed.value;
    const view = await loadPurchaseOptions(admin, session.shop, { productId, variantId }, sellingPlanId);
    return cors(Response.json({ ok: true, ...view }));
  } catch (e) {
    return fail(cors, e);
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  // Also handles the OPTIONS preflight (throws a 204 with CORS headers).
  const { admin, session, cors } = await authenticate.admin(request);
  if (request.method !== "POST") {
    return cors(Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 }));
  }
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return cors(Response.json({ ok: false, error: "invalid_body" }, { status: 400 }));
    }
    const parsed = parsePurchaseOptionAction(body);
    if (!parsed.ok) return cors(Response.json({ ok: false, error: parsed.error }, { status: 400 }));
    // Same "must pick a plan" rule as the app pages (Shopify App Pricing):
    // no creating or changing preorders from the product page without a plan.
    if (await needsPlan(admin, session.shop)) {
      return cors(Response.json({ ok: false, error: "plan_required" }, { status: 402 }));
    }
    const result = await runPurchaseOptionAction(admin, session.shop, parsed.value);
    return cors(Response.json({ ok: true, ...result }));
  } catch (e) {
    return fail(cors, e);
  }
};
