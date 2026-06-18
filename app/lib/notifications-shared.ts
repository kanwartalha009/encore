/**
 * Client-safe notification metadata.
 *
 * No `*.server` value may live here — the Notifications route renders
 * MESSAGE_TYPES, so it must stay out of the client/server split. Types are
 * pulled with `import type`, which is erased at build and therefore never drags
 * the server module into the client bundle.
 */
import type { MessageType } from "../services/notifications.server";

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
