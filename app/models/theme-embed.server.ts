/**
 * Real theme-embed status (R1.5 audit fix).
 *
 * Settings used to show "Storefront block: Enabled" from a saved flag — an
 * assumption, not a check. This reads the MAIN theme's config/settings_data.json
 * (read_themes scope) and looks for Encore's app embed block, the same way the
 * theme editor decides whether an embed is on:
 *   current.blocks[<uuid>] = { type: "shopify://apps/<app>/blocks/app-embed/<ext uid>", disabled?: true }
 *
 * Also builds the one-click activation deep link Shopify documents for app
 * embeds:  /admin/themes/current/editor?context=apps&activateAppId=<uid>/<handle>
 * Best-effort: any failure returns { checked: false } and the UI falls back to
 * "not verified" rather than claiming Enabled.
 */
import type { AdminGraphqlClient } from "./selling-plan.server";

// extensions/encore-storefront/shopify.extension.toml → uid + the embed block's filename
export const STOREFRONT_EXTENSION_UID = "5e941c1b-5e76-1ab6-720c-102fa9952c8362b251c8";
export const APP_EMBED_HANDLE = "app-embed";

export type EmbedStatus =
  | { checked: true; enabled: boolean; themeName: string; themeStoreId: number | null; blockType: string | null }
  | { checked: false; reason: string };

const THEME_Q = `#graphql
query EncoreMainThemeEmbed {
  themes(first: 1, roles: [MAIN]) {
    nodes {
      id
      name
      themeStoreId
      files(filenames: ["config/settings_data.json"], first: 1) {
        nodes {
          filename
          body { ... on OnlineStoreThemeFileBodyText { content } }
        }
      }
    }
  }
}`;

export function embedActivationUrl(shop: string): string {
  return `https://${shop}/admin/themes/current/editor?context=apps&activateAppId=${STOREFRONT_EXTENSION_UID}/${APP_EMBED_HANDLE}`;
}

export async function getEmbedStatus(admin: AdminGraphqlClient): Promise<EmbedStatus> {
  try {
    const res = await admin.graphql(THEME_Q);
    const body = (await res.json()) as {
      data?: {
        themes?: {
          nodes?: {
            name: string;
            themeStoreId: number | null;
            files?: { nodes?: { filename: string; body?: { content?: string } }[] };
          }[];
        };
      };
      errors?: { message: string }[];
    };
    if (body.errors?.length) return { checked: false, reason: body.errors.map((e) => e.message).join("; ") };
    const theme = body.data?.themes?.nodes?.[0];
    if (!theme) return { checked: false, reason: "no main theme" };
    const content = theme.files?.nodes?.[0]?.body?.content;
    if (!content) return { checked: false, reason: "settings_data.json unreadable" };
    // settings_data.json may start with a /* comment */ block — strip it.
    const json = JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\/\s*/, "")) as {
      current?: string | { blocks?: Record<string, { type?: string; disabled?: boolean }> };
    };
    const current = typeof json.current === "object" && json.current ? json.current : null;
    const blocks = current?.blocks ?? {};
    let found: { type?: string; disabled?: boolean } | null = null;
    for (const b of Object.values(blocks)) {
      const t = b?.type ?? "";
      if (t.includes(`/blocks/${APP_EMBED_HANDLE}/`) && (t.includes(STOREFRONT_EXTENSION_UID) || t.includes("encore"))) {
        found = b;
        break;
      }
    }
    return {
      checked: true,
      enabled: !!found && found.disabled !== true,
      themeName: theme.name,
      themeStoreId: theme.themeStoreId ?? null,
      blockType: found?.type ?? null,
    };
  } catch (e) {
    return { checked: false, reason: String((e as Error)?.message ?? e) };
  }
}
