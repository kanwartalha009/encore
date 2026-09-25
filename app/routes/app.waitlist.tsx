import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useFetcher, useLoaderData, useSearchParams, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { EmailIcon, CartIcon, PackageIcon, ProductIcon } from "@shopify/polaris-icons";
import { ActionBar, AppPage, CheckRow, Disclosure, FormCard, KvRow, MetricStrip, Segmented } from "../components/ui";
import { ChoiceListField, SelectField, flag, isChecked, val } from "../components/wc";
import { useAppBridge } from "@shopify/app-bridge-react";

import { authenticate } from "../shopify.server";
import { listWaitlistGroups, importWaitlist } from "../models/waitlist.server";
import { notifyGroup, retryFailed } from "../services/waitlist-notify.server";
import { NOTIFY_POSITIONS } from "../lib/demoStorefront";
import { listCollections } from "../models/collections.server";
import { CollectionPicker } from "../lib/storefrontKit";
import { useLocale } from "../lib/i18n";
import { prettyDate } from "../lib/format";
import { getSettings, saveSettingsSection } from "../models/settings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [groups, settings, collections] = await Promise.all([
    listWaitlistGroups(session.shop),
    getSettings(session.shop),
    listCollections(admin),
  ]);
  return { groups, saved: settings.backInStock, collections };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const fd = await request.formData();
  const intent = String(fd.get("intent") ?? "save");

  if (intent === "import") {
    const csv = String(fd.get("csv") ?? "");
    if (csv.length > 2_000_000) {
      return Response.json({ ok: false, intent, error: "file_too_large" });
    }
    const r = await importWaitlist(session.shop, admin, csv);
    return Response.json({ ok: !r.error, intent, ...r });
  }

  if (intent === "notify_group") {
    const r = await notifyGroup(
      session.shop,
      String(fd.get("productId") ?? ""),
      (fd.get("variantTitle") as string) || null,
    );
    return Response.json({ ok: true, intent, ...r });
  }
  if (intent === "retry_failed") {
    const r = await retryFailed(session.shop);
    return Response.json({ ok: true, intent, ...r });
  }

  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(String(fd.get("payload") ?? "{}"));
  } catch {
    data = {};
  }
  await saveSettingsSection(session.shop, "backInStock", data);
  return Response.json({ ok: true, intent: "save" });
};

export const headers: HeadersFunction = (headersArgs) =>
  boundary.headers(headersArgs);

