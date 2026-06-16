import crypto from "node:crypto";
import prisma from "../db.server";

/**
 * Nova platform integration — SENDING side (build pack §5).
 *
 * Signing contract (defined here; platform endpoints MUST verify to match —
 * see NOVA-INTEGRATION-CONTRACT.md):
 *   header  X-Nova-Signature: sha256=<hex HMAC-SHA256(rawBody, secret)>
 *   install-confirm  secret = NOVA_INSTALL_CONFIRM_SECRET
 *   ingress          secret = NOVA_INGRESS_HMAC_SECRET
 *
 * DURABLE delivery (GO-LIVE-AUDIT P1): every call is written to the NovaOutbox BEFORE the network
 * hop, then delivered best-effort immediately; /cron/nova-outbox retries PENDING rows with backoff.
 * A blip can never silently lose attribution or a commission. Safe to retry — Nova dedupes
 * (install-confirm idempotent by app+store; ingress idempotent by X-Shopify-Webhook-Id).
 * If NOVA_API is unset (local dev without the platform) it no-ops.
 */

const NOVA_API = process.env.NOVA_API ?? "";
const APP_SLUG = "encore";
const MAX_ATTEMPTS = 12;

function sign(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

// Exponential backoff: 1m, 2m, 4m … capped at 6h.
function backoffMs(attempts: number): number {
  return Math.min(6 * 60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, attempts - 1));
}

type OutboxRow = { id: string; url: string; body: string; headers: string; attempts: number };

// Cast to tolerate the Prisma client before `prisma generate` adds NovaOutbox (matches the
// established pattern for new models, e.g. cron.purge-uninstalled's `uninstalledShop`).
const outbox = (
  prisma as unknown as {
    novaOutbox: {
      create(a: { data: Record<string, unknown> }): Promise<{ id: string }>;
      findMany(a: Record<string, unknown>): Promise<OutboxRow[]>;
      update(a: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
    };
  }
).novaOutbox;

/** Deliver one outbox row. Marks SENT on success; backs off (or DEAD past MAX_ATTEMPTS) on failure. */
async function deliver(row: OutboxRow): Promise<boolean> {
  try {
    const extra = JSON.parse(row.headers || "{}") as Record<string, string>;
    const res = await fetch(row.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...extra },
      body: row.body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await outbox.update({ where: { id: row.id }, data: { status: "SENT", sentAt: new Date(), lastError: null } });
    return true;
  } catch (err) {
    const attempts = row.attempts + 1;
    const status = attempts >= MAX_ATTEMPTS ? "DEAD" : "PENDING";
    await outbox.update({
      where: { id: row.id },
      data: { attempts, status, lastError: String(err), nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) },
    });
    if (status === "DEAD") console.error(`[encore/nova] outbox ${row.id} DEAD after ${attempts} attempts: ${String(err)}`);
    return false;
  }
}

async function enqueue(
  kind: "confirm" | "ingress",
  url: string,
  body: string,
  signature: string,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  if (!NOVA_API) {
    console.warn(`[encore/nova] NOVA_API unset — skipping ${kind}`);
    return;
  }
  const headers = JSON.stringify({ "X-Nova-Signature": signature, ...extraHeaders });
  let id: string;
  try {
    ({ id } = await outbox.create({ data: { kind, url, body, headers } }));
  } catch (err) {
    // Outbox write itself failed → best-effort direct send so the event isn't lost entirely.
    console.error("[encore/nova] outbox enqueue failed; direct send", err);
    try {
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Nova-Signature": signature, ...extraHeaders }, body });
    } catch (e) {
      console.error("[encore/nova] direct send also failed", e);
    }
    return;
  }
  // Best-effort immediate delivery; the cron retries if this attempt fails.
  await deliver({ id, url, body, headers, attempts: 0 });
}

/** Drain due outbox rows. Wire to a scheduler via POST /cron/nova-outbox. */
export async function flushOutbox(limit = 50): Promise<{ sent: number; failed: number; processed: number }> {
  if (!NOVA_API) return { sent: 0, failed: 0, processed: 0 };
  const due = await outbox.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  let sent = 0, failed = 0;
  for (const row of due) {
    if (await deliver(row)) sent++;
    else failed++;
  }
  return { sent, failed, processed: due.length };
}

