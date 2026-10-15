"use client";
import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Broadcast-style countdown to a kickoff/deadline. Renders nothing until mounted (avoids SSR clock mismatch). */
export function Countdown({ to, label = "Começa em" }: { to: string; label?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <div className="h-[52px]" aria-hidden />;
  const ms = new Date(to).getTime() - now;
  if (ms <= 0) return <p className="text-sm font-semibold text-warn">A aguardar processamento da jornada</p>;
  const p = parts(ms);
  const cells: [number, string][] = p.d > 0 ? [[p.d, "dias"], [p.h, "horas"], [p.m, "min"]] : [[p.h, "horas"], [p.m, "min"], [p.s, "seg"]];
  return (
    <div aria-label={`${label} ${p.d} dias ${p.h} horas ${p.m} minutos`}>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-faint">{label}</p>
      <div className="flex items-end gap-1.5">
        {cells.map(([v, l], i) => (
          <div key={l} className="flex items-end gap-1.5">
            {i > 0 && <span className="pb-3 font-display text-xl font-bold text-faint">:</span>}
            <div className="text-center">
              <span className="block min-w-[2ch] rounded-md bg-bg/80 px-1.5 font-display text-3xl font-extrabold leading-9 tabular text-ink ring-1 ring-line">{String(v).padStart(2, "0")}</span>
              <span className="text-[9px] font-semibold uppercase tracking-wider text-faint">{l}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
