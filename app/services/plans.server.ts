/**
 * Plan catalog — the source of truth is the **Nova platform** (`AppPlan` rows,
 * CRUD-editable in the Nova admin). Encore fetches them so pricing + limits change
 * without an app deploy. A baked-in fallback (kept in sync with the Nova seed)
 * keeps the app working if Nova is unreachable.
 *
 * Contract: GET {NOVA_API}/v1/apps/encore/plans
 *   → { plans: [{ code, name, amountMonthly, amountAnnual, currency, trialDays,
 *                 preorderLimit, notifyLimit }] }   (amounts in minor units; limit null = unlimited)
 */
const NOVA_API = process.env.NOVA_API ?? "";
const APP_SLUG = "encore";

export type Plan = {
  code: string; // basic | growth | scale
  name: string;
  amountMonthly: number; // minor units (cents)
  amountAnnual: number; // minor units (cents) — yearly (20% off baked in)
  currency: string;
  trialDays: number;
  preorderLimit: number | null; // null = unlimited
  notifyLimit: number | null;
};

// Mirrors the Nova seed; Nova overrides these at runtime.
const FALLBACK: Plan[] = [
  { code: "basic", name: "Basic", amountMonthly: 1999, amountAnnual: 19190, currency: "USD", trialDays: 14, preorderLimit: 100, notifyLimit: 500 },
  { code: "growth", name: "Growth", amountMonthly: 4999, amountAnnual: 47990, currency: "USD", trialDays: 14, preorderLimit: 1000, notifyLimit: 5000 },
  { code: "scale", name: "Scale", amountMonthly: 12999, amountAnnual: 124790, currency: "USD", trialDays: 0, preorderLimit: null, notifyLimit: null },
];

let cache: { at: number; plans: Plan[] } | null = null;
const TTL = 5 * 60 * 1000;

function normalize(p: Partial<Plan>): Plan | null {
  if (!p.code || !p.name) return null;
  const monthly = Number(p.amountMonthly ?? 0);
  return {
    code: String(p.code),
    name: String(p.name),
    amountMonthly: monthly,
    amountAnnual: Number(p.amountAnnual ?? Math.round(monthly * 12 * 0.8)),
    currency: String(p.currency ?? "USD"),
    trialDays: Number(p.trialDays ?? 0),
    preorderLimit: p.preorderLimit == null ? null : Number(p.preorderLimit),
    notifyLimit: p.notifyLimit == null ? null : Number(p.notifyLimit),
  };
}

export async function getPlans(): Promise<Plan[]> {
  if (cache && Date.now() - cache.at < TTL) return cache.plans;
  if (NOVA_API) {
    try {
      const res = await fetch(`${NOVA_API}/v1/apps/${APP_SLUG}/plans`, {
        headers: { accept: "application/json" },
      });
      if (res.ok) {
        const body = (await res.json()) as { plans?: Partial<Plan>[] };
        const plans = (body.plans ?? [])
          .map(normalize)
          .filter((p): p is Plan => p !== null);
        if (plans.length) {
          cache = { at: Date.now(), plans };
          return plans;
        }
      }
    } catch (e) {
      console.error("[plans] fetch from Nova failed; using fallback", e);
    }
  }
  cache = { at: Date.now(), plans: FALLBACK };
  return FALLBACK;
}

export async function getPlan(code: string): Promise<Plan | null> {
  return (await getPlans()).find((p) => p.code === code) ?? null;
}

// Per-store comp/discount from Nova (Installation.planOverride). Best-effort.
export type PlanOverride = { type: "NONE" | "FREE" | "PERCENT" | "FIXED"; value: number };

export async function getPlanOverride(shop: string): Promise<PlanOverride> {
  if (!NOVA_API) return { type: "NONE", value: 0 };
  try {
    const res = await fetch(
      `${NOVA_API}/v1/apps/${APP_SLUG}/installations/${encodeURIComponent(shop)}/plan-override`,
      { headers: { accept: "application/json" } },
    );
    if (res.ok) {
      const b = (await res.json()) as { type?: string; value?: number };
      const type =
        b.type === "FREE" || b.type === "PERCENT" || b.type === "FIXED" ? b.type : "NONE";
      return { type, value: Number(b.value ?? 0) };
    }
  } catch {
    /* ignore — default to no override */
  }
  return { type: "NONE", value: 0 };
}