/** Install-confirm — flips the platform Installation to ACTIVE + locks referral (build pack §5.1).
 *  `ref` (agency slug from the referral link) is the automatic attribution path: it provisions a
 *  brand-new store under the referring agency. Immutable once set (Nova invariant I-8). */
export async function confirmInstall(input: {
  shopDomain: string;
  planName?: string;
  installedAt: string;
  ref?: string;
}): Promise<void> {
  const secret = process.env.NOVA_INSTALL_CONFIRM_SECRET ?? "";
  const body = JSON.stringify({
    shopDomain: input.shopDomain,
    appSlug: APP_SLUG,
    planName: input.planName,
    installedAt: input.installedAt,
    ref: input.ref,
  });
  await enqueue("confirm", `${NOVA_API}/v1/internal/installations/confirm`, body, sign(secret, body));
}

/** Forward a lifecycle/GDPR webhook to the platform ingress (billing source of truth, §5.2). */
export async function forwardToIngress(input: {
  topic: string;
  shopDomain: string;
  webhookId: string | null;
  payload: unknown;
}): Promise<void> {
  const secret = process.env.NOVA_INGRESS_HMAC_SECRET ?? "";
  const body = JSON.stringify(input.payload ?? {});
  await enqueue("ingress", `${NOVA_API}/v1/webhooks/shopify/${APP_SLUG}`, body, sign(secret, body), {
    "X-Nova-Topic": input.topic,
    "X-Nova-Shop-Domain": input.shopDomain,
    ...(input.webhookId ? { "X-Shopify-Webhook-Id": input.webhookId } : {}),
  });
}

const ACTIVE_SUBS_QUERY = `#graphql
  query NovaActiveSubs {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        currentPeriodEnd
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing { price { amount currencyCode } interval }
            }
          }
        }
      }
    }
  }`;

/**
 * Build the `_nova` enrichment attached to a forwarded app_subscriptions/update webhook.
 *
 * WHY: the Shopify webhook payload carries NO amount, and Shopify fires NO per-cycle charge webhook
 * (confirmed in the billing docs). So Nova cannot derive revenue from the webhook alone. Here we read
 * the AUTHORITATIVE price/status/period from the Admin API (currentAppInstallation.activeSubscriptions)
 * and hand it to Nova, which records one Charge per cycle and stops the moment status ≠ ACTIVE.
 *
 * Status is taken from the webhook payload (authoritative for CANCELLED/FROZEN/etc.); price + period
 * are taken from the Admin API and only while ACTIVE. Resilient — any failure leaves amount null and
 * Nova falls back to the installed plan's price.
 */
export async function buildSubscriptionEnrichment(
  // `any` to accept the Shopify AdminApiContext.graphql client (its typed options param doesn't
  // unify with a narrow signature); undefined when the webhook has no offline session.
  admin: any,
  payload: any,
): Promise<Record<string, unknown>> {
  const sub = payload?.app_subscription ?? {};
  const subscriptionId: string | null = sub.admin_graphql_api_id ?? null;
  const status: string | null = sub.status ?? null;

  let amountMinor: number | null = null;
  let currencyCode: string | null = null;
  let currentPeriodEnd: string | null = sub.current_period_end ?? null;
  let planName: string | null = sub.name ?? null;

  if (admin && (status == null || status === "ACTIVE")) {
    try {
      const res = await admin.graphql(ACTIVE_SUBS_QUERY);
      const json: any = await res.json();
      const subs = json?.data?.currentAppInstallation?.activeSubscriptions ?? [];
      const match = subs.find((s: any) => s.id === subscriptionId) ?? subs[0];
      if (match) {
        planName = match.name ?? planName;
        currentPeriodEnd = match.currentPeriodEnd ?? currentPeriodEnd;
        const pricing = (match.lineItems ?? [])
          .map((li: any) => li?.plan?.pricingDetails)
          .find((pd: any) => pd?.__typename === "AppRecurringPricing");
        const amt = pricing?.price?.amount;
        if (amt != null) amountMinor = Math.round(parseFloat(String(amt)) * 100);
        currencyCode = pricing?.price?.currencyCode ?? currencyCode;
      }
    } catch (err) {
      console.error("[encore/nova] active-subscription enrichment failed", err);
    }
  }

  return { subscriptionId, status, amountMinor, currencyCode, currentPeriodEnd, planName };
}
