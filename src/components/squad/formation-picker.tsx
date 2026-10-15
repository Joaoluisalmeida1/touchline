"use client";
import { useEffect, useRef, useState } from "react";
import { FORMATIONS, type Formation } from "@/engine/common/types";
import { SLOT_GROUP, slotCoordinates } from "@/engine/lineup/formations";
import { cn } from "../ui";

const GROUPS: { label: string; match: (f: Formation) => boolean }[] = [
  { label: "Linha de 4", match: (f) => f.startsWith("4") },
  { label: "Linha de 3", match: (f) => f.startsWith("3") },
  { label: "Linha de 5", match: (f) => f.startsWith("5") },
];
const DOT: Record<string, string> = { GK: "#fbbf24", DEF: "#38bdf8", MID: "#34d399", ATT: "#fb7185" };

export function FormationThumb({ f, size = 56 }: { f: Formation; size?: number }) {
  return (
    <svg viewBox="0 0 60 80" width={size} height={(size * 80) / 60} aria-hidden>
      <rect x="1" y="1" width="58" height="78" rx="4" fill="#0f3d2a" stroke="rgba(255,255,255,.25)" />
      <line x1="1" y1="40" x2="59" y2="40" stroke="rgba(255,255,255,.2)" />
      {slotCoordinates(f).map((c, i) => (
        <circle key={i} cx={2 + (c.x / 100) * 56} cy={78 - (c.y / 100) * 74} r="3.2" fill={DOT[SLOT_GROUP[c.slot]]} />
      ))}
    </svg>
  );
}

export function FormationPicker({ value, onChange, disabled }: { value: Formation; onChange: (f: Formation) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm font-bold hover:border-faint disabled:opacity-50">
        <FormationThumb f={value} size={18} />
        <span className="tabular">{value}</span>
        <span className="text-faint">▾</span>
      </button>
      {open && (
        <div role="listbox" aria-label="Formação" className="absolute left-0 z-40 mt-2 w-[min(92vw,560px)] rounded-xl border border-line bg-surface p-3 shadow-2xl">
          {GROUPS.map((g) => (
            <div key={g.label} className="mb-2 last:mb-0">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{g.label}</p>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {FORMATIONS.filter(g.match).map((f) => (
                  <button key={f} type="button" role="option" aria-selected={f === value}
                    onClick={() => { onChange(f); setOpen(false); }}
                    className={cn("flex flex-col items-center gap-1 rounded-lg border p-1.5 text-[11px] font-bold tabular transition",
                      f === value ? "border-accent bg-accent/10 text-ink" : "border-line text-muted hover:border-faint hover:text-ink")}>
                    <FormationThumb f={f} size={40} />
                    {f}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
