/**
 * Dashboard setup guide (2026-09-28) — pure step list, shared by the
 * dashboard and tests. Each step is "done" from real store state, never a
 * checkbox the merchant ticks.
 */
export type SetupFacts = {
  embed: { checked: boolean; enabled?: boolean };
  preorders: number; // Encore preorders (campaigns) created
  provider: string; // notifications provider: klaviyo | shopify_flow | off
  backInStockSaved: boolean; // Back in stock setup saved at least once
  orders: number; // preorder orders received
};

export type SetupStep = {
  id: "embed" | "preorder" | "emails" | "backinstock" | "test";
  title: string;
  sub: string;
  cta: string;
  to: string; // app path, or "embed" for the theme editor deep link
  done: boolean;
};

export function setupSteps(f: SetupFacts): SetupStep[] {
  return [
    {
      id: "embed",
      title: "Turn on Encore in your theme",
      sub: "One click in the theme editor, then Save. Nothing shows on your store until this is on.",
      cta: "Turn on",
      to: "embed",
      // Couldn't read the theme → not marked done (the banner above explains).
      done: f.embed.checked && f.embed.enabled === true,
    },
    {
      id: "preorder",
      title: "Create your first preorder",
      sub: "Pick products, choose when preorder shows, publish.",
      cta: "Create preorder",
      to: "/app/onboarding",
      done: f.preorders > 0,
    },
    {
      id: "emails",
      title: "Choose how customer emails are sent",
      sub: "Klaviyo or Shopify Flow — confirmations, ship-date changes and restock alerts.",
      cta: "Choose",
      to: "/app/notifications",
      done: f.provider === "klaviyo" || f.provider === "shopify_flow",
    },
    {
      id: "backinstock",
      title: "Set up Back in stock",
      sub: "The Notify me button on sold-out products, and where sign-ups are saved.",
      cta: "Set up",
      to: "/app/waitlist?view=setup",
      done: f.backInStockSaved,
    },
    {
      id: "test",
      title: "Place a test preorder",
      sub: "Order a preorder product on your store to see the whole flow.",
      cta: "View preorders",
      to: "/app/campaigns",
      done: f.orders > 0,
    },
  ];
}
