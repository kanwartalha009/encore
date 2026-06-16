/**
 * Back-in-stock dispatch — the "fire" half of the waitlist.
 *
 * Reliability bar §8: "A configured back-in-stock notification never silently
 * fails to fire." So every pending subscriber ends in a recorded terminal state:
 *   - SENT   — handed to the channel (Klaviyo) successfully
 *   - FAILED — with a reason, retryable, surfaced in the admin
 * Never dropped. Idempotent (SENT is skipped), retryable (attempt counter +
 * `retryFailed`), and the failure reason is queryable.
 *
 * Triggered by `products/update` (restock) and by the admin "Notify" button.
 * Channel: Klaviyo today (the merchant's flow sends the email); if no channel is
 * configured the subscriber is marked FAILED with a clear reason rather than
 * silently succeeding.
 */

import prisma from "../db.server";
import { getNotificationSettings, resolveTemplate } from "./notifications.server";
import { emitFlow, FLOW_BACK_IN_STOCK_READY } from "./flow.server";
import { klaviyoEvent, klaviyoHasAuth } from "./klaviyo.server";

const MAX_ATTEMPTS = 5;

type Sub = {
  id: string;
  productId: string;
  variantId: string | null;
  productTitle: string | null;
  variantTitle: string | null;
  email: string | null;
  phone: string | null;
  channel: string;
  locale: string | null;
  notifyStatus: string | null;
  notifyAttempts: number;
};

// New notify* fields are added via db push — reach the model through a cast so
// the where/select/data on those fields typecheck before the client regenerates.
const wl = (
  prisma as unknown as {
    waitlistSubscription: {
      findMany(a: {
        where: Record<string, unknown>;
        select?: Record<string, unknown>;
      }): Promise<Sub[]>;
      update(a: {
        where: { id: string };
        data: Record<string, unknown>;
      }): Promise<unknown>;
    };
  }
).waitlistSubscription;

const SUB_SELECT = {
  id: true,
  productId: true,
  variantId: true,
  productTitle: true,
  variantTitle: true,
  email: true,
  phone: true,
  channel: true,
  locale: true,
  notifyStatus: true,
  notifyAttempts: true,
} as const;

const numId = (g?: string | null): string =>
  g ? String(g).split("/").pop() || "" : "";

type Ctx = {
  shop: string;
  provider: "klaviyo" | "shopify_flow" | "off";
  klaviyoReady: boolean;
  bisMode: "events" | "native";
};

async function loadCtx(shop: string): Promise<Ctx> {
  const ns = await getNotificationSettings(shop);
  // Klaviyo is usable via OAuth (preferred) or a pasted key. Provider is the
  // canonical choice; fall back to "klaviyo" when Klaviyo auth exists, else "off".
  const klaviyoReady = await klaviyoHasAuth(shop);
  const provider: Ctx["provider"] =
    ns.provider === "klaviyo" || ns.provider === "shopify_flow"
      ? ns.provider
      : klaviyoReady
        ? "klaviyo"
        : "off";
  return { shop, provider, klaviyoReady, bisMode: ns.klaviyoBisMode };
}

// ---------- Channel: Klaviyo "Back in Stock" event (flow sends the email) ----------
async function sendKlaviyo(subscriber: Sub, ctx: Ctx): Promise<void> {
  if (!subscriber.email) throw new Error("no_email: subscriber has no email address");
  // Encore's editable + translatable copy → Klaviyo event properties, so the
  // merchant's template can render it ({{ event.EmailSubject }} / EmailBody).
  const copy = await resolveTemplate(ctx.shop, "back_in_stock", subscriber.locale || "en", {
    customer_name: "there",
    product: subscriber.productTitle ?? "",
    variant: subscriber.variantTitle ?? "",
    product_url: "",
  });
  const r = await klaviyoEvent(ctx.shop, "Back in Stock", subscriber.email, {
    ProductTitle: subscriber.productTitle,
    Variant: subscriber.variantTitle,
    ProductId: subscriber.productId,
    VariantId: subscriber.variantId,
    Source: "Encore",
    EmailSubject: copy.subject,
    EmailBody: copy.body,
  });
  if (!r.ok) throw new Error(`klaviyo_${r.status}: event rejected`);
}

