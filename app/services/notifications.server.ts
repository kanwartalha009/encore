/**
 * Notification templates + provider choice (N1).
 *
 * One place the merchant edits and translates the customer-email copy. The same
 * resolved copy feeds BOTH paths:
 *   - Klaviyo: passed as event properties the merchant's Klaviyo template renders.
 *   - Shopify Flow: the "Send Encore email" action renders it and Encore sends it.
 *
 * Copy precedence: merchant override for the locale → merchant override for "en"
 * → built-in default. Variables are `{{ snake_case }}` tokens.
 */
import { getSettings, saveSettingsSection } from "../models/settings.server";

export type NotificationProvider = "klaviyo" | "shopify_flow" | "off";

export type MessageType =
  | "preorder_confirmation"
  | "back_in_stock"
  | "ship_date_update"
  | "balance_due";

export type MessageTemplate = { subject: string; body: string };

export const MESSAGE_TYPES: {
  type: MessageType;
  label: string;
  vars: string[];
}[] = [
  {
    type: "preorder_confirmation",
    label: "Preorder confirmation",
    vars: ["customer_name", "product", "ship_date", "deposit", "balance", "order_name"],
  },
  {
    type: "back_in_stock",
    label: "Back in stock",
    vars: ["customer_name", "product", "variant", "product_url"],
  },
  {
    type: "ship_date_update",
    label: "Ship-date update",
    vars: ["customer_name", "product", "old_ship_date", "new_ship_date"],
  },
  {
    type: "balance_due",
    label: "Balance due",
    vars: ["customer_name", "product", "balance", "due_date", "pay_link"],
  },
];

const DEFAULTS: Record<MessageType, MessageTemplate> = {
  preorder_confirmation: {
    subject: "Your pre-order is confirmed — {{product}}",
    body:
      "Hi {{customer_name}},\n\nThanks for pre-ordering {{product}}. " +
      "It's expected to ship around {{ship_date}}.\n\n" +
      "We'll email you as soon as it's on the way.",
  },
  back_in_stock: {
    subject: "{{product}} is back in stock",
    body:
      "Hi {{customer_name}},\n\nGood news — {{product}} {{variant}} is back in stock. " +
      "Grab it before it sells out again:\n{{product_url}}",
  },
  ship_date_update: {
    subject: "An update on your pre-order — {{product}}",
    body:
      "Hi {{customer_name}},\n\nThe expected ship date for {{product}} has moved to " +
      "{{new_ship_date}}. Thanks for your patience — we'll keep you posted.",
  },
  balance_due: {
    subject: "Balance due for your pre-order — {{product}}",
    body:
      "Hi {{customer_name}},\n\nYour pre-order of {{product}} is almost ready. " +
      "The remaining balance of {{balance}} is due {{due_date}}.\n{{pay_link}}",
  },
};

export type NotificationSettings = {
  provider: NotificationProvider;
  klaviyoBisMode: "events" | "native"; // N3: custom event vs Klaviyo's native back-in-stock
  // templates[type][locale] = { subject, body }
  templates: Record<string, Record<string, MessageTemplate>>;
};

export async function getNotificationSettings(
  shop: string,
): Promise<NotificationSettings> {
  const s = (await getSettings(shop)).notifications as Partial<NotificationSettings>;
  const provider =
    s.provider === "klaviyo" || s.provider === "shopify_flow" || s.provider === "off"
      ? s.provider
      : "off";
  const klaviyoBisMode = s.klaviyoBisMode === "native" ? "native" : "events";
  const templates =
    s.templates && typeof s.templates === "object" ? s.templates : {};
  return { provider, klaviyoBisMode, templates };
}

export async function saveNotificationSettings(
  shop: string,
  next: NotificationSettings,
): Promise<void> {
  await saveSettingsSection(shop, "notifications", next as unknown as Record<string, unknown>);
}

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) =>
    key in vars ? vars[key] : "",
  );
}

/** Substitute `{{ var }}` tokens in an arbitrary string (e.g. a Flow override). */
export function applyVars(tpl: string, vars: Record<string, string>): string {
  return render(tpl, vars);
}

export const MESSAGE_TYPE_VALUES: MessageType[] = [
  "preorder_confirmation",
  "back_in_stock",
  "ship_date_update",
  "balance_due",
];

/**
 * Resolve + render a message for a shop/type/locale. Returns the final subject +
 * body with variables substituted. `settings` may be passed to avoid a re-read.
 */
export async function resolveTemplate(
  shop: string,
  type: MessageType,
  locale: string,
  vars: Record<string, string>,
  settings?: NotificationSettings,
): Promise<MessageTemplate> {
  const ns = settings ?? (await getNotificationSettings(shop));
  const perType = ns.templates[type] ?? {};
  const chosen: MessageTemplate =
    perType[locale] ?? perType["en"] ?? DEFAULTS[type];
  return {
    subject: render(chosen.subject || DEFAULTS[type].subject, vars),
    body: render(chosen.body || DEFAULTS[type].body, vars),
  };
}

export function defaultTemplate(type: MessageType): MessageTemplate {
  return DEFAULTS[type];
}
