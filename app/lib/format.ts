/**
 * Client-safe display formatters.
 *
 * Must NOT import any `*.server` module. Routes use these helpers inside their
 * components (render), and React Router only strips server code from the
 * `loader`/`action`/`headers`/`middleware` exports — anything a component
 * touches gets bundled for the client. Keeping pure formatters here lets both
 * server modules and route components import them without dragging server-only
 * code (Prisma, secrets, etc.) into the client bundle.
 */

/**
 * Format a minor-unit amount (cents) in the SHOP'S currency.
 *
 * Audit 2026-07-12 A6: every money string was hardcoded to en-US/USD, so a GBP or
 * EUR store saw "$" on its own revenue. Currency comes from the shop (Admin API,
 * see `models/shop.server.ts`) and the locale from the admin's language.
 * Defaults keep the old behaviour for any caller that hasn't threaded currency yet.
 */
export function formatMoney(
  minorUnits: number,
  currency = "USD",
  locale = "en",
  opts: { decimals?: boolean } = {},
): string {
  const digits = opts.decimals ? 2 : 0;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(minorUnits / 100);
  } catch {
    // Unknown currency/locale code → never throw on a dashboard render.
    return `${(minorUnits / 100).toFixed(digits)} ${currency}`;
  }
}

/** Whole-unit money string, e.g. 123456 -> "$1,235" (or "£1,235" for a GBP shop). */
export function formatGmv(cents: number, currency = "USD", locale = "en"): string {
  return formatMoney(cents, currency, locale);
}
