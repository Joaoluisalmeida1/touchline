"use client";
/**
 * The Roleta cabinet: chasing bulbs, three reels, a jackpot display, sound (Web Audio, no files), haptics and confetti.
 * The outcome always comes from the server (spinAction); the reels only animate towards it.
 */
import { Volume2, VolumeX } from "lucide-react";
import { useActionState, useEffect, useLayoutEffect, useRef, useState, startTransition } from "react";
import type { ActionState } from "@/server/actions";
import { spinAction } from "@/server/actions";
import { SYMBOLS, type Rarity, type Symbol } from "@/engine/slots/slots";
import type { SpinOutcome } from "@/server/services/fun";
import { AnimatedNumber } from "../fx/animated-number";
import { cn, eur } from "../ui";
import { SlotSymbol } from "./symbols";
import { RARITY } from "./rarity";

const H = 104; // reel cell height (px)



/* ------------------------------------------------------------------ sound */
class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;
  private ensure() {
    if (this.muted || typeof window === "undefined") return null;
    if (!this.ctx) {
      const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!C) return null;
      this.ctx = new C();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }
  tone(freq: number, dur: number, type: OscillatorType = "square", gain = 0.06, delay = 0, slide?: number) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  tick() { this.tone(900 + Math.random() * 500, 0.03, "square", 0.025); }
  lever() { this.tone(180, 0.18, "sawtooth", 0.07, 0, 90); this.tone(1200, 0.08, "triangle", 0.04, 0.05); }
  thunk(i: number) { this.tone(140 - i * 15, 0.12, "triangle", 0.12); this.tone(2400, 0.02, "square", 0.02); }
  result(r: Rarity) {
    const seq: Record<Rarity, number[]> = {
      common: [660, 880],
      rare: [523, 659, 784, 1047],
      epic: [523, 659, 784, 1047, 1319, 1568],
      legendary: [523, 659, 784, 1047, 1319, 1568, 2093, 1568, 2093, 2637],
      bad: [330, 262, 196],
      disaster: [220, 185, 147, 110],
    };
    const notes = seq[r];
    const sad = r === "bad" || r === "disaster";
    notes.forEach((f, i) => this.tone(f, sad ? 0.28 : 0.14, sad ? "sawtooth" : "square", sad ? 0.06 : 0.05, i * (sad ? 0.22 : 0.09)));
    if (r === "legendary") for (let i = 0; i < 18; i++) this.tone(1500 + Math.random() * 1500, 0.05, "triangle", 0.03, 1 + i * 0.06);
  }
}

/* ------------------------------------------------------------------ reel */
function randomSymbols(n: number) { return Array.from({ length: n }, () => SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]); }

function Reel({ spinning, target, index }: { spinning: boolean; target: Symbol | null; index: number }) {
  const strip = useRef<HTMLDivElement>(null);
  const [cells, setCells] = useState<Symbol[]>(() => randomSymbols(3));
  const [mode, setMode] = useState<"idle" | "spin" | "stop">("idle");
  useEffect(() => {
    if (spinning) { setCells([...SYMBOLS, ...SYMBOLS]); setMode("spin"); }
  }, [spinning]);
  useEffect(() => {
    if (!spinning && target && mode === "spin") { setCells([...randomSymbols(16), target, ...randomSymbols(1)]); setMode("stop"); }
  }, [spinning, target, mode]);
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el || mode !== "stop") return;
    el.style.transition = "none";
    el.style.transform = `translateY(${H}px)`;
    void el.offsetHeight;
    el.style.transition = `transform ${0.75 + index * 0.08}s cubic-bezier(.12,.85,.25,1.12)`;
    el.style.transform = `translateY(${-(16 - 1) * H}px)`;
  }, [mode, index]);
  return (
    <div className="relative h-[312px] flex-1 overflow-hidden rounded-xl bg-gradient-to-b from-[#e8e3d6] via-white to-[#e8e3d6] shadow-[inset_0_10px_18px_rgb(0_0_0/.35),inset_0_-10px_18px_rgb(0_0_0/.35)]">
      <div ref={strip} className={cn("absolute inset-x-0 top-0 flex flex-col items-center", mode === "spin" && "tl-reel-spin")}
        style={mode === "idle" ? { transform: "translateY(0)" } : undefined}>
        {cells.map((s, i) => (
          <div key={`${mode}-${i}`} className="flex shrink-0 items-center justify-center" style={{ height: H }}><SlotSymbol s={s} size={78} /></div>
        ))}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 h-[104px] -translate-y-1/2 border-y-2 border-[#d4af37]/70" />
    </div>
  );
}

