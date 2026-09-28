/**
 * /unsubscribe?t=<sealed token> — shopper unsubscribe from back-in-stock
 * emails (2026-09-28). Public (no Shopify session: the shopper clicks it from
 * an email). The token is sealed (lib/unsubscribe.server), so it can't be
 * forged or used for another address.
 *
 *   GET  → asks to confirm (a link scanner opening the page unsubscribes no one)
 *   POST → unsubscribes: every still-waiting sign-up for that email in that
 *          store stops getting emails. Also answers RFC 8058 one-click POSTs
 *          from mail apps (List-Unsubscribe-Post header set by flow.send-email).
 * Rows are kept (subscribed=false) so the merchant's counts stay honest.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import prisma from "../db.server";
import { readUnsubscribeToken } from "../lib/unsubscribe.server";
import { unsubCopy, fillStore } from "../lib/email-footer";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const t = new URL(request.url).searchParams.get("t") ?? "";
  const tok = readUnsubscribeToken(t);
  return { valid: !!tok, locale: tok?.locale ?? "en", store: tok?.store ?? "", t };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const tok = readUnsubscribeToken(new URL(request.url).searchParams.get("t"));
  if (!tok) return { done: false };
  const email = tok.email.trim().toLowerCase();
  const rows = await prisma.waitlistSubscription.findMany({
    where: { shop: tok.shop, subscribed: true, email: { not: null } },
    select: { id: true, email: true },
  });
  const ids = rows.filter((r) => (r.email ?? "").trim().toLowerCase() === email).map((r) => r.id);
  if (ids.length) {
    await prisma.waitlistSubscription.updateMany({
      where: { shop: tok.shop, id: { in: ids } },
      data: { subscribed: false },
    });
  }
  console.log(`[unsubscribe] ${tok.shop}: ${ids.length} sign-up(s) unsubscribed`);
  return { done: true };
};

export default function Unsubscribe() {
  const { valid, locale, store, t } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const c = unsubCopy(locale);
  return (
    <main
      lang={locale}
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "64px 24px",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        lineHeight: 1.6,
        color: "#1a1a1a",
        textAlign: "center",
      }}
    >
      <h1 style={{ fontSize: 22 }}>{c.title}</h1>
      {!valid || (result && !result.done) ? (
        <p>{c.invalid}</p>
      ) : result?.done ? (
        <p role="status">{fillStore(c.done, store)}</p>
      ) : (
        <Form method="post" action={`/unsubscribe?t=${encodeURIComponent(t)}`}>
          <p>{fillStore(c.question, store)}</p>
          <button
            type="submit"
            name="confirm"
            value="1"
            style={{
              marginTop: 8,
              padding: "12px 24px",
              borderRadius: 8,
              border: 0,
              background: "#1a1a1a",
              color: "#fff",
              fontSize: 16,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {c.button}
          </button>
        </Form>
      )}
    </main>
  );
}
