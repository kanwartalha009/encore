/**
 * Back-in-stock unsubscribe links (2026-09-28). The link carries a sealed
 * token (shop, email, locale, store name — encrypted, so the email isn't
 * readable in the URL) and stays valid for a year.
 */
import { seal, unseal } from "./seal.server";

const PURPOSE = "unsubscribe";
const TTL_MS = 365 * 24 * 60 * 60 * 1000;

export type UnsubToken = { shop: string; email: string; locale: string; store: string };

export function unsubscribeUrl(t: UnsubToken): string {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return `${base}/unsubscribe?t=${seal(PURPOSE, t, TTL_MS)}`;
}

export function readUnsubscribeToken(token: string | null): UnsubToken | null {
  if (!token) return null;
  const d = unseal<Partial<UnsubToken>>(PURPOSE, token);
  if (!d || typeof d.shop !== "string" || typeof d.email !== "string" || !d.email) return null;
  return { shop: d.shop, email: d.email, locale: String(d.locale ?? "en"), store: String(d.store ?? "") };
}
