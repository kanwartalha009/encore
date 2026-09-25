/**
 * Get help (E1) — a simple support form. Subject + message → the durable Nova
 * outbox → platform support ingress (⇄ platform N4). Trap-safe: `sendSupportTicket`
 * (a `.server` value) is used only in the action, never the component.
 */
import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppPage } from "../components/ui";
import { flag, val } from "../components/wc";

import { authenticate } from "../shopify.server";
import { useLocale } from "../lib/i18n";
import { sendSupportTicket } from "../lib/nova.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const fd = await request.formData();
  const subject = String(fd.get("subject") ?? "").trim();
  const message = String(fd.get("message") ?? "").trim();
  const email = String(fd.get("email") ?? "").trim();
  if (!subject || !message) return { ok: false as const };
  await sendSupportTicket({
    shopDomain: session.shop,
    subject,
    message,
    email: email || undefined,
  });
  return { ok: true as const };
};

export const headers: HeadersFunction = (h) => boundary.headers(h);

export default function HelpPage() {
  const { t } = useLocale();
  const fetcher = useFetcher<typeof action>();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const busy = fetcher.state !== "idle";
  const sent = fetcher.data?.ok === true;
  const failed = fetcher.data?.ok === false;

  return (
    <AppPage heading={t("Get help")} size="small" breadcrumb={{ label: t("nav.settings"), to: "/app/settings" }} intro={t("Send us a message — we usually reply within a day.")}>
        <s-section>
          <div className="encore-stack">
            {sent && <s-banner tone="success">{t("Thanks — your message is on its way.")}</s-banner>}
            {failed && <s-banner tone="critical">{t("Please add a subject and a message.")}</s-banner>}
            <fetcher.Form method="post">
              <div className="encore-stack encore-stack--tight">
                <s-text-field label={t("Subject")} name="subject" value={subject} onInput={(e) => setSubject(val(e))} />
                <s-text-area label={t("Message")} name="message" value={message} rows={5} onInput={(e) => setMessage(val(e))} />
                <s-email-field label={t("Your email (optional)")} name="email" value={email} onInput={(e) => setEmail(val(e))} />
                <div>
                  <s-button type="submit" variant="primary" loading={flag(busy)}>
                    {t("Send")}
                  </s-button>
                </div>
              </div>
            </fetcher.Form>
          </div>
        </s-section>
    </AppPage>
  );
}
