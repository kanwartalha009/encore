/**
 * Transactional email transport for the Shopify-Flow notification path.
 *
 * Shopify Flow's built-in email action is staff-only (fixed recipient), so when a
 * merchant runs the "no-Klaviyo" path their customer emails are sent by Encore:
 * Flow calls our "Send Encore email" action (app/routes/flow.send-email.tsx),
 * which renders the merchant's template and calls sendEmail() here.
 *
 * Provider-agnostic: configured by env. The default shape targets a Resend-style
 * JSON API (`from`, `to`, `subject`, `text`); swap the URL/body for SendGrid,
 * Postmark, SES, etc. If unconfigured, we return a FAILED result with a reason —
 * never a silent success (mirrors the §8 reliability bar).
 *
 *   ENCORE_EMAIL_API_URL   default https://api.resend.com/emails
 *   ENCORE_EMAIL_API_KEY   bearer token for the provider
 *   ENCORE_EMAIL_FROM      verified sender, e.g. "Acme <preorders@acme.com>"
 */

export type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  /** Display name for the From line (the store's name); the address stays ENCORE_EMAIL_FROM. */
  fromName?: string;
  /** Extra headers, e.g. List-Unsubscribe (Resend `headers` field). */
  headers?: Record<string, string>;
};

/**
 * "Store Name <verified@address>" from ENCORE_EMAIL_FROM ("Name <addr>" or
 * "addr"). Quotes / angle brackets / line breaks are stripped from the name.
 * Exported for tests.
 */
export function fromWithName(from: string, name?: string): string {
  const clean = (name ?? "").replace(/["<>\r\n]/g, "").trim().slice(0, 80);
  if (!clean) return from;
  const addr = from.match(/<([^>]+)>/)?.[1] ?? from.trim();
  return `"${clean}" <${addr}>`;
}

export type SendResult = { ok: true } | { ok: false; reason: string };

export function emailTransportConfigured(): boolean {
  return Boolean(process.env.ENCORE_EMAIL_API_KEY && process.env.ENCORE_EMAIL_FROM);
}

export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const apiKey = process.env.ENCORE_EMAIL_API_KEY ?? "";
  const from = process.env.ENCORE_EMAIL_FROM ?? "";
  const url = process.env.ENCORE_EMAIL_API_URL || "https://api.resend.com/emails";

  if (!apiKey || !from) {
    return {
      ok: false,
      reason:
        "no_transport: set ENCORE_EMAIL_API_KEY + ENCORE_EMAIL_FROM to enable Encore-sent emails",
    };
  }
  if (!input.to) return { ok: false, reason: "no_recipient" };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromWithName(from, input.fromName),
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.headers && Object.keys(input.headers).length ? { headers: input.headers } : {}),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `provider_${res.status}: ${body.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      reason: `transport_error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
