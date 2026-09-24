# Nova CEO brief — Encore vs. Shopify's September 2026 platform changes

**Date:** 2026-09-24 · **Scope:** Encore (embedded admin app + 12 extensions) · **Sources:** shopify.dev changelog and release notes, Shopify GitHub, npm registry, the Encore repo at commit `d5f0334`. Every version and date below was read from the source named; nothing is assumed.

## 1. Bottom line

Encore is **functionally aligned** with everything Shopify has shipped or deprecated this year — no API we call is being removed, our extensions are already on the new (Preact + web components) model, and we use no script tags. Two things are **not** aligned, one urgent and one strategic:

1. **Urgent (7 days):** the app and the customer-account extension are pinned to API version `2025-10`, which becomes *unsupported on 1 October 2026*. From that date the Shopify CLI blocks app updates when any extension sits on a version more than a year old — i.e. `npm run deploy` stops working. Fix is a version bump plus a re-test; ~1 hour.
2. **Strategic (this quarter):** Encore's admin UI is built on **Polaris React 13**, which Shopify archived on 11 September 2026 ("will not receive updates or maintenance"). The refreshed admin that started rolling out on 15 September only re-skins apps built on **Polaris web components**; ours will keep today's look until we migrate. No deadline has been published for iframe apps, and there is no App Store requirement yet — but every quarter we wait, Encore looks a little more dated next to Shopify's own pages and the migration grows with the codebase.

## 2. What Shopify changed (verified)

