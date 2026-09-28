/**
 * Back-in-stock contact sync (2026-09-28) — makes the "Where subscribers are
 * saved" setting real (it was saved but never used):
 *   - "klaviyo"  → create/update the Klaviyo profile (email + phone) and add it
 *                  to the list the merchant picked;
 *   - "shopify"  → create/update the Shopify customer and tag it
 *                  (encore-back-in-stock, + encore-back-in-stock-sms when a
 *                  phone was given) so the merchant's Shopify Flow / Messaging /
 *                  SMS app can reach them;
 *   - "none"     → Encore only.
 * Encore itself doesn't send SMS. Nothing here grants marketing consent — list
 * membership and tags only. Runs after the shopper already got their answer
 * and never throws.
 */
import { getSettings } from "../models/settings.server";
import { klaviyoHasAuth, klaviyoUpsertProfile, klaviyoAddToList } from "./klaviyo.server";
import { toE164, contactTags } from "../lib/contacts-shared";

type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export type SignupContact = {
  email: string | null;
  phone: string | null;
  productTitle: string | null;
  variantTitle: string | null;
  locale: string | null;
};

export type SyncResult = { target: string; ok: boolean; error?: string };

export async function syncContact(
  shop: string,
  admin: AdminGraphql | null | undefined,
  c: SignupContact,
): Promise<SyncResult> {
  let target = "none";
  try {
    const bis = (await getSettings(shop)).backInStock as { syncTarget?: string; klaviyoListId?: string };
    target = bis.syncTarget || "klaviyo";
    if (target === "klaviyo") return await toKlaviyo(shop, bis.klaviyoListId ?? "", c);
    if (target === "shopify") return await toShopify(admin, c);
    return { target, ok: true };
  } catch (e) {
    console.error("[contact-sync] failed", shop, target, e);
    return { target, ok: false, error: String(e) };
  }
}

async function toKlaviyo(shop: string, listId: string, c: SignupContact): Promise<SyncResult> {
  // Not connected yet → nothing to sync (the setup page says so); not an error.
  if (!(await klaviyoHasAuth(shop))) return { target: "klaviyo", ok: true };
  const phone = toE164(c.phone);
  const p = await klaviyoUpsertProfile(shop, {
    email: c.email,
    phone,
    properties: {
      "Encore back in stock": c.productTitle ?? "",
      ...(c.variantTitle ? { "Encore back in stock variant": c.variantTitle } : {}),
      // A number without a country code can't go in phone_number (E.164 only).
      ...(c.phone && !phone ? { "Encore phone (as typed)": c.phone } : {}),
    },
  });
  if (!p.ok || !p.id) return { target: "klaviyo", ok: false, error: `profile_${p.status}` };
  if (!listId) return { target: "klaviyo", ok: true };
  const l = await klaviyoAddToList(shop, listId, p.id);
  return l.ok ? { target: "klaviyo", ok: true } : { target: "klaviyo", ok: false, error: `list_${l.status}` };
}

const FIND = `#graphql
  query EncoreFindCustomer($q: String!) { customers(first: 1, query: $q) { nodes { id } } }`;
const CREATE = `#graphql
  mutation EncoreCreateCustomer($input: CustomerInput!) {
    customerCreate(input: $input) { customer { id } userErrors { field message } }
  }`;
const TAGS = `#graphql
  mutation EncoreTagCustomer($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { userErrors { message } }
  }`;

async function gql<T>(admin: AdminGraphql, q: string, variables: Record<string, unknown>): Promise<T> {
  const res = await admin.graphql(q, { variables });
  return (await res.json()) as T;
}

async function toShopify(admin: AdminGraphql | null | undefined, c: SignupContact): Promise<SyncResult> {
  if (!admin) return { target: "shopify", ok: false, error: "no_admin_session" };
  const phone = toE164(c.phone);
  if (!c.email && !phone) return { target: "shopify", ok: false, error: "no_usable_contact" };
  const tags = contactTags(Boolean(c.phone));
  const q = c.email ? `email:"${c.email.replace(/"/g, "")}"` : `phone:"${phone}"`;
  const found = await gql<{ data?: { customers?: { nodes?: { id: string }[] } } }>(admin, FIND, { q });
  let id = found.data?.customers?.nodes?.[0]?.id;
  if (!id) {
    const note = c.phone && !phone ? `Encore back-in-stock phone (as typed): ${c.phone}` : undefined;
    const input = (withPhone: boolean) => ({
      ...(c.email ? { email: c.email } : {}),
      ...(withPhone && phone ? { phone } : {}),
      ...(note ? { note } : {}),
      ...(c.locale ? { locale: c.locale } : {}),
      tags,
    });
    type Created = { data?: { customerCreate?: { customer?: { id: string } | null; userErrors?: { message: string }[] } } };
    let r = await gql<Created>(admin, CREATE, { input: input(true) });
    // A phone Shopify rejects (or one already on another customer) must not lose the email.
    if (!r.data?.customerCreate?.customer && phone && c.email) {
      r = await gql<Created>(admin, CREATE, { input: { ...input(false), note: `Encore back-in-stock phone: ${phone}` } });
    }
    id = r.data?.customerCreate?.customer?.id;
    if (!id) {
      const msg = r.data?.customerCreate?.userErrors?.map((e) => e.message).join("; ") || "create_failed";
      return { target: "shopify", ok: false, error: msg };
    }
    return { target: "shopify", ok: true };
  }
  const t = await gql<{ data?: { tagsAdd?: { userErrors?: { message: string }[] } } }>(admin, TAGS, { id, tags });
  const errs = t.data?.tagsAdd?.userErrors ?? [];
  return errs.length ? { target: "shopify", ok: false, error: errs.map((e) => e.message).join("; ") } : { target: "shopify", ok: true };
}
