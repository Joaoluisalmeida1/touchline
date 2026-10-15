"use client";
import { ArrowLeftRight, CirclePause, Cross, Flag, Hand, Play, RotateCcw, Target, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ClubBadge } from "./squad/avatar";
import { Button, cn } from "./ui";

interface Ev { seq: number; minute: number; type: string; side: "home" | "away"; player: string | null; related: string | null; payload: Record<string, unknown> }
interface Side { id: string; name: string; short: string; color: string; color2: string }

const Card = ({ red, second }: { red?: boolean; second?: boolean }) => (
  <span className="relative inline-flex h-4 w-3">
    {second && <span className="absolute -left-1 top-0 h-4 w-3 -rotate-12 rounded-[2px] bg-yellow-300" />}
    <span className={cn("relative h-4 w-3 rounded-[2px] shadow", red ? "bg-red-500" : "bg-yellow-300")} />
  </span>
);
const Ball = () => (
  <svg viewBox="0 0 24 24" className="size-4" aria-hidden><circle cx="12" cy="12" r="10" fill="#fff" /><path d="M12 7l4 3-1.5 5h-5L8 10z" fill="#0b0e00" /><path d="M12 7V3M16 10l3.5-1.5M14.5 15l2.5 3.5M9.5 15 7 18.5M8 10 4.5 8.5" stroke="#0b0e00" strokeWidth="1.3" /></svg>
);

