/**
 * Per-shop settings persistence.
 *
 * Each settings page stores its whole form state as one JSON blob keyed by
 * shop. The Prisma client is accessed through a narrow cast because the
 * `AppSettings` / `Translation` models are added via `prisma db push` — the
 * generated client only knows about them after `prisma generate` runs.
 */

import prisma from "../db.server";

export type SettingsSection =
  | "general"
  | "lowStock"
  | "backInStock"
  | "benchmark"
  | "notifications";

type SettingsRow = {
  shop: string;
  general: string;
  lowStock: string;
  backInStock: string;
  benchmark: string;
  notifications: string;
};

const appSettings = (
  prisma as unknown as {
    appSettings: {
      findUnique(a: { where: { shop: string } }): Promise<SettingsRow | null>;
      upsert(a: {
        where: { shop: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }): Promise<SettingsRow>;
    };
  }
).appSettings;

function parse<T extends Record<string, unknown>>(s: string | undefined, fb: T): T {
  if (!s) return fb;
  try {
    return { ...fb, ...(JSON.parse(s) as T) };
  } catch {
    return fb;
  }
}

export type ShopSettings = {
  general: Record<string, unknown>;
  lowStock: Record<string, unknown>;
  backInStock: Record<string, unknown>;
  benchmark: Record<string, unknown>;
  notifications: Record<string, unknown>;
};

export async function getSettings(shop: string): Promise<ShopSettings> {
  const row = await appSettings.findUnique({ where: { shop } });
  return {
    general: parse(row?.general, {}),
    lowStock: parse(row?.lowStock, {}),
    backInStock: parse(row?.backInStock, {}),
    benchmark: parse(row?.benchmark, {}),
    notifications: parse(row?.notifications, {}),
  };
}

export async function saveSettingsSection(
  shop: string,
  section: SettingsSection,
  data: Record<string, unknown>,
): Promise<void> {
  const value = JSON.stringify(data);
  await appSettings.upsert({
    where: { shop },
    create: { shop, [section]: value },
    update: { [section]: value },
  });
}

// ---------- Translations ----------

type TranslationRow = { locale: string; key: string; value: string };

const translation = (
  prisma as unknown as {
    translation: {
      findMany(a: { where: { shop: string } }): Promise<TranslationRow[]>;
      upsert(a: {
        where: { shop_locale_key: { shop: string; locale: string; key: string } };
        create: { shop: string; locale: string; key: string; value: string };
        update: { value: string };
      }): Promise<TranslationRow>;
    };
  }
).translation;

/** Returns { locale: { key: value } }. */
export async function getTranslations(
  shop: string,
): Promise<Record<string, Record<string, string>>> {
  const rows = await translation.findMany({ where: { shop } });
  const out: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    (out[r.locale] ??= {})[r.key] = r.value;
  }
  return out;
}

export async function saveTranslations(
  shop: string,
  locale: string,
  entries: Record<string, string>,
): Promise<void> {
  for (const [key, value] of Object.entries(entries)) {
    await translation.upsert({
      where: { shop_locale_key: { shop, locale, key } },
      create: { shop, locale, key, value },
      update: { value },
    });
  }
}
