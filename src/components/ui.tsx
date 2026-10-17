import Link from "next/link";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ surfaces */

export function Card({ className, children, interactive, glow, ...rest }: ComponentProps<"section"> & { interactive?: boolean; glow?: boolean }) {
  return (
    <section
      className={cn(
        "surface relative min-w-0 rounded-[var(--radius-card)] p-4 sm:p-5",
        interactive && "transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[var(--tl-shadow)]",
        glow && "border-accent/30",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

export function CardTitle({ children, action, icon }: { children: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.14em] text-muted">
        {icon ? <span className="text-accent [&_svg]:size-3.5">{icon}</span> : <span aria-hidden className="h-[3px] w-2.5 rounded-full bg-accent" />}
        {children}
      </h2>
      {action}
    </div>
  );
}

/** Big broadcast-style page/section title. */
export function Headline({ children, kicker, className, as: H = "h1" }: { children: ReactNode; kicker?: ReactNode; className?: string; as?: "h1" | "h2" }) {
  return (
    <div className={className}>
      {kicker && <p className="eyebrow mb-2">{kicker}</p>}
      <H className="headline text-4xl text-ink sm:text-5xl">{children}</H>
    </div>
  );
}

/* ------------------------------------------------------------------ buttons */

const buttonStyles = {
  primary: "bg-accent text-accent-ink hover:brightness-110 disabled:opacity-40",
  secondary: "border border-line-strong bg-surface-2 text-ink hover:border-faint hover:bg-surface-3 disabled:opacity-40",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40",
  danger: "border border-danger/40 bg-danger/5 text-danger hover:bg-danger/15 disabled:opacity-40",
};
const buttonBase =
  "group/btn relative inline-flex min-h-10 select-none items-center justify-center gap-2 overflow-hidden rounded-[10px] px-4 text-sm font-bold tracking-tight transition-[transform,filter,background-color,border-color,box-shadow] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100";


export function Button({ variant = "primary", className, children, ...rest }: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button className={cn(buttonBase, buttonStyles[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", className, children, ...rest }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return (
    <Link className={cn(buttonBase, buttonStyles[variant], className)} {...rest}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ chips */

export function Badge({ tone = "default", children, className, dot }: { tone?: "default" | "accent" | "warn" | "danger" | "info"; children: ReactNode; className?: string; dot?: boolean }) {
  const tones = {
    default: "border-line-strong bg-surface-2 text-muted", accent: "border-accent/35 bg-accent/10 text-accent", warn: "border-warn/35 bg-warn/10 text-warn",
    danger: "border-danger/35 bg-danger/10 text-danger", info: "border-info/35 bg-info/10 text-info",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.08em]", tones[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full bg-current", tone === "accent" && "animate-pulse-dot")} />}
      {children}
    </span>
  );
}

export function ovrTier(ovr: number) {
  return ovr >= 85 ? "gold" : ovr >= 78 ? "silver" : ovr >= 70 ? "bronze" : ovr >= 62 ? "steel" : "low";
}
/** Flat editorial tiers: ink block with a coloured tier rule underneath (no foil, no glow). */
const OVR_TONE = {
  gold: "bg-ink text-bg shadow-[inset_0_-4px_0_#e8b931]",
  silver: "bg-ink text-bg shadow-[inset_0_-4px_0_#b9c0c8]",
  bronze: "bg-ink text-bg shadow-[inset_0_-4px_0_#c27a46]",
  steel: "bg-surface-3 text-ink shadow-[inset_0_-4px_0_var(--color-line-strong)]",
  low: "bg-surface-2 text-muted ring-1 ring-line-strong",
} as const;

export function OvrBadge({ ovr, size = "md", className }: { ovr: number; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const sz = size === "xl" ? "h-20 w-[4.5rem] text-5xl rounded-2xl" : size === "lg" ? "h-14 w-14 text-3xl rounded-xl" : size === "sm" ? "h-7 w-7 text-sm rounded-md" : "h-9 w-9 text-lg rounded-lg";
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center pb-0.5 font-display font-black leading-none tabular", OVR_TONE[ovrTier(ovr)], sz, className)}
      aria-label={`OVR ${ovr}`}>
      {ovr}
    </span>
  );
}

export function Meter({ value, max = 100, label, tone }: { value: number; max?: number; label: string; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone ?? (pct >= 80 ? "bg-up" : pct >= 60 ? "bg-warn" : "bg-danger");
  return (
    <div className="flex items-center gap-2" title={`${label}: ${Math.round(value)}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line" role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
        <div className={cn("h-full rounded-full transition-[width] duration-700", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 text-right text-xs font-semibold text-muted tabular">{Math.round(value)}</span>
    </div>
  );
}

export function FormArrow({ form }: { form: number }) {
  const f = Number(form);
  const label = f > 0.8 ? "Em grande forma" : f > 0.25 ? "Boa forma" : f < -0.8 ? "Má forma" : f < -0.25 ? "Forma em baixo" : "Forma normal";
  const Icon = f > 0.25 ? TrendingUp : f < -0.25 ? TrendingDown : Minus;
  const color = f > 0.8 ? "text-up" : f > 0.25 ? "text-up/80" : f < -0.8 ? "text-danger" : f < -0.25 ? "text-danger/80" : "text-faint";
  return <span className={cn("inline-flex align-middle", color)} title={label} aria-label={label}><Icon className="size-4" strokeWidth={2.5} /></span>;
}

/** W/D/L pills (data uses W/D/L, UI shows V/E/D). */
export function FormStrip({ form, size = "md" }: { form: string; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex gap-1">
      {form.split("").map((c, k) => (
        <span key={k} className={cn("inline-flex items-center justify-center rounded-[5px] font-display font-bold", size === "sm" ? "h-4 w-4 text-[10px]" : "h-5 w-5 text-[11px]",
          c === "W" ? "bg-up text-bg" : c === "D" ? "bg-surface-3 text-muted ring-1 ring-line-strong" : "bg-danger text-bg")}>
          {c === "W" ? "V" : c === "D" ? "E" : "D"}
        </span>
      ))}
    </span>
  );
}

export function ClubDot({ color, className }: { color?: string | null; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-[3px] ring-1 ring-white/25", className)} style={{ background: color ?? "#64748b" }} aria-hidden />;
}

export function PosPill({ group, label, className }: { group: string; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex min-w-8 items-center justify-center rounded-md px-1.5 py-px font-display text-[11px] font-bold uppercase tracking-wide ring-1", POS_PILL[group] ?? POS_PILL.MID, className)}>
      {label ?? POS_LABEL[group] ?? group}
    </span>
  );
}

/** KPI tile: small label, big condensed number. */
export function Stat({ label, children, hint, className, tone }: { label: ReactNode; children: ReactNode; hint?: ReactNode; className?: string; tone?: "accent" | "danger" }) {
  return (
    <div className={cn("rounded-xl border border-line bg-bg/50 p-3", className)}>
      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={cn("mt-1 font-display text-3xl font-black leading-none tabular", tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : "text-ink")}>{children}</p>
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface/40 px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-2xl bg-surface-2 text-accent ring-1 ring-line [&_svg]:size-5">{icon}</div>}
      <p className="font-display text-xl font-bold uppercase tracking-tight">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs leading-5 text-faint">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full min-h-11 rounded-[10px] border border-line-strong bg-bg/80 px-3.5 text-sm font-medium text-ink placeholder:text-faint transition focus:border-accent/60 focus:bg-bg focus:outline-none focus:ring-4 focus:ring-accent/10 disabled:opacity-50";

/* ------------------------------------------------------------------ football helpers */

export const POS_LABEL: Record<string, string> = { GK: "GR", DEF: "DEF", MID: "MED", ATT: "AV" };
export const POS_TONE: Record<string, string> = {
  GK: "text-amber-700 dark:text-amber-300", DEF: "text-sky-700 dark:text-sky-300", MID: "text-emerald-700 dark:text-emerald-300", ATT: "text-rose-700 dark:text-rose-300",
};
export const POS_PILL: Record<string, string> = {
  GK: "bg-amber-500/10 text-amber-800 ring-amber-600/30 dark:text-amber-300 dark:ring-amber-300/30",
  DEF: "bg-sky-500/10 text-sky-800 ring-sky-600/30 dark:text-sky-300 dark:ring-sky-300/30",
  MID: "bg-emerald-500/10 text-emerald-800 ring-emerald-600/30 dark:text-emerald-300 dark:ring-emerald-300/30",
  ATT: "bg-rose-500/10 text-rose-800 ring-rose-600/30 dark:text-rose-300 dark:ring-rose-300/30",
};

export function eur(cents: number | string | null | undefined, compact = true): string {
  if (cents === null || cents === undefined) return "—";
  const v = Number(cents) / 100;
  if (!compact) return `€${Math.round(v).toLocaleString("pt-PT")}`;
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`;
  return `€${s}`;
}