const ICON: Record<string, ReactNode> = {
  goal: <Ball />, own_goal: <Ball />, yellow_card: <Card />, second_yellow: <Card red second />, red_card: <Card red />,
  substitution: <ArrowLeftRight className="size-4 text-info" />, injury: <Cross className="size-4 text-danger" />, penalty_awarded: <Target className="size-4 text-warn" />,
  penalty_missed: <X className="size-4 text-danger" />, shot_saved: <Hand className="size-4 text-muted" />, half_time: <CirclePause className="size-4 text-muted" />, full_time: <Flag className="size-4 text-accent" />,
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

function Digit({ v }: { v: number }) {
  return (
    <span className="relative inline-flex h-[1em] w-[0.62em] justify-center overflow-hidden">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={v} initial={{ y: "-100%", filter: "blur(4px)" }} animate={{ y: 0, filter: "blur(0px)" }} exit={{ y: "100%", filter: "blur(4px)" }}
          transition={{ type: "spring", stiffness: 380, damping: 26 }} className="absolute leading-none">{v}</motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Accelerated replay of an already-simulated match (no physics, just the stored event stream). */
export function MatchReplay({ home, away, finalScore, events, momentum, round }: {
  home: Side; away: Side; finalScore: [number, number]; events: Ev[]; momentum: number[]; round: number;
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
  const scorers = (side: "home" | "away") => keyEvents.filter((e) => (e.type === "goal" || e.type === "own_goal") && e.side === side && (minute === null || e.minute <= minute));
  const clock = minute === null ? "Final" : minute >= 96 ? "Final" : `${Math.min(minute, 90)}'`;

  return (
    <div>
      {/* scoreboard */}
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-line-strong bg-surface">
        <div aria-hidden className="pointer-events-none absolute inset-0 opacity-25" style={{ background: `linear-gradient(100deg, ${home.color} 0%, transparent 42%, transparent 58%, ${away.color} 100%)` }} />
        <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0" />
        <div className="relative px-4 pb-5 pt-4 sm:px-8 sm:pb-7">
          <div className="flex items-center justify-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted">Jornada {round}</span>
            <span className={cn("rounded-md px-2 py-0.5 font-display text-sm font-bold uppercase tabular", playing ? "bg-danger text-white" : "bg-surface-3 text-ink ring-1 ring-line-strong")}>
              {playing && <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-white align-middle" />}{clock}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-6">
            {([home, away] as const).map((s, i) => (
              <div key={s.id} className={cn("flex min-w-0 flex-col items-center gap-2 text-center", i === 1 && "order-3")}>
                <ClubBadge seed={s.id} name={s.name} short={s.short} primary={s.color} secondary={s.color2} size={72} className="drop-shadow-[0_10px_24px_rgb(0_0_0/.55)]" />
                <p className="headline line-clamp-2 text-lg sm:text-3xl">{s.name}</p>
                <ul className="space-y-0.5 text-[11px] text-muted sm:text-xs">
                  {scorers(i === 0 ? "home" : "away").map((e) => <li key={e.seq}>{e.player}{e.type === "own_goal" ? " (p.b.)" : ""} {e.minute}&apos;</li>)}
                </ul>
              </div>
            ))}
            <div className="order-2 pt-3 sm:pt-4">
              <p className="flex items-center rounded-2xl bg-bg/85 px-3 py-1 font-display text-6xl font-extrabold tabular ring-1 ring-line-strong sm:px-5 sm:text-8xl" aria-live="polite" aria-label={`${score[0]} – ${score[1]}`}>
                <Digit v={score[0]} /><span className="mx-1 text-faint sm:mx-2">–</span><Digit v={score[1]} />
              </p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-center gap-3 text-sm">
            <Button variant={playing ? "secondary" : "primary"} type="button" onClick={() => setMinute(playing ? null : 0)}>
              {playing ? <><RotateCcw className="size-4" />Mostrar resultado</> : <><Play className="size-4 fill-current" />Ver em modo rápido</>}
            </Button>
          </div>
          {minute !== null && (
            <div className="mx-auto mt-4 h-1 max-w-xl overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent transition-[width] duration-100" style={{ width: `${(Math.min(minute, 96) / 96) * 100}%` }} />
            </div>
          )}
        </div>
      </div>

      {momentum.length > 0 && (
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-faint">
            <span style={{ color: home.color === "#000000" ? undefined : home.color }}>{home.short}</span><span>Domínio</span><span style={{ color: away.color === "#000000" ? undefined : away.color }}>{away.short}</span>
          </div>
          <svg viewBox="0 0 200 44" className="h-16 w-full" preserveAspectRatio="none" role="img" aria-label="Domínio do jogo por períodos de 5 minutos">
            <line x1="0" x2="200" y1="22" y2="22" stroke="#343c47" strokeWidth=".5" />
            <line x1="100" x2="100" y1="2" y2="42" stroke="#343c47" strokeDasharray="1.5 1.5" strokeWidth=".5" />
            {momentum.map((v, i) => (
              <rect key={i} x={i * (200 / momentum.length) + 0.8} width={200 / momentum.length - 1.6} rx="1"
                y={v >= 0 ? 22 - v * 20 : 22} height={Math.max(0.6, Math.abs(v) * 20)} fill={v >= 0 ? home.color : away.color}
                opacity={minute === null || i * 5 <= minute ? 0.95 : 0.12} style={{ transition: "opacity .2s" }} />
            ))}
          </svg>
        </div>
      )}

      <ol className="relative mx-auto mt-6 max-w-2xl space-y-1.5 text-left text-sm before:absolute before:inset-y-0 before:left-1/2 before:hidden before:w-px before:bg-line sm:before:block">
        <AnimatePresence initial={false}>
          {visible.map((e) => {
            const neutral = e.type === "half_time" || e.type === "full_time";
            const goal = e.type === "goal" || e.type === "own_goal";
            return (
              <motion.li key={e.seq} layout initial={{ opacity: 0, y: -8, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                className={cn("relative flex sm:w-1/2", neutral ? "justify-center sm:mx-auto sm:w-auto" : e.side === "away" ? "sm:ml-auto sm:pl-5" : "sm:flex-row-reverse sm:pr-5 sm:text-right")}>
                {neutral ? (
                  <span className="relative z-10 rounded-full bg-surface-2 px-3 py-1 text-xs font-bold uppercase tracking-wider text-muted ring-1 ring-line">{e.minute}&apos; · {describe(e)}</span>
                ) : (
                  <span className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-2 ring-1", e.side === "away" ? "" : "sm:flex-row-reverse",
                    goal ? "bg-accent/10 font-semibold text-ink ring-accent/30" : "bg-surface/80 ring-line")}>
                    <span className="w-8 shrink-0 font-display text-base font-bold text-muted tabular">{e.minute}&apos;</span>
                    <span className="flex size-6 shrink-0 items-center justify-center" aria-hidden>{ICON[e.type] ?? "•"}</span>
                    <span className="min-w-0 flex-1">{describe(e)}</span>
                    <span className="size-2 shrink-0 rounded-full sm:hidden" style={{ background: e.side === "home" ? home.color : away.color }} aria-hidden />
                  </span>
                )}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ol>
    </div>
  );
}
