/**
 * POST /customer/portal — data for the "My pre-orders / My waitlist" Customer
 * Account UI extension (extensions/encore-customer-account).
 *
 * Auth: the extension sends its session token as a Bearer header. It's a JWT
 * signed (HS256) by Shopify with this app's API secret, with `dest` = shop and
 * `sub` = the signed-in customer's id. We verify the signature + expiry + audience
 * ourselves (no extra dependency), resolve the customer's email via the Admin API
 * (read_customers), then return THAT customer's pre-orders + waitlist from our own
 * tables. The shopper only ever sees their own data.
 *
 * GA surfaces only — no Checkout MCP. CORS-open for the extension origin; the
 * Bearer token (not cookies) is the trust boundary, so `*` is safe here.
 */
import crypto from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function b64url(segment: string): Buffer {
  const pad = segment.length % 4 === 0 ? "" : "=".repeat(4 - (segment.length % 4));
  return Buffer.from(segment.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

type Claims = { dest: string; sub: string };

function verifyCustomerToken(token: string): Claims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payloadSeg, signature] = parts;
  const secret = process.env.SHOPIFY_API_SECRET ?? "";
  if (!secret) return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${header}.${payloadSeg}`)
    .digest();
  const got = b64url(signature);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
    return null;
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(b64url(payloadSeg).toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && now >= payload.exp) return null;
  if (typeof payload.nbf === "number" && now < payload.nbf) return null;
  const apiKey = process.env.SHOPIFY_API_KEY ?? "";
  if (apiKey && payload.aud && payload.aud !== apiKey) return null;

  const dest = String(payload.dest ?? "").replace(/^https?:\/\//, "");
  const sub = String(payload.sub ?? "");
  if (!dest || !sub) return null;
  return { dest, sub };
}

function bearer(request: Request): string | null {
  const auth =
    request.headers.get("Authorization") || request.headers.get("authorization");
  if (!auth) return null;
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

const CUSTOMER_EMAIL = `#graphql
query EncoreCustomerEmail($id: ID!) {
  customer(id: $id) {
    id
    defaultEmailAddress { emailAddress }
  }
}`;

type PreOrderRow = {
  orderRef: string | null;
  units: number;
  amount: number;
  depositAmount: number | null;
  balanceAmount: number | null;
  paymentStatus: string;
  createdAt: Date;
  campaign: { name?: string | null; shipDate?: Date | null } | null;
};

type WaitRow = {
  productId: string;
  productTitle: string | null;
  variantTitle: string | null;
  notifiedAt: Date | null;
};

async function buildPortal({ dest, sub }: Claims) {
  const customerGid = sub.startsWith("gid://")
    ? sub
    : `gid://shopify/Customer/${sub}`;

  let email = "";
  try {
    const { admin } = await unauthenticated.admin(dest);
    const res = await admin.graphql(CUSTOMER_EMAIL, {
      variables: { id: customerGid },
    });
    const body = (await res.json()) as {
      data?: { customer?: { defaultEmailAddress?: { emailAddress?: string } } };
    };
    email = body.data?.customer?.defaultEmailAddress?.emailAddress ?? "";
  } catch (e) {
    console.error("[customer.portal] email lookup failed", e);
  }
  if (!email) return { preorders: [], waitlist: [] };

  const emails = Array.from(new Set([email, email.toLowerCase()]));

  const pre = (await prisma.preOrder.findMany({
    where: { shop: dest, customerEmail: { in: emails } },
    include: { campaign: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  })) as unknown as PreOrderRow[];

  const preorders = pre.map((po) => {
    const amountPaid =
      po.paymentStatus === "BALANCE_PAID" ? po.amount : po.depositAmount ?? 0;
    const balanceDue =
      po.paymentStatus === "BALANCE_PAID"
        ? 0
        : po.balanceAmount ?? Math.max(0, po.amount - (po.depositAmount ?? 0));
    return {
      product: po.campaign?.name ?? "Pre-order",
      orderRef: po.orderRef ?? "",
      units: po.units,
      shipDate: po.campaign?.shipDate
        ? po.campaign.shipDate.toISOString().slice(0, 10)
        : "",
      amountPaid: Number(amountPaid.toFixed(2)),
      balanceDue: Number(balanceDue.toFixed(2)),
      paymentStatus: po.paymentStatus,
    };
  });

  const wl = (await prisma.waitlistSubscription.findMany({
    where: { shop: dest, email: { in: emails }, subscribed: true },
    orderBy: { createdAt: "desc" },
    take: 50,
  })) as unknown as WaitRow[];

  const waitlist = wl.map((w) => ({
    product: w.productTitle ?? "Item",
    variant: w.variantTitle ?? "",
    productId: w.productId,
    status: w.notifiedAt ? "AVAILABLE" : "WAITING",
  }));

  return { preorders, waitlist };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== "POST") {
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  const token = bearer(request);
  if (!token) return json({ ok: false, error: "missing_token" }, 401);
  const claims = verifyCustomerToken(token);
  if (!claims) return json({ ok: false, error: "invalid_token" }, 401);

  try {
    const data = await buildPortal(claims);
    return json({ ok: true, ...data });
  } catch (e) {
    console.error("[customer.portal] failed", e);
    return json({ ok: false, error: "server_error" }, 500);
  }
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }
  return json({ ok: false, error: "method_not_allowed" }, 405);
};
