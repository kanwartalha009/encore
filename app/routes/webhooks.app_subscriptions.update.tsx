/**
 * app_subscriptions/update — the billing lifecycle webhook.
 *
 * Two jobs: (1) forward to the Nova ingress (billing is the platform's source of
 * truth — this is how charges → commissions are derived, build pack §5.2), and
 * (2) keep the local `BillingState` authoritative (status/period) for metering.
 */
import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { saveBillingState } from "../services/billing.server";
import { forwardToIngress, buildSubscriptionEnrichment } from "../lib/nova.server";

type Payload = {
  app_subscription?: {
    admin_graphql_api_id?: string;
    name?: string;
    status?: string; // ACTIVE | CANCELLED | DECLINED | EXPIRED | FROZEN | PENDING | ACCEPTED
    current_period_end?: string | null;
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`[webhook] ${topic} from ${shop}`);

  // Authoritative price/status/period (the webhook has no amount; Shopify fires no per-cycle charge
  // webhook) → Nova records one Charge per cycle and stops accrual when status ≠ ACTIVE.
  const _nova = await buildSubscriptionEnrichment(admin, payload);

  // Forward to Nova (signed) — the billing ledger / commissions depend on this.
  await forwardToIngress({
    topic,
    shopDomain: shop,
    webhookId: request.headers.get("X-Shopify-Webhook-Id"),
    payload: { ...(payload as object), _nova },
  });

  try {
    const sub = (payload as Payload).app_subscription;
    if (sub) {
      // Recover the plan/interval from the subscription name we set at create time
      // ("Encore — Basic (Monthly)"); status/period always come from the webhook.
      const m = (sub.name ?? "").match(/Encore\s*[—-]\s*(\w+)\s*\((Monthly|Annual)\)/i);
      await saveBillingState(shop, {
        ...(m ? { planCode: m[1].toLowerCase() } : {}),
        ...(m ? { interval: m[2].toLowerCase() === "annual" ? "ANNUAL" : "EVERY_30_DAYS" } : {}),
        status: sub.status ?? null,
        subscriptionId: sub.admin_graphql_api_id ?? null,
        currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end) : null,
      });
    }
  } catch (e) {
    console.error("[webhook] app_subscriptions/update handler failed", e);
  }
  return new Response();
};
