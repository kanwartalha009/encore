/**
 * Back-in-stock contacts — pure helpers (2026-09-28). Shared by the contact
 * sync service, the contacts export and tests.
 *
 * Encore doesn't send SMS; phone numbers shoppers give are passed on to the
 * merchant's own tools (Klaviyo list, Shopify customer, Shopify Flow, CSV).
 */

/**
 * A phone number in E.164 ("+14155550123") or null. Klaviyo and Shopify only
 * accept E.164, and a number typed without a country code can't be converted
 * safely — those stay available as typed (CSV, Flow, a profile property).
 */
export function toE164(phone?: string | null): string | null {
  const raw = String(phone ?? "").trim();
  if (!raw) return null;
  const intl = raw.startsWith("+") ? raw : raw.startsWith("00") ? `+${raw.slice(2)}` : null;
  if (!intl) return null;
  const digits = intl.replace(/\D+/g, "");
  return digits.length >= 8 && digits.length <= 15 && digits[0] !== "0" ? `+${digits}` : null;
}

/** Shopify customer tags Encore adds to a back-in-stock contact. */
export function contactTags(hasPhone: boolean): string[] {
  return hasPhone ? ["encore-back-in-stock", "encore-back-in-stock-sms"] : ["encore-back-in-stock"];
}

export type ContactRow = {
  signedUp: string;
  email: string;
  phone: string;
  product: string;
  variant: string;
  status: string;
  consent: string;
  language: string;
  market: string;
};

export const CONTACT_HEADERS: [keyof ContactRow, string][] = [
  ["signedUp", "Signed up"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["product", "Product"],
  ["variant", "Variant"],
  ["status", "Status"],
  ["consent", "Consent ticked"],
  ["language", "Language"],
  ["market", "Market"],
];

/**
 * CSV cell: quoted, and neutralised when a shopper-typed value starts with a
 * spreadsheet formula character (= + - @ tab CR) — CSV injection guard. A
 * leading "+" on a phone number is kept readable by the apostrophe prefix.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function contactsCsv(rows: ContactRow[], headers: [keyof ContactRow, string][] = CONTACT_HEADERS): string {
  return [headers.map(([, h]) => csvCell(h)).join(","), ...rows.map((r) => headers.map(([k]) => csvCell(r[k])).join(","))].join("\n");
}
