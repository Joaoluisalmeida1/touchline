"use client";
import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

export type NumberFormat = "int" | "signed" | "dec1" | "dec2" | "eur" | "eurFull" | "pct";

function fmt(v: number, f: NumberFormat): string {
  switch (f) {
    case "dec1": return v.toFixed(1);
    case "dec2": return v.toFixed(2);
    case "signed": { const r = Math.round(v); return r > 0 ? `+${r}` : String(r); }
    case "pct": return `${Math.round(v)}%`;
    case "eurFull": return `${Math.round(v / 100) < 0 ? "−" : ""}€${Math.abs(Math.round(v / 100)).toLocaleString("pt-PT")}`;
    case "eur": {
      const e = v / 100, a = Math.abs(e), sign = Math.round(e) < 0 ? "−" : "";
      return `${sign}€${a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${Math.round(a / 1e3)}k` : Math.round(a)}`;
    }
    default: return String(Math.round(v));
  }
}

/** Counts up to `value` when it scrolls into view, and tweens between values on change (scoreboard style). */
export function AnimatedNumber({ value, format = "int", className, from }: { value: number; format?: NumberFormat; className?: string; from?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef<number>(from ?? 0);
  const inView = useInView(ref, { once: true, margin: "-10% 0px" });
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el || !inView) return;
    if (reduce) { el.textContent = fmt(value, format); last.current = value; return; }
    const ctrl = animate(last.current, value, {
      duration: 0.9, ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { el.textContent = fmt(v, format); },
    });
    last.current = value;
    return () => ctrl.stop();
  }, [value, format, inView, reduce]);
  // server render shows the final value (no layout shift, correct without JS)
  return <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(value, format)}</span>;
}
