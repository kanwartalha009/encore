/**
 * Get help (E1) — a simple support form. Subject + message → the durable Nova
 * outbox → platform support ingress (⇄ platform N4). Trap-safe: `sendSupportTicket`
 * (a `.server` value) is used only in the action, never the component.
 */
import { useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useFetcher } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { Page, Card, BlockStack, TextField, Button, Banner } from "@shopify/polaris";

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
    <Page
      title={t("Get help")}
      subtitle={t("Send us a message — we usually reply within a day.")}
    >
      <Card>
        <BlockStack gap="400">
          {sent && <Banner tone="success">{t("Thanks — your message is on its way.")}</Banner>}
          {failed && <Banner tone="critical">{t("Please add a subject and a message.")}</Banner>}
          <fetcher.Form method="post">
            <BlockStack gap="300">
              <TextField label={t("Subject")} name="subject" value={subject} onChange={setSubject} autoComplete="off" />
              <TextField
                label={t("Message")}
                name="message"
                value={message}
                onChange={setMessage}
                multiline={5}
                autoComplete="off"
              />
              <TextField
                label={t("Your email (optional)")}
                name="email"
                value={email}
                onChange={setEmail}
                type="email"
                autoComplete="email"
              />
              <Button submit variant="primary" loading={busy}>{t("Send")}</Button>
            </BlockStack>
          </fetcher.Form>
        </BlockStack>
      </Card>
    </Page>
  );
}
