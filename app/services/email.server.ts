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
};

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
        from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
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