| Date | Change | Source |
|---|---|---|
| 1 Oct 2025 | Polaris **web components** released for app development (`<s-*>` custom elements, framework-agnostic, loaded from Shopify's CDN). | [polaris-react-archive README](https://github.com/Shopify/polaris-react-archive) |
| 11 Sep 2026 | **Polaris React repository archived** — no updates, no maintenance, no contributions. Docs moved to an archive site. | same |
| 15 Sep 2026 | **"Prepare your app for the Shopify admin's new look"** — new palette, type, spacing, side nav with search/notifications, floating Sidekick. Admin UI / App Home *extensions* restyle automatically. App Home apps on Polaris web components 1.0 keep current styling until they adopt **Polaris 2.0 (RC "available soon")**. Apps *not* on web components (that is us) get nothing automatically and "must migrate to Polaris Web Components to access Polaris 2.0". | [shopify.dev changelog](https://shopify.dev/changelog/prepare-your-app-for-the-shopify-admins-new-look) |
| 22 Sep 2026 | Polaris web components **1.1 on CDN declared stable**. | [shopify.dev changelog](https://shopify.dev/changelog) |
| 1 Oct 2026 | API `2025-10` leaves support (12-month rule; `2026-07` is latest stable, `2026-10` is RC). Deploys of UI extensions on `2025-07` were extended to this date; after it the CLI "blocks apps from being updated if any of their extensions are on an API version that is more than 1 year old". | [versioning](https://shopify.dev/docs/api/usage/versioning), [staff answer](https://community.shopify.dev/t/will-deploys-to-ui-extensions-using-2025-07-succeed-all-the-way-until-1st-october-2026/35097) |
| 24 Aug 2026 | Script tags deprecated; stop running 1 Mar 2027. | [shopify.dev changelog](https://shopify.dev/changelog) |
| 17 Sep 2026 | `@shopify/shopify-app-react-router` **3.0.0** released (2.0.0 on 10 Aug); depends on `@shopify/shopify-api` 15. | npm registry |

Release notes for `2026-01`, `2026-04`, `2026-07` were read in full. Breaking changes touch bulk operations, inventory quantity mutations (`changeFromQuantity` mandatory), `checkout_id` removal from order webhooks, draft orders, delivery profiles, checkout metafields. **None of these are used by Encore** — our Admin API surface is `sellingPlanGroup*`, `productVariantsBulkUpdate` (inventory *policy* only, no quantities), `validationCreate/Update`, `metafieldsSet`, `tagsAdd`, `appSubscriptionCreate`, theme file reads.

## 3. Where Encore stands

| Area | Encore today | Shopify's current model | Status |
|---|---|---|---|
| Admin app UI | Polaris **React 13.9.5** in 23 route/component files using 33 distinct components; App Bridge React 4.2.10 | Polaris web components 1.1 (stable), 2.0 RC coming with the new admin look | **Behind** — works, but frozen upstream; won't pick up the new look |
| Admin navigation | `<s-app-nav>` / `<s-link>` web components | same | Aligned |
| App framework | `@shopify/shopify-app-react-router` 1.2.0 (`shopify-api` 12.3.0 — knows API versions up to `2026-04`) | 3.0.0 / `shopify-api` 15 | Two majors behind; upgrade needed to reach `2026-07`+ |
| API version | `2025-10` (app + customer-account extension) | `2026-07` stable, `2026-10` RC | **Unsupported from 1 Oct 2026** |
| Customer-account UI extension | Preact + Polaris web components, `@shopify/ui-extensions ~2025.10.0` | same model | Aligned in model; version bump needed |
| Storefront | Theme app embed (`encore-storefront`), universal auto-mount, no script tags | Theme app extensions; script tags dying Mar 2027 | Aligned |
| Functions / Flow | Cart & checkout validation function (`encore-preorder-cap`), 9 Flow triggers/actions | same | Aligned |
| Webhooks | `orders/create|paid|cancelled` + PCD granted; verified live on orders #1018/#1019 today | same | Aligned |

## 4. Decisions needed

**A. API version bump before 1 October — DONE 2026-09-24 (commit on Mac; needs `npm run deploy`).**
- *What:* pin app + extension to `2026-04` (the newest version our installed SDK knows); bump `@shopify/ui-extensions` to `~2026.4.0`; re-test the customer-account block and one order end-to-end; `npm run deploy`.
- *Why:* keeps `npm run deploy` working after 1 Oct and stops Admin API calls silently "falling forward" to a version we never tested.
- *Scope:* 3 files (`shopify.app.toml`, `app/shopify.server.ts`, extension toml + package.json); no feature change.
- *Risk:* low — the 2026-01/04 breaking lists don't touch our calls; the customer-account block is the only thing to eyeball.

**B. SDK upgrade to `shopify-app-react-router` 3.x / `shopify-api` 15 — DONE 2026-09-24 (with API `2026-07`, Node 22, Polaris pinned to `polaris-1.js`).**
- *What:* dependency upgrade so we can sit on `2026-07` and receive future versions; run the full gate set.
- *Why:* two majors behind means each quarter's version bump gets harder; changelog for 2.0/3.0 isn't on GitHub yet, so we upgrade on a branch and read the diff.
- *Scope:* `package.json`, likely small auth/session-storage signature changes; half a day incl. regression.
- *Risk:* medium — session storage and billing helpers are where majors usually break; mitigated by the 50-test suite plus the storefront E2E.

**C. Migrate the admin UI to Polaris web components — DONE 2026-09-24 (23 files ported, `@shopify/polaris` removed; 50/50 tests; live verification pending deploy).**
- *What:* replace Polaris React components with `<s-*>` web components page by page (Dashboard → Preorders → Campaign detail/form → Settings → the rest), keeping our design layer (`app/app.css`, IconTile/StatCard/PageHero) on top; adopt Polaris 2.0 when the RC lands so Encore restyles with the new admin.
- *Why:* Shopify has stopped maintaining the library we're on; the new admin only restyles web-component apps; "looks native" is an explicit App Store quality bar and a Built for Shopify signal. Also drops ~0.8–1.2 MB of React/Polaris JS from every admin page load (Shopify's own figure).
- *Scope:* 23 files, 33 distinct Polaris React components (IndexTable/IndexFilters, Modal, Tabs and the form controls are the heavy ones). Estimate 3–4 working days for a like-for-like port plus 1 day QA; the form pages (CampaignForm, Settings) are the bulk. No merchant-visible feature changes — this is a re-platform, not a redesign.
- *Risk:* medium — no official migration guide exists yet for iframe App Home ("there isn't currently a dedicated migration guide", Shopify staff, forum). Mitigation: keep both libraries during the port, ship page by page behind the existing routes, screenshot-diff each page.

**Not recommended:** waiting for a deadline. Shopify hasn't set one for iframe apps, which is exactly why the cost of C is lowest now, while the codebase is 23 files.

## 5. Status after 24 Sept (all three executed)

| Area | Now |
|---|---|
| Admin UI | 100% Polaris web components 1.1 (`<s-*>`), loaded from `polaris-1.js`; `@shopify/polaris` uninstalled; 0 React-Polaris imports. Own design layer (`app/app.css`, tiles/stat cards/hero) kept on top. The only hand-drawn chrome is a tab strip (Polaris WC ships none). |
| Icons | Tiles use `@shopify/polaris-icons` SVGs (same set `<s-icon>` draws, still maintained, 9.3.1); everything else uses `<s-icon>` / button `icon=` names. |
| SDK / API | `shopify-app-react-router` 3.0.0, `shopify-api` 15, API `2026-07` on app + all extensions, `ui-extensions` 2026.7.4, Node 22. |
| Next | Switch `polaris-1.js` → `polaris-2.js` + `@shopify/polaris-types` 2.x when Polaris 2.0 leaves RC — one constant, one dev dependency. |

## 6. What this does *not* affect

Nova platform apps (`apps/admin`, `apps/web`, etc.) are not Shopify-embedded and are out of scope here. Encore's billing (Shopify app subscriptions), PCD approval, theme embed, Functions and Flow extensions all remain valid across every version listed above.
