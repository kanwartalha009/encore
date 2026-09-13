/**
 * Encore UI primitives — the design layer on top of Polaris.
 * Styles live in app/app.css (loaded by app/routes/app.tsx).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, Card, Text } from "@shopify/polaris";
import { ArrowUpIcon, ArrowDownIcon, ChevronRightIcon } from "@shopify/polaris-icons";

export type TileTone = "violet" | "teal" | "amber" | "rose" | "sky" | "emerald" | "slate";
type IconSource = React.FunctionComponent<React.SVGProps<SVGSVGElement>>;

/** Coloured rounded-square icon tile. */
export function IconTile({
  icon,
  tone = "violet",
  size = "md",
  className = "",
}: {
  icon: IconSource;
  tone?: TileTone;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const Svg = icon;
  return (
    <span
      className={`encore-tile encore-tile--${tone}${size !== "md" ? ` encore-tile--${size}` : ""} ${className}`.trim()}
      aria-hidden="true"
    >
      <Svg />
    </span>
  );
}

/** Staggered fade-up on mount. `index` sets the delay. */
export function Reveal({ index = 0, children, className = "" }: { index?: number; children: ReactNode; className?: string }) {
  return (
    <div className={`encore-reveal ${className}`.trim()} style={{ ["--i" as string]: index }}>
      {children}
    </div>
  );
}

/**
 * Count-up for numeric-looking values ("1,240", "PKR 0", "45%", "US$19.99").
 * Non-numeric strings render as-is. Respects prefers-reduced-motion.
 */
export function useCountUp(value: string, ms = 700): string {
  const [shown, setShown] = useState(value);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const m = /^(.*?)(-?\d[\d,]*)(\.\d+)?(.*)$/.exec(value);
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!m || reduce) {
      setShown(value);
      return;
    }
    const [, pre, intPart, decPart = "", post] = m;
    const target = Number(intPart.replace(/,/g, ""));
    const decimals = decPart ? decPart.length - 1 : 0;
    const from = prev.current ?? 0;
    prev.current = target;
    const useGrouping = intPart.includes(",");
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const n = from + (target - from) * eased;
      const txt = n.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
        useGrouping,
      });
      setShown(`${pre}${txt}${decPart && p >= 1 ? "" : ""}${post}`);
      if (p < 1) raf = requestAnimationFrame(tick);
      else setShown(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/** KPI / stat card with a coloured tile, animated number and a delta pill. */
export function StatCard({
  label,
  value,
  delta,
  deltaTone = "subdued",
  sub,
  icon,
  tone = "violet",
  index = 0,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "success" | "critical" | "subdued";
  sub?: string;
  icon: IconSource;
  tone?: TileTone;
  index?: number;
}) {
  const shown = useCountUp(value);
  const deltaClass =
    deltaTone === "success" ? "encore-delta encore-delta--up" : deltaTone === "critical" ? "encore-delta encore-delta--down" : "encore-delta";
  return (
    <Reveal index={index}>
      <div className="encore-lift" style={{ borderRadius: 12 }}>
        <Card>
          <div className="encore-stat">
            <div className="encore-stat__top">
              <Text as="p" variant="bodySm" tone="subdued">
                {label}
              </Text>
              <IconTile icon={icon} tone={tone} size="sm" />
            </div>
            <div className="encore-stat__value">{shown}</div>
            <div className="encore-stat__foot">
              {delta && delta !== "—" && (
                <span className={deltaClass}>
                  {deltaTone === "success" && <Icon source={ArrowUpIcon} />}
                  {deltaTone === "critical" && <Icon source={ArrowDownIcon} />}
                  {delta}
                </span>
              )}
              {sub && <span>{sub}</span>}
            </div>
          </div>
        </Card>
      </div>
    </Reveal>
  );
}

/** Quick-action tile: icon, title, one-line sub, arrow. */
export function QuickAction({
  icon,
  tone,
  title,
  sub,
  onClick,
  index = 0,
}: {
  icon: IconSource;
  tone: TileTone;
  title: string;
  sub: string;
  onClick: () => void;
  index?: number;
}) {
  return (
    <Reveal index={index}>
      <button type="button" className="encore-quick encore-lift" onClick={onClick}>
        <IconTile icon={icon} tone={tone} />
        <span>
          <span className="encore-quick__title">{title}</span>
          <span className="encore-quick__sub" style={{ display: "block" }}>
            {sub}
          </span>
        </span>
        <span className="encore-quick__arrow">
          <Icon source={ChevronRightIcon} />
        </span>
      </button>
    </Reveal>
  );
}

/** Card section heading with a coloured tile. */
export function SectionHead({
  icon,
  tone,
  title,
  sub,
  action,
}: {
  icon: IconSource;
  tone: TileTone;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="encore-section-head" style={{ justifyContent: "space-between" }}>
      <div className="encore-section-head">
        <IconTile icon={icon} tone={tone} size="sm" />
        <div className="encore-section-head__text">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          {sub && (
            <Text as="p" variant="bodySm" tone="subdued">
              {sub}
            </Text>
          )}
        </div>
      </div>
      {action}
    </div>
  );
}

/** Conic progress ring with a percentage label. */
export function ProgressRing({ percent, tone = "violet" }: { percent: number; tone?: TileTone }) {
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  const ring = `var(--tile-${tone}-fg)`;
  return (
    <div className="encore-ring" style={{ ["--p" as string]: p, ["--ring" as string]: ring, position: "relative" }} aria-label={`${p}%`}>
      <span>{p}%</span>
    </div>
  );
}

/** Hero header for the dashboard. */
export function Hero({
  eyebrow,
  title,
  sub,
  actions,
  stats,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  actions: ReactNode;
  stats: { value: string; label: string }[];
}) {
  return (
    <Reveal>
      <section className="encore-hero">
        <div className="encore-hero__grid">
          <div>
            <div className="encore-hero__eyebrow">{eyebrow}</div>
            <h1 className="encore-hero__title">{title}</h1>
            <p className="encore-hero__sub">{sub}</p>
            <div className="encore-hero__actions">{actions}</div>
          </div>
          <div className="encore-hero__stats">
            {stats.map((s) => (
              <HeroStat key={s.label} value={s.value} label={s.label} />
            ))}
          </div>
        </div>
      </section>
    </Reveal>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  const shown = useCountUp(value);
  return (
    <div className="encore-hero__stat">
      <b>{shown}</b>
      <span>{label}</span>
    </div>
  );
}

export function HeroButton({
  children,
  primary,
  icon,
  onClick,
}: {
  children: ReactNode;
  primary?: boolean;
  icon?: IconSource;
  onClick: () => void;
}) {
  const Svg = icon;
  return (
    <button type="button" className={`encore-hero__btn${primary ? " encore-hero__btn--primary" : ""}`} onClick={onClick}>
      {Svg && <Svg />}
      {children}
    </button>
  );
}
