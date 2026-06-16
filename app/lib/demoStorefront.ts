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
  group: "Preorder" | "Back in stock" | "Low stock";
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
];

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
  { label: "Inline (next to price)", value: "inline" },
] as const;
