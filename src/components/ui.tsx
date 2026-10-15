import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cn(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-line bg-surface/90 p-4 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]", className)} {...rest}>
      {children}
    </section>
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-muted">{children}</h2>
      {action}
    </div>
  );
}

const buttonStyles = {
  primary: "bg-accent text-accent-ink hover:brightness-110 disabled:opacity-50",
  secondary: "border border-line bg-surface-2 text-ink hover:border-faint disabled:opacity-50",
  ghost: "text-muted hover:text-ink hover:bg-surface-2",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
};

export function Button({ variant = "primary", className, ...rest }: ComponentProps<"button"> & { variant?: keyof typeof buttonStyles }) {
  return <button className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition disabled:cursor-not-allowed", buttonStyles[variant], className)} {...rest} />;
}

export function ButtonLink({ variant = "primary", className, ...rest }: ComponentProps<typeof Link> & { variant?: keyof typeof buttonStyles }) {
  return <Link className={cn("inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition", buttonStyles[variant], className)} {...rest} />;
}

export function Badge({ tone = "default", children, className }: { tone?: "default" | "accent" | "warn" | "danger" | "info"; children: ReactNode; className?: string }) {
  const tones = {
    default: "border-line text-muted", accent: "border-accent/40 text-accent", warn: "border-warn/40 text-warn",
    danger: "border-danger/40 text-danger", info: "border-info/40 text-info",
  };
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", tones[tone], className)}>{children}</span>;
}

export function OvrBadge({ ovr, size = "md" }: { ovr: number; size?: "sm" | "md" | "lg" }) {
  const tone = ovr >= 85 ? "bg-amber-300 text-amber-950" : ovr >= 78 ? "bg-emerald-300 text-emerald-950" : ovr >= 70 ? "bg-sky-300 text-sky-950" : ovr >= 62 ? "bg-slate-300 text-slate-900" : "bg-slate-500 text-slate-50";
  const sz = size === "lg" ? "h-14 w-14 text-2xl" : size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  return <span className={cn("inline-flex shrink-0 items-center justify-center rounded-lg font-black tabular", tone, sz)} aria-label={`OVR ${ovr}`}>{ovr}</span>;
}

export function Meter({ value, max = 100, label, tone }: { value: number; max?: number; label: string; tone?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone ?? (pct >= 80 ? "bg-accent" : pct >= 60 ? "bg-warn" : "bg-danger");
  return (
    <div className="flex items-center gap-2" title={`${label}: ${Math.round(value)}`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line" role="meter" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={max}>
        <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-7 text-right text-xs text-muted tabular">{Math.round(value)}</span>
    </div>
  );
}

export function FormArrow({ form }: { form: number }) {
  const f = Number(form);
  const label = f > 0.8 ? "Em grande forma" : f > 0.25 ? "Boa forma" : f < -0.8 ? "Má forma" : f < -0.25 ? "Forma em baixo" : "Forma normal";
  const sym = f > 0.8 ? "▲▲" : f > 0.25 ? "▲" : f < -0.8 ? "▼▼" : f < -0.25 ? "▼" : "▬";
  const color = f > 0.25 ? "text-accent" : f < -0.25 ? "text-danger" : "text-faint";
  return <span className={cn("text-xs font-bold", color)} title={label} aria-label={label}>{sym}</span>;
}

export function ClubDot({ color, className }: { color?: string | null; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/20", className)} style={{ background: color ?? "#64748b" }} aria-hidden />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-8 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "w-full min-h-10 rounded-lg border border-line bg-bg px-3 text-sm text-ink placeholder:text-faint focus:border-info focus:outline-none";

export const POS_LABEL: Record<string, string> = { GK: "GR", DEF: "DEF", MID: "MED", ATT: "AV" };
export const POS_TONE: Record<string, string> = { GK: "text-amber-300", DEF: "text-sky-300", MID: "text-emerald-300", ATT: "text-rose-300" };

export function eur(cents: number | string | null | undefined, compact = true): string {
  if (cents === null || cents === undefined) return "—";
  const v = Number(cents) / 100;
  if (!compact) return `€${Math.round(v).toLocaleString("pt-PT")}`;
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(v / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`;
  return `€${s}`;
}
