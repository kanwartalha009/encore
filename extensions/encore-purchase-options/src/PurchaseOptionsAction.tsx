/**
 * Purchase options card action (product + variant pages).
 *
 * API 2026-07 (Preact + Polaris web components). `shopify.data.selected[0]`
 * carries the product or variant GID; `sellingPlanId` is present when the
 * merchant opened an existing Encore purchase option (edit flow).
 *
 * All reads/writes go through the app's /api/purchase-options route: a
 * relative fetch() resolves against the app's application_url and Shopify adds
 * the ID-token Authorization header automatically. The backend edits the Encore
 * preorder and runs the app's own selling-plan / cap / continue-selling sync —
 * this extension never writes selling plans directly.
 */
import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";

const ENDPOINT = "/api/purchase-options";

export default async () => {
  render(<Extension />, document.body);
};

type Payment = "PAY_NOW" | "DEPOSIT" | "PAY_LATER";
type When = "now" | "oos" | "date";

type Summary = {
  id: string;
  name: string;
  status: string;
  paymentMode: Payment;
  depositKind: "PERCENT" | "FIXED";
  depositPct: number | null;
  shipDate: string | null;
  productCount: number;
};

type View = {
  ok: true;
  target: { productId: string; variantId: string | null; productTitle: string; variantTitle: string | null };
  current: Summary | null;
  matchedBy: "sellingPlan" | "product" | null;
  campaigns: Summary[];
  defaults: { name: string; paymentMode: Payment; depositPct: number };
};

type Result = { ok: true; campaign: Summary; warning?: string; emptied?: boolean };
type Failure = { ok: false; error: string };

const KNOWN_ERRORS = new Set([
  "invalid_target",
  "target_not_found",
  "campaign_not_found",
  "campaign_not_editable",
  "invalid_campaign",
  "name_required",
  "name_too_long",
  "start_date_required",
  "invalid_date",
  "ship_date_past",
  "deposit_pct_range",
  "nothing_to_update",
  "invalid_status",
  "catalog_missing",
  "plan_required",
]);