export default function BackInStockPage() {
  const { groups, saved, collections } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const { t, locale } = useLocale();
  const submit = useSubmit();
  const v = saved as {
    enabled?: boolean;
    buttonText?: string;
    position?: string;
    buttonColor?: string;
    hideBuyNow?: boolean;
    popupTitle?: string;
    collectPhone?: boolean;
    showProductInfo?: boolean;
    consentText?: string;
    doubleOptIn?: boolean;
    syncTarget?: string;
    excludeTags?: string;
    excludeCollections?: string[];
  };

  // Two views on one page: the subscriber list, and the storefront setup form
  // (form v3 layout). ?view=setup deep-links to the form.
  const [params] = useSearchParams();
  const [view, setView] = useState<"subscribers" | "setup">(
    params.get("view") === "setup" ? "setup" : "subscribers",
  );
  const [moreOpen, setMoreOpen] = useState(false);

  // ----- Storefront settings -----
  const [enabled, setEnabled] = useState(v.enabled ?? true);
  const [buttonText, setButtonText] = useState(
    v.buttonText ?? "Notify me when back in stock",
  );
  const [position, setPosition] = useState<string>(v.position ?? "replace");
  const [buttonColor, setButtonColor] = useState(v.buttonColor ?? "#1A1A1A");
  const [hideBuyNow, setHideBuyNow] = useState(v.hideBuyNow ?? true);
  const [popupTitle, setPopupTitle] = useState(v.popupTitle ?? "Get notified");
  const [collectPhone, setCollectPhone] = useState(v.collectPhone ?? false);
  const [showProductInfo, setShowProductInfo] = useState(v.showProductInfo ?? true);
  const [consentText, setConsentText] = useState(
    v.consentText ?? "I agree to be emailed when this is back in stock.",
  );
  const [doubleOptIn, setDoubleOptIn] = useState(v.doubleOptIn ?? false);
  const [syncTarget, setSyncTarget] = useState(v.syncTarget ?? "klaviyo");
  const [excludeTags, setExcludeTags] = useState(v.excludeTags ?? "archived");
  const [excludeCollections, setExcludeCollections] = useState<string[]>(
    v.excludeCollections ?? [],
  );

  const save = () => {
    submit(
      {
        payload: JSON.stringify({
          enabled, buttonText, position, buttonColor, hideBuyNow, popupTitle,
          collectPhone, showProductInfo, consentText, doubleOptIn, syncTarget,
          excludeTags, excludeCollections,
        }),
      },
      { method: "post" },
    );
    shopify.toast.show(t("Back-in-stock settings saved"));
  };

  const totalSubs = groups.reduce((a, g) => a + g.subscribers, 0);
  const productCount = new Set(groups.map((g) => g.productId)).size;
  const totalConverted = groups.reduce((a, g) => a + g.convertedCount, 0);
  const conversionRate = totalSubs > 0 ? Math.round((totalConverted / totalSubs) * 100) : 0;

  const exportCsv = () => {
    if (typeof document === "undefined") return;
    const header = ["Product", "Variant", "Subscribers", "Email", "SMS", "Both", "Converted", "Newest signup"];
    const body = groups.map((g) => [
      g.productTitle,
      g.variantTitle ?? "",
      g.subscribers,
      g.email,
      g.sms,
      g.both,
      g.convertedCount,
      g.newestSignupAt ? new Date(g.newestSignupAt).toISOString().slice(0, 10) : "",
    ]);
    const csv = [header, ...body]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "back-in-stock-subscribers.csv";
    a.click();
    URL.revokeObjectURL(url);
    shopify.toast.show(t("Subscribers exported"));
  };

  const notifyFetcher = useFetcher<{
    ok?: boolean;
    intent?: string;
    sent?: number;
    failed?: number;
  }>();
  useEffect(() => {
    const d = notifyFetcher.data;
    if (!d || !d.ok) return;
    if (d.intent === "notify_group" || d.intent === "retry_failed") {
      const failed = d.failed ?? 0;
      shopify.toast.show(
        `${t("Notified")} ${d.sent ?? 0}${failed > 0 ? ` · ${failed} ${t("failed")}` : ""}`,
        failed > 0 ? { isError: true } : undefined,
      );
    }
  }, [notifyFetcher.data, shopify]);

  // ---- CSV import (R1 — switching from another app) ----
  const importFetcher = useFetcher<{
    ok?: boolean;
    intent?: string;
    imported?: number;
    skipped?: number;
    duplicates?: number;
    error?: string | null;
  }>();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importResult, setImportResult] = useState<typeof importFetcher.data>(undefined);
  useEffect(() => {
    if (importFetcher.data && importFetcher.data.intent === "import") {
      setImportResult(importFetcher.data);
    }
  }, [importFetcher.data]);
  const onImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importFetcher.submit(
        { intent: "import", csv: String(reader.result ?? "") },
        { method: "post" },
      );
    };
    reader.readAsText(file);
  };
  const importBusy = importFetcher.state !== "idle";
  const importErrorText = (code?: string | null) =>
    code === "missing_email_column"
      ? t("The file needs an “email” column.")
      : code === "missing_product_column"
        ? t("The file needs a “product_id” or “product_handle” column.")
        : code === "empty_file"
          ? t("That file looks empty.")
          : code === "file_too_large"
            ? t("That file is too large — split it and import in parts.")
            : t("Import failed. Check the file and try again.");

  const notify = (productId: string, variantTitle: string | null) => {
    notifyFetcher.submit(
      { intent: "notify_group", productId, variantTitle: variantTitle ?? "" },
      { method: "post" },
    );
  };
  const retryAllFailed = () =>
    notifyFetcher.submit({ intent: "retry_failed" }, { method: "post" });
  const notifyBusy = notifyFetcher.state !== "idle";
  const totalFailed = groups.reduce((a, g) => a + g.failed, 0);

  const rows = groups.map((g, index) => (
    <s-table-row key={index}>
      <s-table-cell>
        <s-stack direction="block" gap="none">
          <s-text type="strong">{g.productTitle}</s-text>
          {g.variantTitle && (
            <s-text color="subdued" fontSize="small">
              {g.variantTitle}
            </s-text>
          )}
          {(g.notified > 0 || g.failed > 0) && (
            <s-stack direction="inline" gap="small-200">
              {g.notified > 0 && <s-badge tone="success">{`${g.notified} ${t("notified")}`}</s-badge>}
              {g.failed > 0 && <s-badge tone="critical">{`${g.failed} ${t("failed")}`}</s-badge>}
            </s-stack>
          )}
        </s-stack>
      </s-table-cell>
      <s-table-cell>
        <s-text type="strong">{g.subscribers.toLocaleString()}</s-text>
      </s-table-cell>
      <s-table-cell>
        <s-stack direction="inline" gap="small-200">
          {g.email > 0 && <s-badge tone="info">{`${t("Email")} · ${g.email}`}</s-badge>}
          {g.sms > 0 && <s-badge tone="success">{`${t("SMS")} · ${g.sms}`}</s-badge>}
          {g.both > 0 && <s-badge tone="caution">{`${t("Both")} · ${g.both}`}</s-badge>}
        </s-stack>
      </s-table-cell>
      <s-table-cell>{g.convertedCount.toLocaleString()}</s-table-cell>
      <s-table-cell>
        <s-text color="subdued" fontSize="small">
          {g.newestSignupAt ? prettyDate(new Date(g.newestSignupAt).toISOString().slice(0, 10), locale) : "—"}
        </s-text>
      </s-table-cell>
      <s-table-cell>
        <s-button icon="notification" onClick={() => notify(g.productId, g.variantTitle)} loading={flag(notifyBusy)}>
          {t("Notify")}
        </s-button>
      </s-table-cell>
    </s-table-row>
  ));

  // ---------- Setup view helpers ----------
  const positionLabel = NOTIFY_POSITIONS.find((p) => p.value === position)?.label ?? position;
  const syncLabel =
    syncTarget === "klaviyo" ? t("Klaviyo") : syncTarget === "shopify" ? t("Shopify customers") : t("Encore only");
  const excludedCount =
    excludeCollections.length +
    excludeTags
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean).length;
  const SYNC_CHOICES = [
    {
      value: "klaviyo",
      label: `${t("Klaviyo")} · ${t("recommended")}`,
      helpText: t("Subscribers land in Klaviyo and your Klaviyo flow sends the restock email."),
    },
    {
      value: "shopify",
      label: t("Shopify customers"),
      helpText: t("Customers are tagged in Shopify and Encore sends the restock email for you."),
    },
    {
      value: "none",
      label: t("Keep in Encore only"),
      helpText: t("Subscribers stay in this list; export them whenever you like."),
    },
  ];
  const saveButton = (
    <s-button variant="primary" onClick={save}>
      {t("common.save")}
    </s-button>
  );

  return (
    <AppPage
      heading={t("backinstock.title")}
      intro={t("backinstock.subtitle")}
      primaryAction={
        view === "setup" ? (
          saveButton
        ) : (
          <s-button variant="primary" onClick={() => setView("setup")}>
            {t("Customize storefront")}
          </s-button>
        )
      }
      secondaryActions={[
        ...(totalFailed > 0
          ? [
              <s-button key="retry" tone="critical" onClick={retryAllFailed} loading={flag(notifyBusy)}>
                {`${t("Retry failed")} (${totalFailed})`}
              </s-button>,
            ]
          : []),
        <s-button key="import" icon="import" onClick={() => fileInputRef.current?.click()} loading={flag(importBusy)}>
          {t("Import CSV")}
        </s-button>,
        <s-button key="export" icon="export" onClick={exportCsv} disabled={flag(groups.length === 0)}>
          {t("common.export")}
        </s-button>,
      ]}
    >
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={onImportFile} />
      {importResult && (
        <s-banner
          tone={importResult.ok ? "success" : "critical"}
          heading={importResult.ok ? t("Import finished") : t("Import failed")}
          dismissible
          onDismiss={() => setImportResult(undefined)}
        >
          <s-paragraph>
            {importResult.ok
              ? `${importResult.imported ?? 0} ${t("subscribers imported")}` +
                ((importResult.duplicates ?? 0) > 0 ? ` · ${importResult.duplicates} ${t("already existed")}` : "") +
                ((importResult.skipped ?? 0) > 0 ? ` · ${importResult.skipped} ${t("rows skipped")}` : "")
              : importErrorText(importResult.error)}
          </s-paragraph>
          {importResult.ok === false && (
            <s-paragraph color="subdued">
              {t("Expected columns: email, product_id or product_handle, and optionally variant_id, locale.")}
            </s-paragraph>
          )}
        </s-banner>
      )}

      <Segmented
        label={t("backinstock.title")}
        options={[
          { value: "subscribers", label: totalSubs > 0 ? `${t("Subscribers")} ${totalSubs}` : t("Subscribers") },
          { value: "setup", label: t("Storefront setup") },
        ]}
        value={view}
        onChange={setView}
      />

      {view === "subscribers" ? (
        <>
          <MetricStrip
            metrics={[
              {
                label: t("Total subscribers"),
                value: totalSubs.toLocaleString(),
                sub: `${t("across")} ${productCount} ${productCount === 1 ? t("product") : t("products")}`,
                icon: EmailIcon,
                tone: "sky",
              },
              {
                label: t("Converted to purchase"),
                value: totalConverted.toLocaleString(),
                delta: `${conversionRate}%`,
                deltaTone: totalConverted > 0 ? "success" : "subdued",
                sub: t("conversion rate"),
                icon: CartIcon,
                tone: "emerald",
              },
              {
                label: t("Products with waitlists"),
                value: productCount.toLocaleString(),
                sub: `${t("newest signup")} ${
                  groups.length && groups.some((g) => g.newestSignupAt)
                    ? prettyDate(
                        new Date(
                          Math.max(
                            ...groups
                              .filter((g) => g.newestSignupAt)
                              .map((g) => new Date(g.newestSignupAt as string).getTime()),
                          ),
                        )
                          .toISOString()
                          .slice(0, 10),
                        locale,
                      )
                    : "—"
                }`,
                icon: PackageIcon,
                tone: "violet",
              },
            ]}
          />

          {groups.length === 0 ? (
            <s-section>
              <s-empty-state heading={t("No subscribers yet")}>
                <s-paragraph slot="subheading">
                  {t("Once the theme block is added, shoppers can subscribe on out-of-stock products.")}
                </s-paragraph>
                <s-button slot="primary-action" variant="primary" onClick={() => setView("setup")}>
                  {t("Customize storefront")}
                </s-button>
              </s-empty-state>
            </s-section>
          ) : (
            <s-section heading={t("Subscribers")} padding="none">
              <s-table>
                <s-table-header-row>
                  <s-table-header listSlot="primary">{t("Product · variant")}</s-table-header>
                  <s-table-header format="numeric">{t("Subscribers")}</s-table-header>
                  <s-table-header listSlot="inline">{t("Channels")}</s-table-header>
                  <s-table-header format="numeric">{t("Converted")}</s-table-header>
                  <s-table-header>{t("Newest signup")}</s-table-header>
                  <s-table-header>{t("Action")}</s-table-header>
                </s-table-header-row>
                <s-table-body>{rows}</s-table-body>
              </s-table>
            </s-section>
          )}
        </>
      ) : (
        <>
          <div className="encore-layout encore-layout--form">
            {/* ================= Main column ================= */}
            <div className="encore-stack">
              <FormCard
                title={t("Notify-me button")}
                sub={t("Shown on sold-out products so shoppers can ask to be told when it's back.")}
                action={<s-badge tone={enabled ? "success" : "auto"}>{enabled ? t("On") : t("Off")}</s-badge>}
              >
                <s-checkbox
                  label={t("Show “Notify me” on out-of-stock products")}
                  details={t("Only when the product isn't in a live preorder — preorder wins.")}
                  checked={flag(enabled)}
                  onChange={(e) => setEnabled(isChecked(e))}
                />
                <s-checkbox
                  label={t("Hide the “Buy it now” button on these products")}
                  checked={flag(hideBuyNow)}
                  onChange={(e) => setHideBuyNow(isChecked(e))}
                />
                <div className="encore-form-grid">
                  <s-text-field label={t("Button text")} value={buttonText} onInput={(e) => setButtonText(val(e))} />
                  <SelectField
                    label={t("Button position")}
                    options={NOTIFY_POSITIONS.map((p) => ({ value: p.value, label: t(p.label) }))}
                    value={position}
                    onChange={setPosition}
                  />
                </div>
                <s-color-field label={t("Button colour (hex)")} value={buttonColor} onInput={(e) => setButtonColor(val(e))} />
              </FormCard>

              <FormCard title={t("Sign-up popup")} sub={t("What shoppers see after tapping the button.")}>
                <s-text-field label={t("Popup title")} value={popupTitle} onInput={(e) => setPopupTitle(val(e))} />
                <s-text-area label={t("Consent text")} value={consentText} rows={2} onInput={(e) => setConsentText(val(e))} />
                <s-checkbox label={t("Also collect phone number (SMS)")} checked={flag(collectPhone)} onChange={(e) => setCollectPhone(isChecked(e))} />
                <s-checkbox label={t("Show product image & title in popup")} checked={flag(showProductInfo)} onChange={(e) => setShowProductInfo(isChecked(e))} />
                <s-checkbox
                  label={t("Require email confirmation (double opt-in)")}
                  details={t("Off = one tap (recommended). On = stricter consent (EU).")}
                  checked={flag(doubleOptIn)}
                  onChange={(e) => setDoubleOptIn(isChecked(e))}
                />
              </FormCard>

              <FormCard title={t("Where subscribers are saved")} sub={t("And who sends the restock email.")}>
                <ChoiceListField
                  label={t("Sync subscribers to")}
                  labelHidden
                  choices={SYNC_CHOICES}
                  selected={[syncTarget]}
                  onChange={(v) => setSyncTarget(v[0] ?? "klaviyo")}
                />
                {syncTarget === "shopify" && (
                  <div className="encore-subpanel">
                    <s-text color="subdued">
                      {t("Shopify Email has no automatic back-in-stock trigger, so we'll send the restock email for you and tag the customer.")}
                    </s-text>
                  </div>
                )}
              </FormCard>

              <Disclosure
                id="bis-more"
                title={t("More options")}
                sub={t("Exclude products by tag or collection.")}
                open={moreOpen}
                onToggle={() => setMoreOpen((o) => !o)}
              >
                <div className="encore-adv__group">
                  <h3 className="encore-adv__title">{t("Exclusions")}</h3>
                  <s-text-field
                    label={t("Exclude products with these tags")}
                    value={excludeTags}
                    onInput={(e) => setExcludeTags(val(e))}
                    details={t("Comma-separated, e.g. archived, discontinued.")}
                  />
                  <CollectionPicker
                    collections={collections}
                    selected={excludeCollections}
                    onChange={setExcludeCollections}
                    label={t("Exclude collections")}
                  />
                  {collections.length === 0 && (
                    <s-text color="subdued" fontSize="small">
                      {t("No collections found in your store.")}
                    </s-text>
                  )}
                </div>
              </Disclosure>
            </div>

            {/* ================= Sidebar ================= */}
            <div className="encore-stack">
              <FormCard
                title={t("Summary")}
                action={<s-badge tone={enabled ? "success" : "auto"}>{enabled ? t("Live") : t("Off")}</s-badge>}
              >
                <div className="encore-checklist">
                  <CheckRow ok={enabled} label={t("Notify-me button")} value={enabled ? t("On") : t("Off")} />
                  <CheckRow ok={syncTarget !== "none"} label={t("Restock email")} value={syncLabel} />
                </div>
                <div className="encore-kv">
                  <KvRow label={t("Position")} value={t(positionLabel)} />
                  <KvRow label={t("Phone number")} value={collectPhone ? t("Collected") : t("Not collected")} />
                  <KvRow label={t("Double opt-in")} value={doubleOptIn ? t("On") : t("Off")} />
                  <KvRow label={t("Exclusions")} value={excludedCount > 0 ? String(excludedCount) : t("None")} />
                </div>
              </FormCard>

              <FormCard title={t("Storefront preview")}>
                <div className="encore-preview" aria-label={t("How the buy box will look on your product page.")}>
                  <div className="encore-preview__media">
                    <span className="encore-preview__ph" aria-hidden="true">
                      <ProductIcon />
                    </span>
                    <span className="encore-preview__badge encore-preview__badge--muted">{t("Sold out")}</span>
                  </div>
                  <div className="encore-preview__body">
                    <span className="encore-preview__title">{t("Aurora Hoodie — Indigo")}</span>
                    <span className="encore-preview__btn" style={{ background: enabled ? buttonColor : "#b5b5b5" }}>
                      {buttonText}
                    </span>
                    {!hideBuyNow && <span className="encore-preview__btn encore-preview__btn--ghost">{t("Buy it now")}</span>}
                  </div>
                </div>
                <div className="encore-popup" aria-hidden="true">
                  <span className="encore-popup__title">{popupTitle}</span>
                  {showProductInfo && (
                    <span className="encore-popup__product">
                      <span className="encore-thumb encore-thumb--empty" style={{ width: 32, height: 32 }}>
                        <ProductIcon />
                      </span>
                      {t("Aurora Hoodie — Indigo")}
                    </span>
                  )}
                  <span className="encore-popup__input">you@email.com</span>
                  {collectPhone && <span className="encore-popup__input">+1 555 000 0000</span>}
                  <span className="encore-preview__btn" style={{ background: buttonColor }}>
                    {buttonText}
                  </span>
                  <span className="encore-preview__note">{consentText}</span>
                </div>
              </FormCard>
            </div>
          </div>

          <ActionBar>
            <s-button onClick={() => setView("subscribers")}>{t("common.cancel")}</s-button>
            {saveButton}
          </ActionBar>
        </>
      )}
    </AppPage>
  );
}