/* ------------------------------------------------------------------ confetti */
function Confetti({ burst, colors }: { burst: number; colors: string[] }) {
  if (!burst) return null;
  return (
    <div key={burst} aria-hidden className="pointer-events-none fixed inset-0 z-[70] overflow-hidden">
      {Array.from({ length: 90 }, (_, i) => (
        <span key={i} className="tl-confetti absolute top-[-20px] block h-3 w-2 rounded-[2px]"
          style={{ left: `${Math.random() * 100}%`, background: colors[i % colors.length], animationDelay: `${Math.random() * 0.5}s`,
            animationDuration: `${1.6 + Math.random() * 1.6}s`, transform: `rotate(${Math.random() * 360}deg)` }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ cabinet */
export function SlotMachine({ gameId, potCents, spinsToday, freeSpins, canAfford }: {
  gameId: string; potCents: number; spinsToday: number; freeSpins: number; canAfford: boolean;
}) {
  const [state, action] = useActionState(spinAction, {} as ActionState);
  const [spinning, setSpinning] = useState(false);
  const [targets, setTargets] = useState<(Symbol | null)[]>([null, null, null]);
  const [stopped, setStopped] = useState([true, true, true]);
  const [result, setResult] = useState<SpinOutcome | null>(null);
  const [burst, setBurst] = useState(0);
  const [shake, setShake] = useState(false);
  const sfx = useRef(new Sfx());
  const [muted, setMuted] = useState(false);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    try { const m = localStorage.getItem("tl-slots-muted") === "1"; setMuted(m); sfx.current.muted = m; } catch { /* storage blocked */ }
  }, []);
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    sfx.current.muted = m;
    try { localStorage.setItem("tl-slots-muted", m ? "1" : "0"); } catch { /* ignore */ }
  };

  const seen = useRef<ActionState>(state);
  useEffect(() => {
    if (state === seen.current) return;
    seen.current = state;
    const out = (state.data as { outcome?: SpinOutcome } | undefined)?.outcome;
    if (state.error || !out) {
      if (tickTimer.current) clearInterval(tickTimer.current);
      setTargets(randomSymbols(3));
      setStopped([true, true, true]);
      setSpinning(false);
      return;
    }
    if (out.id === lastId.current) return;
    lastId.current = out.id;
    setTargets(out.reels);
    const delays = [550, 1000, 1500];
    delays.forEach((d, i) => setTimeout(() => {
      setStopped((s) => { const n = [...s]; n[i] = true; return n; });
      sfx.current.thunk(i);
      if (i === 2) {
        if (tickTimer.current) clearInterval(tickTimer.current);
        setTimeout(() => {
          setSpinning(false);
          setResult(out);
          sfx.current.result(out.rarity);
          if (["epic", "legendary"].includes(out.rarity)) setBurst((b) => b + 1);
          if (out.rarity === "bad" || out.rarity === "disaster") { setShake(true); setTimeout(() => setShake(false), 600); }
          try { navigator.vibrate?.(out.rarity === "legendary" ? [80, 40, 80, 40, 200] : out.rarity === "bad" || out.rarity === "disaster" ? [200] : [40]); } catch { /* no haptics */ }
        }, 900);
      }
    }, d));
  }, [state]);

  const start = (fd: FormData) => {
    setResult(null);
    setSpinning(true);
    setStopped([false, false, false]);
    sfx.current.lever();
    if (tickTimer.current) clearInterval(tickTimer.current);
    tickTimer.current = setInterval(() => sfx.current.tick(), 70);
    startTransition(() => action(fd));
  };

  const disabled = spinning || (freeSpins === 0 && !canAfford);
  const r = result ? RARITY[result.rarity] : null;
  const bulbs = 22;

  return (
    <div className={cn("relative mx-auto w-full max-w-[640px]", shake && "tl-shake")}>
      <Confetti burst={burst} colors={["#ffcc33", "#a855f7", "#3a5bf0", "#2fbf6a", "#e11d2e", "#fff"]} />
      <div className="relative overflow-hidden rounded-[28px] border-4 border-[#3b2a07] bg-[radial-gradient(120%_80%_at_50%_0%,#7a1028_0%,#3a0613_55%,#14020a_100%)] p-4 shadow-[0_30px_60px_-20px_rgb(0_0_0/.6)] sm:p-6">
        {/* marquee with chasing bulbs */}
        <div className="relative rounded-2xl border-2 border-[#d4af37] bg-[#1a0208] px-4 pb-3 pt-6 text-center">
          <div aria-hidden className="absolute inset-x-2 top-1.5 flex justify-between">
            {Array.from({ length: bulbs }, (_, i) => (
              <span key={i} className={cn("size-2.5 rounded-full", spinning ? "tl-bulb-fast" : "tl-bulb")} style={{ animationDelay: `${(i % 4) * 0.12}s` }} />
            ))}
          </div>
          <p className="font-display text-sm font-black uppercase tracking-[0.3em] text-[#ffd76a]">Roleta da Liga</p>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#f5c2cf]">Jackpot</p>
          <p className="font-display text-5xl font-black leading-none text-[#ffcc33] drop-shadow-[0_2px_0_#7a5200] sm:text-6xl">
            <AnimatedNumber value={result?.pot_cents ?? potCents} format="eurFull" />
          </p>
        </div>

        {/* reels */}
        <div className="relative mt-4 rounded-2xl border-4 border-[#d4af37] bg-[#120108] p-2.5 shadow-[inset_0_0_30px_rgb(0_0_0/.8)]">
          <div className="flex gap-2.5">
            {[0, 1, 2].map((i) => <Reel key={i} index={i} spinning={spinning && !stopped[i]} target={targets[i]} />)}
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-x-1 top-1/2 h-1 -translate-y-1/2 rounded bg-[#e11d2e]/70" />
        </div>

        {/* result banner */}
        <div aria-live="polite" className="mt-4 min-h-[92px]">
          {result && r ? (
            <div className="tl-pop rounded-2xl border-2 p-4 text-center" style={{ background: r.bg, color: r.ink, borderColor: r.ring }}>
              <p className="text-[11px] font-black uppercase tracking-[0.25em] opacity-90">{r.label}{result.free ? " · giro grátis" : ""}{result.shielded ? " · escudo" : ""}</p>
              <p className="font-display text-3xl font-black uppercase leading-tight sm:text-4xl">{result.label}</p>
              <p className="mt-1 text-sm font-semibold opacity-95">{result.detail}</p>
            </div>
          ) : state.error && !spinning ? (
            <p className="rounded-2xl bg-black/40 p-4 text-center text-sm font-semibold text-[#fca5a5]">{state.error}</p>
          ) : (
            <p className="p-4 text-center text-sm font-semibold text-[#f5c2cf]">{spinning ? "A girar…" : "Três iguais = prémio épico. Boa sorte!"}</p>
          )}
        </div>

        {/* lever */}
        <form action={start} className="mt-2 flex flex-col items-center gap-3">
          <input type="hidden" name="gameId" value={gameId} />
          <button type="submit" disabled={disabled}
            className={cn("tl-lever relative w-full max-w-sm rounded-full border-4 border-[#7a5200] bg-[linear-gradient(180deg,#ffe27a,#ffb300_60%,#e08a00)] px-8 py-4 font-display text-2xl font-black uppercase tracking-wide text-[#3b2400] shadow-[0_8px_0_#7a5200] transition active:translate-y-[6px] active:shadow-[0_2px_0_#7a5200] disabled:cursor-not-allowed disabled:opacity-50",
              !disabled && "tl-attract")}>
            {spinning ? "A girar…" : freeSpins > 0 ? "Giro grátis!" : `Girar · ${eur(50_000_000)}`}
          </button>
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs font-bold text-[#f5c2cf]">
            <span className="rounded-full bg-black/30 px-3 py-1">{spinsToday} {spinsToday === 1 ? "giro" : "giros"} hoje</span>
            {freeSpins > 0 && <span className="rounded-full bg-[#2fbf6a] px-3 py-1 text-[#06240f]">{freeSpins} grátis</span>}
            {!canAfford && freeSpins === 0 && <span className="rounded-full bg-black/30 px-3 py-1">Sem €500 000 disponíveis</span>}
            <button type="button" onClick={toggleMute} aria-label={muted ? "Ligar som" : "Desligar som"} className="flex size-8 items-center justify-center rounded-full bg-black/30 text-[#ffd76a]">
              {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
