/**
 * The pasted Klaviyo private API key (Settings → Advanced), 2026-09-28.
 *
 * It used to sit in AppSettings.general as plain text and was sent back to the
 * browser on every Settings load. Now:
 *   - stored as `klaviyoKeyEnc` (AES-256-GCM via crypto.server, the same as the
 *     OAuth tokens); a legacy plain `klaviyoKey` is migrated on the next save
 *     and still read until then;
 *   - never returned to the browser — the page only learns whether a key is saved;
 *   - kept as-is when Settings is saved without typing a new key.
 * The OAuth connection (klaviyo-oauth.server) stays the preferred path.
 */
import { encryptSecret, decryptSecret } from "../lib/crypto.server";

type General = Record<string, unknown>;

const without = (o: General, keys: string[]): General =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** The usable key, or "" when none is saved. */
export function readKlaviyoKey(general: General): string {
  if (typeof general.klaviyoKeyEnc === "string" && general.klaviyoKeyEnc) {
    return decryptSecret(general.klaviyoKeyEnc);
  }
  return typeof general.klaviyoKey === "string" ? general.klaviyoKey.trim() : "";
}

/** Settings for the browser: no key material, just whether a key is saved. */
export function publicGeneral(general: General): General & { klaviyoKeySet: boolean } {
  const rest = without(general, ["klaviyoKey", "klaviyoKeyEnc"]);
  return { ...rest, klaviyoKeySet: readKlaviyoKey(general) !== "" };
}

/**
 * Merge a Settings save with the stored key. `incoming.klaviyoKey` is a newly
 * typed key (or empty = keep the saved one); `incoming.klaviyoKeyClear` removes it.
 */
export function mergeKlaviyoKey(current: General, incoming: General): General {
  const typedRaw = incoming.klaviyoKey;
  const klaviyoKeyClear = incoming.klaviyoKeyClear;
  // Key fields are never taken from the browser as-is.
  const rest = without(incoming, ["klaviyoKey", "klaviyoKeyClear", "klaviyoKeyEnc", "klaviyoKeySet"]);
  const typed = typeof typedRaw === "string" ? typedRaw.trim() : "";
  if (klaviyoKeyClear === true || klaviyoKeyClear === "true") return rest;
  if (typed) return { ...rest, klaviyoKeyEnc: encryptSecret(typed) };
  // Keep the stored ciphertext untouched (re-encrypting would lose it if the
  // encryption key were ever missing); only a legacy plain key is migrated.
  if (typeof current.klaviyoKeyEnc === "string" && current.klaviyoKeyEnc) {
    return { ...rest, klaviyoKeyEnc: current.klaviyoKeyEnc };
  }
  const legacy = typeof current.klaviyoKey === "string" ? current.klaviyoKey.trim() : "";
  return legacy ? { ...rest, klaviyoKeyEnc: encryptSecret(legacy) } : rest;
}
