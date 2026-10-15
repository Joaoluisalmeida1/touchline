"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, ClubDot, cn } from "./ui";

interface Ev { seq: number; minute: number; type: string; side: "home" | "away"; player: string | null; related: string | null; payload: Record<string, unknown> }

const ICON: Record<string, string> = {
  goal: "⚽", own_goal: "⚽", yellow_card: "🟨", second_yellow: "🟨🟥", red_card: "🟥", substitution: "🔁", injury: "✚",
  penalty_awarded: "◎", penalty_missed: "✕", shot_saved: "🧤", half_time: "⏸", full_time: "🏁",
};
const KEY_TYPES = new Set(["goal", "own_goal", "yellow_card", "second_yellow", "red_card", "substitution", "injury", "penalty_awarded", "penalty_missed", "half_time", "full_time"]);

function describe(e: Ev): string {
  const xg = typeof e.payload?.xg === "number" ? ` (xG ${(e.payload.xg as number).toFixed(2)})` : "";
  switch (e.type) {
    case "goal": return `Golo de ${e.player}${e.related ? `, assistência de ${e.related}` : ""}${xg}`;
    case "own_goal": return `Autogolo de ${e.player}`;
    case "yellow_card": return `Amarelo para ${e.player}`;
    case "second_yellow": return `Segundo amarelo — ${e.player} expulso`;
    case "red_card": return `Vermelho direto para ${e.player}`;
    case "substitution": return `Entra ${e.player}, sai ${e.related}`;
    case "injury": return `${e.player} lesionado`;
    case "penalty_awarded": return `Penálti! Falta de ${e.related}`;
    case "penalty_missed": return `${e.player} falha o penálti`;
    case "shot_saved": return `Defesa de ${e.related ?? "guarda-redes"} a remate de ${e.player}${xg}`;
    case "half_time": return "Intervalo";
    case "full_time": return "Fim do jogo";
    default: return e.type;
  }
}

/** Accelerated replay of an already-simulated match (no physics, just the stored event stream). */
export function MatchReplay({ home, away, finalScore, events, momentum }: {
  home: { name: string; color: string }; away: { name: string; color: string }; finalScore: [number, number]; events: Ev[]; momentum: number[];
}) {
  const keyEvents = useMemo(() => events.filter((e) => KEY_TYPES.has(e.type)), [events]);
  const [minute, setMinute] = useState<number | null>(null); // null => show full result
  const playing = minute !== null && minute < 96;
  useEffect(() => {
    if (minute === null || minute >= 96) return;
    const t = setTimeout(() => setMinute((m) => (m === null ? null : m + 1)), 120);
    return () => clearTimeout(t);
  }, [minute]);
  const visible = minute === null ? keyEvents : keyEvents.filter((e) => e.minute <= minute);
  const score = minute === null ? finalScore : [
    visible.filter((e) => (e.type === "goal" || e.type === "own_goal") && e.side === "home").length,
    visible.filter((e) => (e.type === "goal" || e.type === "own_goal") && e.side === "away").length,
  ];
  return (
    <div>
      <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <p className="flex items-center justify-end gap-2 text-right text-lg font-bold sm:text-2xl"><span className="truncate">{home.name}</span><ClubDot color={home.color} className="h-4 w-4" /></p>
        <p className="rounded-xl bg-bg px-4 py-2 text-3xl font-black tabular sm:text-5xl" aria-live="polite">{score[0]} – {score[1]}</p>
        <p className="flex items-center gap-2 text-lg font-bold sm:text-2xl"><ClubDot color={away.color} className="h-4 w-4" /><span className="truncate">{away.name}</span></p>
      </div>
      <div className="mt-3 flex items-center justify-center gap-3 text-sm">
        <Button variant="secondary" type="button" onClick={() => setMinute(playing ? null : 0)}>{playing ? "Mostrar resultado" : "▶ Ver em modo rápido"}</Button>
        {minute !== null && <span className="tabular text-muted">{Math.min(minute, 90)}&apos;</span>}
      </div>
      {momentum.length > 0 && (
        <svg viewBox="0 0 200 40" className="mx-auto mt-4 h-12 w-full max-w-xl" role="img" aria-label="Domínio do jogo por períodos de 5 minutos">
          <line x1="0" x2="200" y1="20" y2="20" stroke="#22304d" />
          {momentum.map((v, i) => (
            <rect key={i} x={i * 10 + 1} width="8" y={v >= 0 ? 20 - v * 18 : 20} height={Math.abs(v) * 18} fill={v >= 0 ? home.color : away.color}
              opacity={minute === null || i * 5 <= minute ? 0.9 : 0.15} />
          ))}
        </svg>
      )}
      <ol className="mx-auto mt-4 max-w-xl space-y-1 text-left text-sm">
        {visible.map((e) => (
          <li key={e.seq} className={cn("flex gap-3 rounded-lg px-2 py-1", e.side === "away" && !["half_time", "full_time"].includes(e.type) ? "flex-row-reverse text-right" : "", e.type === "goal" || e.type === "own_goal" ? "bg-accent/10 font-semibold" : "")}>
            <span className="w-8 shrink-0 text-muted tabular">{e.minute}&apos;</span>
            <span aria-hidden>{ICON[e.type] ?? "•"}</span>
            <span className="flex-1">{describe(e)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