async function dispatchOne(subscriber: Sub, ctx: Ctx): Promise<"SENT" | "FAILED"> {
  const attempts = (subscriber.notifyAttempts ?? 0) + 1;
  try {
    if (ctx.provider === "klaviyo") {
      if (!ctx.klaviyoReady) {
        throw new Error(
          "no_channel: connect Klaviyo (OAuth) or add an API key in Settings → Notifications",
        );
      }
      if (ctx.bisMode === "native") {
        // Native: the shopper was subscribed to Klaviyo's own back-in-stock at
        // signup; Klaviyo's BIS flow delivers on restock — nothing to send here.
      } else {
        await sendKlaviyo(subscriber, ctx);
      }
    } else if (ctx.provider === "shopify_flow") {
      if (!subscriber.email) {
        throw new Error("no_email: subscriber has no email address");
      }
      // Hand off to the merchant's Flow: a per-customer trigger their workflow
      // turns into an email via the "Encore — Send email" action.
      await emitFlow(ctx.shop, FLOW_BACK_IN_STOCK_READY, {
        email: subscriber.email,
        product: subscriber.productTitle ?? "",
        variant: subscriber.variantTitle ?? "",
        product_url: "",
        locale: subscriber.locale || "en",
      });
    } else {
      // No provider chosen — record it so it's visible + retryable, never silent.
      throw new Error(
        "no_channel: choose Klaviyo or Shopify Flow in Settings → Notifications",
      );
    }

    await wl.update({
      where: { id: subscriber.id },
      data: {
        notifyStatus: "SENT",
        notifiedAt: new Date(),
        notifyError: null,
        notifyAttempts: attempts,
        lastAttemptAt: new Date(),
      },
    });
    return "SENT";
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await wl.update({
      where: { id: subscriber.id },
      data: {
        notifyStatus: "FAILED",
        notifyError: message.slice(0, 500),
        notifyAttempts: attempts,
        lastAttemptAt: new Date(),
      },
    });
    console.error(`[back-in-stock] dispatch FAILED for ${subscriber.id}: ${message}`);
    return "FAILED";
  }
}

type DispatchResult = { attempted: number; sent: number; failed: number };

async function dispatchSubs(subs: Sub[], ctx: Ctx): Promise<DispatchResult> {
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    if (s.notifyStatus === "SENT") continue; // idempotent
    const r = await dispatchOne(s, ctx);
    if (r === "SENT") sent += 1;
    else failed += 1;
  }
  return { attempted: sent + failed, sent, failed };
}

// ---------- Restock (products/update) ----------
export async function notifyRestocked(
  shop: string,
  variants: { productId: string; variantId: string | null }[],
): Promise<DispatchResult> {
  if (!variants.length) return { attempted: 0, sent: 0, failed: 0 };
  const ctx = await loadCtx(shop);

  const productIds = Array.from(new Set(variants.map((v) => v.productId).filter(Boolean)));
  const variantIds = Array.from(
    new Set(variants.map((v) => v.variantId).filter(Boolean) as string[]),
  );

  // Pending subscribers for the restocked products/variants (match by numeric id
  // since stored forms may be numeric or GID).
  const pNums = productIds.map(numId);
  const vNums = variantIds.map(numId);
  const candidates = await wl.findMany({
    where: { shop, subscribed: true },
    select: SUB_SELECT,
  });
  const matched = candidates.filter((s) => {
    if (s.notifyStatus === "SENT") return false;
    const sp = numId(s.productId);
    const sv = numId(s.variantId);
    const productHit = pNums.includes(sp);
    const variantHit = vNums.length === 0 || sv === "" || vNums.includes(sv);
    return productHit && variantHit;
  });

  return dispatchSubs(matched, ctx);
}

// ---------- Manual trigger (admin "Notify" button) ----------
export async function notifyGroup(
  shop: string,
  productId: string,
  variantTitle: string | null,
): Promise<DispatchResult> {
  const ctx = await loadCtx(shop);
  const subs = await wl.findMany({
    where: { shop, subscribed: true, productId },
    select: SUB_SELECT,
  });
  const matched = subs.filter(
    (s) =>
      s.notifyStatus !== "SENT" &&
      (variantTitle == null || s.variantTitle === variantTitle),
  );
  return dispatchSubs(matched, ctx);
}

// ---------- Retry job (scheduled / manual) ----------
export async function retryFailed(shop: string): Promise<DispatchResult> {
  const ctx = await loadCtx(shop);
  const subs = await wl.findMany({
    where: { shop, subscribed: true, notifyStatus: "FAILED" },
    select: SUB_SELECT,
  });
  const retryable = subs.filter((s) => (s.notifyAttempts ?? 0) < MAX_ATTEMPTS);
  return dispatchSubs(retryable, ctx);
}
