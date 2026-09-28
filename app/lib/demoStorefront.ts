// Dummy data for the storefront-facing admin features (Back in stock, Low stock,
// Translations). Swap for live Shopify data (shopLocales, inventory, metafields)
// when the Admin API + theme extension land.

// ---------- Locales (would come from shopLocales) ----------
export type DemoLocale = {
  code: string;
  name: string;
  primary?: boolean;
  published: boolean;
};

export const DEMO_LOCALES: DemoLocale[] = [
  { code: "en", name: "English", primary: true, published: true },
  { code: "es", name: "Spanish", published: true },
  { code: "fr", name: "French", published: true },
  { code: "de", name: "German", published: false },
];

// ---------- Storefront strings we add (translatable) ----------
export type StorefrontString = {
  key: string;
  label: string;
  defaultValue: string;
  group: "Preorder" | "Back in stock" | "Low stock" | "Cart & messages";
};

export const STOREFRONT_STRINGS: StorefrontString[] = [
  { key: "preorder_button", label: "Preorder button", defaultValue: "Preorder now", group: "Preorder" },
  { key: "preorder_note", label: "Message below button", defaultValue: "Ships by {{shipping_date}}", group: "Preorder" },
  { key: "preorder_badge", label: "Preorder badge", defaultValue: "Preorder", group: "Preorder" },
  { key: "cart_preorder_label", label: "Cart line label", defaultValue: "Preorder", group: "Preorder" },
  { key: "notify_button", label: "Notify-me button", defaultValue: "Notify me when back in stock", group: "Back in stock" },
  { key: "notify_title", label: "Popup title", defaultValue: "Get notified", group: "Back in stock" },
  { key: "notify_success", label: "Success message", defaultValue: "You're on the list — we'll email you when it's back.", group: "Back in stock" },
  { key: "lowstock_text", label: "Low-stock text", defaultValue: "Only {n} left", group: "Low stock" },
  // 2026-09-28: every other text Encore shows shoppers is translatable too
  // (these were hard-coded English in the storefront script).
  { key: "preorder_fallback_note", label: "Message when no ship date is set", defaultValue: "Ships as soon as it's available.", group: "Preorder" },
  { key: "sold_out", label: "Sold-out button", defaultValue: "Sold out", group: "Preorder" },
  { key: "adding", label: "Button while adding", defaultValue: "Adding…", group: "Preorder" },
  { key: "added", label: "Button after adding", defaultValue: "Added ✓", group: "Preorder" },
  { key: "countdown_label", label: "Countdown label", defaultValue: "Preorder ends in", group: "Preorder" },
  { key: "countdown_units", label: "Countdown units (days, hours, minutes, seconds)", defaultValue: "d,h,m,s", group: "Preorder" },
  { key: "notify_email_label", label: "Popup email field", defaultValue: "Email address", group: "Back in stock" },
  { key: "notify_phone_label", label: "Popup phone field", defaultValue: "Phone (optional)", group: "Back in stock" },
  { key: "notify_submit", label: "Popup submit button", defaultValue: "Notify me", group: "Back in stock" },
  { key: "notify_consent", label: "Consent text", defaultValue: "I agree to be notified by email about this product.", group: "Back in stock" },
  { key: "notify_error", label: "Popup error", defaultValue: "Something went wrong. Please try again.", group: "Back in stock" },
  { key: "notify_invalid_email", label: "Invalid email message", defaultValue: "Please enter a valid email address.", group: "Back in stock" },
  { key: "notify_consent_required", label: "Consent required message", defaultValue: "Please tick the box to continue.", group: "Back in stock" },
  { key: "notify_closed", label: "Sign-ups paused message", defaultValue: "Sign-ups are paused right now. Please try again later.", group: "Back in stock" },
  { key: "cart_ship_label", label: "Cart ship-date label", defaultValue: "Ships", group: "Cart & messages" },
  { key: "mixed_cart_message", label: "Mixed-cart message", defaultValue: "Your cart has both in-stock and preorder items — they may ship separately.", group: "Cart & messages" },
  { key: "add_error", label: "Add-to-cart error", defaultValue: "Could not add to cart.", group: "Cart & messages" },
  { key: "network_error", label: "Network error", defaultValue: "Network error — please try again.", group: "Cart & messages" },
];

/** key → English default, for the storefront config. */
export const STOREFRONT_DEFAULTS: Record<string, string> = Object.fromEntries(
  STOREFRONT_STRINGS.map((s) => [s.key, s.defaultValue]),
);

// Pre-filled sample translations (the rest are blank → fall back to English).
export const SAMPLE_TRANSLATIONS: Record<string, Record<string, string>> = {
  es: { preorder_button: "Reservar ahora", notify_button: "Avísame cuando vuelva" },
  fr: { preorder_button: "Précommander" },
};

// ---------- Low-stock presets ----------
export type LowStockPreset = {
  id: "text" | "bar_text" | "segmented" | "pill" | "color" | "pulse";
  name: string;
  desc: string;
};

export const LOW_STOCK_PRESETS: LowStockPreset[] = [
  { id: "text", name: "Text only", desc: "“Only 5 left”" },
  { id: "bar_text", name: "Progress bar + text", desc: "Bar with “Only 5 left”" },
  { id: "segmented", name: "Segmented bar", desc: "Discrete stepped segments" },
  { id: "pill", name: "Urgency pill", desc: "“Selling fast” badge" },
  { id: "color", name: "Colour threshold", desc: "Green → amber → red" },
  { id: "pulse", name: "Animated bar", desc: "Pulsing for emphasis" },
];

// ---------- Notify-me popup position ----------
export const NOTIFY_POSITIONS = [
  { label: "Replace Add to cart", value: "replace" },
  { label: "Below Add to cart", value: "below" },
  { label: "Above Add to cart", value: "inline" },
] as const;
