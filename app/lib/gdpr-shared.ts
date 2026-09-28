/**
 * Pure helpers for the GDPR handlers (2026-09-28) — shared by gdpr.server and
 * its tests. No database or network here.
 *
 * Shopify's customers/redact and customers/data_request payloads identify the
 * customer by email, phone and customer id, and list order ids
 * (orders_to_redact / orders_requested). Encore stores:
 *   - WaitlistSubscription.email / .phone (phone typed by the shopper, any format)
 *   - PreOrder.customerEmail + .shopifyOrderId (an Order GID)
 *   - OrderBundle.customerId (numeric id or GID)
 * so every identifier is expanded into the forms Encore may have stored.
 */

export type GdprCustomer = {
  id?: number | string | null;
  email?: string | null;
  phone?: string | null;
};

/** The email as sent and lower-cased (signup stores it as typed). */
export function emailForms(email?: string | null): string[] {
  const e = (email ?? "").trim();
  return Array.from(new Set([e, e.toLowerCase()])).filter(Boolean);
}

/** Digits only, e.g. "+1 (555) 010-2030" → "15550102030". */
export function phoneDigits(phone?: string | null): string {
  return String(phone ?? "").replace(/\D+/g, "");
}

/**
 * Same phone number? Shoppers type numbers with or without the country code,
 * so two numbers match when their digits are equal (7+ digits), or one ends
 * with the other and the shorter still has 10+ digits (a full national number)
 * — so a local 7-digit number never matches someone else's full number.
 */
export function phonesMatch(a?: string | null, b?: string | null): boolean {
  // Leading zeros are a national trunk prefix ("020 …") or an international
  // "00" — drop them so "020 7946 0958" and "+44 20 7946 0958" compare equal.
  const x = phoneDigits(a).replace(/^0+/, "");
  const y = phoneDigits(b).replace(/^0+/, "");
  if (x.length < 7 || y.length < 7) return false;
  if (x === y) return true;
  const shorter = Math.min(x.length, y.length);
  return shorter >= 10 && (x.endsWith(y) || y.endsWith(x));
}

/** Order ids from the payload → the GIDs Encore stores on PreOrder rows. */
export function orderGids(ids?: (number | string | null)[] | null): string[] {
  const out = new Set<string>();
  for (const raw of ids ?? []) {
    if (raw == null || raw === "") continue;
    const s = String(raw);
    const num = s.split("/").pop() || s;
    out.add(`gid://shopify/Order/${num}`);
  }
  return Array.from(out);
}

/** Customer id → both forms (numeric and GID). */
export function customerIdForms(id?: number | string | null): string[] {
  if (id == null || id === "") return [];
  const s = String(id);
  const num = s.split("/").pop() || s;
  return Array.from(new Set([num, `gid://shopify/Customer/${num}`]));
}
