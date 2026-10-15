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
        "surface relative rounded-[var(--radius-card)] p-4 sm:p-5",
        interactive && "transition duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_18px_40px_-24px_rgb(0_0_0/.9)]",
        glow && "border-accent/30 shadow-[0_0_0_1px_rgb(212_255_58/.08),0_20px_60px_-30px_rgb(212_255_58/.35)]",
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
      <h2 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-muted">
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
  primary: "bg-accent text-accent-ink shadow-[0_8px_24px_-10px_rgb(212_255_58/.65),inset_0_1px_0_rgb(255_255_255/.45)] hover:brightness-105 disabled:opacity-40 disabled:shadow-none",
  secondary: "border border-line-strong bg-surface-2 text-ink hover:border-faint hover:bg-surface-3 disabled:opacity-40",
  ghost: "text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-40",
  danger: "border border-danger/40 bg-danger/5 text-danger hover:bg-danger/15 disabled:opacity-40",
};
const buttonBase =
  "group/btn relative inline-flex min-h-10 select-none items-center justify-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-bold tracking-tight transition-[transform,filter,background-color,border-color,box-shadow] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100";

/** Light sweep across primary buttons on hover (Watermelon "Shimmer Button"). */
function Sheen({ variant }: { variant: keyof typeof buttonStyles }) {
  if (variant !== "primary") return null;
  return <span aria-hidden className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 group-hover/btn:translate-x-full" />;
}

export function Button({ variant = "primary", className, children, ...rest }: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return (
    <button className={cn(buttonBase, buttonStyles[variant], className)} {...rest}>
      <Sheen variant={variant} />
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", className, children, ...rest }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return (
    <Link className={cn(buttonBase, buttonStyles[variant], className)} {...rest}>
      <Sheen variant={variant} />
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
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]", tones[tone], className)}>
      {dot && <span className={cn("size-1.5 rounded-full bg-current", tone === "accent" && "animate-pulse-dot")} />}
      {children}
    </span>
  );
}

export function ovrTier(ovr: number) {
  return ovr >= 85 ? "gold" : ovr >= 78 ? "lime" : ovr >= 70 ? "cyan" : ovr >= 62 ? "steel" : "low";
}
const OVR_TONE = {
  gold: "bg-[linear-gradient(160deg,#fff1b8,#ffcc4d_45%,#e09a1f)] text-[#2a1a00]",
  lime: "bg-[linear-gradient(160deg,#f1ffb8,#d4ff3a_45%,#93cc0c)] text-[#132000]",
  cyan: "bg-[linear-gradient(160deg,#d2f4ff,#7fdcff_45%,#35a9d9)] text-[#00202e]",
  steel: "bg-[linear-gradient(160deg,#eef1f5,#c3cad3_45%,#8f99a6)] text-[#141a22]",
  low: "bg-[linear-gradient(160deg,#6b7480,#4a525d)] text-white",
} as const;

export function OvrBadge({ ovr, size = "md", className }: { ovr: number; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const sz = size === "xl" ? "h-20 w-[4.5rem] text-5xl rounded-2xl" : size === "lg" ? "h-14 w-14 text-3xl rounded-xl" : size === "sm" ? "h-7 w-7 text-sm rounded-md" : "h-9 w-9 text-lg rounded-lg";
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center font-display font-extrabold leading-none tabular shadow-[inset_0_1px_0_rgb(255_255_255/.6),0_6px_16px_-8px_rgb(0_0_0/.8)]", OVR_TONE[ovrTier(ovr)], sz, className)}
      aria-label={`OVR ${ovr}`}>
      {ovr}
    </span>
  );
}

export function Meter({ value, max = 100, label, tone }: { value: number; max?: number; label: string; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone ?? (pct >= 80 ? "bg-accent" : pct >= 60 ? "bg-warn" : "bg-danger");
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
  const color = f > 0.8 ? "text-accent" : f > 0.25 ? "text-accent/80" : f < -0.8 ? "text-danger" : f < -0.25 ? "text-danger/80" : "text-faint";
  return <span className={cn("inline-flex align-middle", color)} title={label} aria-label={label}><Icon className="size-4" strokeWidth={2.5} /></span>;
}

/** W/D/L pills (data uses W/D/L, UI shows V/E/D). */
export function FormStrip({ form, size = "md" }: { form: string; size?: "sm" | "md" }) {
  return (
    <span className="inline-flex gap-1">
      {form.split("").map((c, k) => (
        <span key={k} className={cn("inline-flex items-center justify-center rounded-[5px] font-display font-bold", size === "sm" ? "h-4 w-4 text-[10px]" : "h-5 w-5 text-[11px]",
          c === "W" ? "bg-accent text-accent-ink" : c === "D" ? "bg-surface-3 text-muted ring-1 ring-line-strong" : "bg-danger text-white")}>
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
    <div className={cn("rounded-2xl border border-line bg-bg/50 p-3", className)}>
      <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{label}</p>
      <p className={cn("mt-1 font-display text-3xl font-extrabold leading-none tabular", tone === "accent" ? "text-accent" : tone === "danger" ? "text-danger" : "text-ink")}>{children}</p>
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
  "w-full min-h-11 rounded-xl border border-line bg-bg/80 px-3.5 text-sm font-medium text-ink placeholder:text-faint transition focus:border-accent/60 focus:bg-bg focus:outline-none focus:ring-4 focus:ring-accent/10 disabled:opacity-50";

/* ------------------------------------------------------------------ football helpers */

export const POS_LABEL: Record<string, string> = { GK: "GR", DEF: "DEF", MID: "MED", ATT: "AV" };
export const POS_TONE: Record<string, string> = { GK: "text-amber-300", DEF: "text-sky-300", MID: "text-emerald-300", ATT: "text-rose-300" };
export const POS_PILL: Record<string, string> = {
  GK: "bg-amber-300/10 text-amber-300 ring-amber-300/30", DEF: "bg-sky-300/10 text-sky-300 ring-sky-300/30",
  MID: "bg-emerald-300/10 text-emerald-300 ring-emerald-300/30", ATT: "bg-rose-300/10 text-rose-300 ring-rose-300/30",
};

export function eur(cents: number | string | null | undefined, compact = true): string {
  if (cents === null || cents === undefined) return "—";
  const v = Number(cents) / 100;
  if (!compact) return `€${Math.round(v).toLocaleString("pt-PT")}`;
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`;
  return `€${s}`;
}