function Extension() {
  const t = (key: string, vars?: Record<string, unknown>) =>
    String(shopify.i18n.translate(key, vars as never));
  const errorText = (code: string) => t(KNOWN_ERRORS.has(code) ? `errors.${code}` : "errors.generic");

  const selected = shopify.data.selected[0];
  const resourceId = selected?.id ?? "";
  const sellingPlanId = selected?.sellingPlanId ?? null;
  const isVariant = resourceId.includes("/ProductVariant/");
  const targetBody: Record<string, string> = isVariant ? { variantId: resourceId } : { productId: resourceId };

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "warning"; text: string; campaignId?: string } | null>(
    null,
  );

  // Create-flow fields
  const [mode, setMode] = useState<"existing" | "new">("new");
  const [campaignId, setCampaignId] = useState("");
  const [name, setName] = useState("");
  const [when, setWhen] = useState<When>("now");
  const [startDate, setStartDate] = useState("");
  const [payment, setPayment] = useState<Payment>("PAY_NOW");
  const [depositPct, setDepositPct] = useState("20");
  const [shipDate, setShipDate] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams(targetBody);
      if (sellingPlanId) qs.set("sellingPlanId", sellingPlanId);
      const res = await fetch(`${ENDPOINT}?${qs.toString()}`);
      const data = (await res.json()) as View | Failure;
      if (!data.ok) {
        setError(errorText(data.error));
        return;
      }
      setView(data);
      // Localized default name; the server's English default is only a fallback.
      const localized = t("add.defaultName", { product: data.target.productTitle }).slice(0, 120);
      setName(localized && !localized.includes("add.defaultName") ? localized : data.defaults.name);
      setPayment(data.current?.paymentMode ?? data.defaults.paymentMode);
      setDepositPct(String(data.current?.depositPct ?? data.defaults.depositPct));
      setShipDate(data.current?.shipDate ?? "");
      if (data.campaigns.length) {
        setCampaignId(data.campaigns[0].id);
        setMode("existing");
      }
    } catch {
      setError(t("errors.network"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!resourceId) {
      setError(t("errors.invalid_target"));
      setLoading(false);
      return;
    }
    void load();
  }, []);

  const post = async (label: string, body: Record<string, unknown>): Promise<Result | null> => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as Result | Failure;
      if (!data.ok) {
        setError(errorText(data.error));
        return null;
      }
      return data;
    } catch {
      setError(t("errors.network"));
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** Close on success unless the merchant needs to read something first. */
  const finish = (r: Result) => {
    if (r.warning === "selling_plan_failed") {
      setNotice({ tone: "warning", text: t("notice.syncFailed"), campaignId: r.campaign.id });
      return;
    }
    if (r.campaign.status === "DRAFT") {
      setNotice({ tone: "success", text: t("notice.draft"), campaignId: r.campaign.id });
      return;
    }
    shopify.close();
  };

  const current = view?.current ?? null;

  const statusLabel = (s: string) => t(`status.${s.toLowerCase()}`);
  const statusTone = (s: string) =>
    s === "LIVE" ? "success" : s === "SCHEDULED" ? "info" : s === "PAUSED" ? "warning" : "neutral";

  // A fixed-amount deposit is edited in Encore; the % field is hidden for it.
  const fixedDeposit = !!current && current.paymentMode === "DEPOSIT" && current.depositKind === "FIXED";
  const paymentChanged =
    !!current &&
    (payment !== current.paymentMode ||
      (payment === "DEPOSIT" && !fixedDeposit && Number(depositPct) !== current.depositPct));
  const shipChanged = !!current && shipDate !== (current.shipDate ?? "");

  const saveCreate = async () => {
    if (!view) return;
    const r =
      mode === "existing" && campaignId
        ? await post("save", { action: "attach", campaignId, target: targetBody })
        : await post("save", {
            action: "create",
            target: targetBody,
            name,
            when,
            startDate: when === "date" ? startDate : null,
            payment,
            depositPct: payment === "DEPOSIT" ? Number(depositPct) : null,
            shipDate: shipDate || null,
            locale: typeof navigator !== "undefined" ? navigator.language : null,
          });
    if (r) finish(r);
  };

  const saveEdit = async () => {
    if (!current) return;
    const body: Record<string, unknown> = { action: "update", campaignId: current.id };
    if (paymentChanged) {
      body.payment = payment;
      if (payment === "DEPOSIT") body.depositPct = Number(depositPct);
    }
    if (shipChanged) body.shipDate = shipDate || null;
    if (!("payment" in body) && !("shipDate" in body)) {
      shopify.close();
      return;
    }
    const r = await post("save", body);
    if (r) finish(r);
  };

  const setStatus = async (action: "pause" | "resume") => {
    if (!current) return;
    const r = await post(action, { action, campaignId: current.id });
    if (r) finish(r);
  };

  const remove = async () => {
    if (!current) return;
    if (!confirmRemove) {
      setConfirmRemove(true);
      return;
    }
    const r = await post("remove", { action: "detach", campaignId: current.id, target: targetBody });
    setConfirmRemove(false);
    if (!r) return;
    if (r.warning === "selling_plan_failed") finish(r);
    else shopify.close();
  };

  const createValid = useMemo(() => {
    if (mode === "existing") return !!campaignId;
    if (!name.trim()) return false;
    if (when === "date" && !startDate) return false;
    if (payment === "DEPOSIT") {
      const n = Number(depositPct);
      if (!Number.isFinite(n) || n < 1 || n > 99) return false;
    }
    return true;
  }, [mode, campaignId, name, when, startDate, payment, depositPct]);

  const productLabel = view
    ? view.target.variantTitle
      ? `${view.target.productTitle} — ${view.target.variantTitle}`
      : view.target.productTitle
    : "";

  const heading = current ? t("heading.manage") : t("heading.add");
  const openLink = (id: string) => <s-link href={`app:app/campaigns/${id}`}>{t("openInEncore")}</s-link>;

  // ---- Payment fields (shared by create + edit) ----
  const paymentFields = (
    <>
      <s-select
        label={t("fields.payment")}
        value={payment}
        onChange={(e) => setPayment(e.currentTarget.value as Payment)}
      >
        <s-option value="PAY_NOW">{t("payment.payNow")}</s-option>
        <s-option value="DEPOSIT">{t("payment.deposit")}</s-option>
        <s-option value="PAY_LATER">{t("payment.payLater")}</s-option>
      </s-select>
      {payment === "DEPOSIT" &&
        (fixedDeposit ? (
          <s-text color="subdued">{t("payment.fixedDepositNote")}</s-text>
        ) : (
          <s-number-field
            label={t("fields.depositPct")}
            value={depositPct}
            min={1}
            max={99}
            suffix="%"
            onChange={(e) => setDepositPct(e.currentTarget.value)}
          />
        ))}
      {payment !== "PAY_NOW" && <s-text color="subdued">{t("payment.deferredHint")}</s-text>}
    </>
  );

  const shipField = (
    <s-date-field
      label={t("fields.shipDate")}
      details={t("fields.shipDateHelp")}
      value={shipDate}
      onChange={(e) => setShipDate(e.currentTarget.value)}
    />
  );

  let body;
  if (loading) {
    body = (
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-spinner accessibilityLabel={t("loading")} />
        <s-text>{t("loading")}</s-text>
      </s-stack>
    );
  } else if (!view) {
    body = <s-button onClick={() => void load()}>{t("retry")}</s-button>;
  } else if (notice) {
    body = (
      <s-stack direction="block" gap="base">
        <s-banner tone={notice.tone}>{notice.text}</s-banner>
        {notice.campaignId && openLink(notice.campaignId)}
      </s-stack>
    );
  } else if (current) {
    body = (
      <s-stack direction="block" gap="base">
        {view.matchedBy === "product" && !sellingPlanId && (
          <s-banner tone="info">{t("manage.alreadyOnPreorder", { product: productLabel })}</s-banner>
        )}
        <s-stack direction="inline" gap="small-100" alignItems="center">
          <s-heading>{current.name}</s-heading>
          <s-badge tone={statusTone(current.status)}>{statusLabel(current.status)}</s-badge>
        </s-stack>
        <s-text color="subdued">{t("manage.productsCount", { count: current.productCount })}</s-text>
        {paymentFields}
        {shipField}
        <s-stack direction="inline" gap="base">
          {(current.status === "LIVE" || current.status === "SCHEDULED") && (
            <s-button onClick={() => void setStatus("pause")} loading={busy === "pause"} disabled={!!busy}>
              {t("manage.pause")}
            </s-button>
          )}
          {current.status === "PAUSED" && (
            <s-button onClick={() => void setStatus("resume")} loading={busy === "resume"} disabled={!!busy}>
              {t("manage.resume")}
            </s-button>
          )}
          <s-button tone="critical" onClick={() => void remove()} loading={busy === "remove"} disabled={!!busy}>
            {confirmRemove ? t("manage.removeConfirm") : isVariant ? t("manage.removeVariant") : t("manage.removeProduct")}
          </s-button>
        </s-stack>
        {openLink(current.id)}
      </s-stack>
    );
  } else {
    body = (
      <s-stack direction="block" gap="base">
        {sellingPlanId && <s-banner tone="warning">{t("errors.planNotFound")}</s-banner>}
        <s-text>{t("add.intro", { product: productLabel })}</s-text>
        {view.campaigns.length > 0 && (
          <s-select
            label={t("fields.mode")}
            value={mode}
            onChange={(e) => setMode(e.currentTarget.value as "existing" | "new")}
          >
            <s-option value="existing">{t("add.modeExisting")}</s-option>
            <s-option value="new">{t("add.modeNew")}</s-option>
          </s-select>
        )}
        {mode === "existing" && view.campaigns.length > 0 ? (
          <s-select
            label={t("fields.preorder")}
            value={campaignId}
            onChange={(e) => setCampaignId(e.currentTarget.value)}
          >
            {view.campaigns.map((c) => (
              <s-option key={c.id} value={c.id}>{`${c.name} (${statusLabel(c.status)})`}</s-option>
            ))}
          </s-select>
        ) : (
          <>
            <s-text-field
              label={t("fields.name")}
              value={name}
              maxLength={120}
              required
              onInput={(e) => setName(e.currentTarget.value)}
            />
            <s-select
              label={t("fields.when")}
              value={when}
              onChange={(e) => setWhen(e.currentTarget.value as When)}
            >
              <s-option value="now">{t("when.now")}</s-option>
              <s-option value="oos">{t("when.oos")}</s-option>
              <s-option value="date">{t("when.date")}</s-option>
            </s-select>
            {when === "date" && (
              <s-date-field
                label={t("fields.startDate")}
                value={startDate}
                required
                onChange={(e) => setStartDate(e.currentTarget.value)}
              />
            )}
            {paymentFields}
            {shipField}
          </>
        )}
      </s-stack>
    );
  }

  const done = !!notice || (!loading && !view);
  const primary = done ? (
    <s-button slot="primary-action" variant="primary" onClick={() => shopify.close()}>
      {t("done")}
    </s-button>
  ) : current ? (
    <s-button
      slot="primary-action"
      variant="primary"
      onClick={() => void saveEdit()}
      loading={busy === "save"}
      disabled={loading || !!busy || (!paymentChanged && !shipChanged)}
    >
      {t("saveChanges")}
    </s-button>
  ) : (
    <s-button
      slot="primary-action"
      variant="primary"
      onClick={() => void saveCreate()}
      loading={busy === "save"}
      disabled={loading || !!busy || !createValid}
    >
      {mode === "existing" && view?.campaigns.length ? t("add.saveExisting") : t("add.saveNew")}
    </s-button>
  );

  return (
    <s-admin-action heading={heading} loading={loading}>
      <s-stack direction="block" gap="base">
        {error && <s-banner tone="critical">{error}</s-banner>}
        {body}
      </s-stack>
      {primary}
      {!done && (
        <s-button slot="secondary-actions" onClick={() => shopify.close()} disabled={!!busy}>
          {t("cancel")}
        </s-button>
      )}
    </s-admin-action>
  );
}
