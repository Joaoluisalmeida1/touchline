"use client";
/** Small client pieces of the Roleta (duel accept with reveal) and the betting slip. */
import { Swords } from "lucide-react";
import { useActionState, useState } from "react";
import type { Symbol } from "@/engine/slots/slots";
import type { ActionState } from "@/server/actions";
import { acceptDuelAction, placeBetAction } from "@/server/actions";
import { FormMessage } from "../action-form";
import { Button, cn, eur, inputCls } from "../ui";
import { SlotSymbol } from "./symbols";

export function DuelReels({ reels, score, label, win }: { reels: Symbol[]; score: number; label: string; win: boolean | null }) {
  return (
    <div className={cn("rounded-xl p-2 text-center", win ? "bg-up/15 ring-1 ring-up/40" : win === false ? "bg-surface-2" : "bg-surface-2")}>
      <p className="truncate text-xs font-bold">{label}</p>
      <div className="mt-1 flex justify-center gap-1">{reels.map((s, i) => <span key={i} className="tl-pop" style={{ animationDelay: `${i * 0.15}s` }}><SlotSymbol s={s} size={34} /></span>)}</div>
      <p className="font-display text-xl font-black tabular">{score}</p>
    </div>
  );
}

export function DuelAccept({ gameId, duelId, me, them }: { gameId: string; duelId: string; me: string; them: string }) {
  const [state, action, pending] = useActionState(acceptDuelAction, {} as ActionState);
  const d = (state.data as { duel?: { challenger: { reels: Symbol[]; score: number }; opponent: { reels: Symbol[]; score: number }; winner: string } } | undefined)?.duel;
  if (d) return (
    <div className="grid grid-cols-2 gap-2">
      <DuelReels reels={d.challenger.reels} score={d.challenger.score} label={them} win={d.winner === "challenger"} />
      <DuelReels reels={d.opponent.reels} score={d.opponent.score} label={me} win={d.winner === "opponent"} />
      <p className="col-span-2 text-center text-sm font-bold">{state.message}</p>
    </div>
  );
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="duelId" value={duelId} />
      <Button type="submit" disabled={pending} className="w-full"><Swords className="size-4" />{pending ? "A girar…" : "Aceitar e girar"}</Button>
      <FormMessage state={state} />
    </form>
  );
}

const QUICK = [100_000, 500_000, 1_000_000, 5_000_000];

export function BetSlip({ gameId, fixtureId, odds, home, away, disabled, availableCents }: {
  gameId: string; fixtureId: string; odds: { "1": number; X: number; "2": number }; home: string; away: string; disabled?: string; availableCents: number;
}) {
  const [state, action, pending] = useActionState(placeBetAction, {} as ActionState);
  const [pick, setPick] = useState<"1" | "X" | "2" | null>(null);
  const [stake, setStake] = useState(500_000);
  // a fresh idempotency key for every answered submit (double clicks of one submit reuse it)
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [seen, setSeen] = useState(state);
  if (state !== seen) { setSeen(state); setKey(crypto.randomUUID()); }
  const win = pick ? Math.round(stake * odds[pick]) : 0;
  const label = { "1": home, X: "Empate", "2": away };
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="fixtureId" value={fixtureId} />
      <input type="hidden" name="idempotencyKey" value={key} />
      <input type="hidden" name="pick" value={pick ?? ""} />
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={`Resultado de ${home} – ${away}`}>
        {(["1", "X", "2"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={pick === k} disabled={!!disabled} onClick={() => setPick(k)}
            className={cn("flex min-h-14 flex-col items-center justify-center rounded-[10px] border px-2 py-1.5 transition disabled:opacity-40",
              pick === k ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface-2 hover:border-faint")}>
            <span className="text-[11px] font-bold uppercase tracking-[0.1em] opacity-80">{k === "X" ? "X" : k}</span>
            <span className="font-display text-xl font-black leading-none tabular">{odds[k].toFixed(2)}</span>
          </button>
        ))}
      </div>
      {disabled ? <p className="text-center text-xs font-semibold text-muted">{disabled}</p> : pick && (
        <div className="space-y-2 rounded-xl bg-surface-2 p-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK.map((q) => <button key={q} type="button" onClick={() => setStake(q)} className={cn("rounded-full border px-3 py-1 text-xs font-bold", stake === q ? "border-accent text-accent" : "border-line-strong text-muted")}>{eur(q * 100)}</button>)}
            <button type="button" onClick={() => setStake(Math.max(10_000, Math.floor(availableCents / 100)))} className="rounded-full border border-line-strong px-3 py-1 text-xs font-bold text-down">Tudo</button>
          </div>
          <label className="block">
            <span className="sr-only">Valor da aposta (€)</span>
            <input name="stakeEur" inputMode="numeric" value={stake} onChange={(e) => setStake(Number(e.target.value.replace(/[^\d]/g, "")) || 0)} className={cn(inputCls, "font-display text-lg font-black tabular")} />
          </label>
          <p className="text-sm">{label[pick]} a <b className="tabular">{odds[pick].toFixed(2)}</b> → ganhas <b className="font-display text-lg text-up tabular">{eur(win * 100)}</b></p>
          <Button type="submit" disabled={pending || stake < 10_000} className="w-full">{pending ? "A apostar…" : `Apostar ${eur(stake * 100)}`}</Button>
        </div>
      )}
      <FormMessage state={state} />
    </form>
  );
}
