"use client";
import Link from "next/link";
import { TRAIT_INFO, traitOf } from "@/engine/narrative/traits";
import { X } from "lucide-react";
import { useState, useTransition } from "react";
import type { LineupInstructions, Slot } from "@/engine/common/types";
import { PREFERRABLE_SLOTS, SLOT_LABEL, SLOT_NAME } from "@/engine/lineup/formations";
import { rolesForSlot } from "@/engine/lineup/roles";
import { setPreferredSlotAction, setShirtNumberAction } from "@/server/actions";
import { Badge, Button, FormArrow, Meter, OvrBadge, cn, eur, inputCls } from "../ui";
import { PlayerAvatar, RatingSpark } from "./avatar";
import { effOf, fitOf } from "./editor";
import { fitText } from "./pitch";
import type { ClubLook, SquadP } from "./types";

const INS_LABEL: Record<keyof LineupInstructions, string> = {
  captain: "Capitão", penalty_taker: "Penáltis", freekick_taker: "Livres", corner_taker: "Cantos",
};

export function PlayerPanel({ p, gameId, look, season, locked, slot, slotIndex, role, ins, inMatchday, onRole, onIns, onClose, onToast }: {
  p: SquadP; gameId: string; look: ClubLook; season: number; locked: boolean;
  slot: Slot | null; slotIndex: number | null; role: string | null; ins: LineupInstructions; inMatchday: boolean;
  onRole: (index: number, role: string) => void; onIns: (key: keyof LineupInstructions, id: string | null) => void;
  onClose: () => void; onToast: (ok: boolean, text: string) => void;
}) {
  const [num, setNum] = useState<string>(p.shirt?.toString() ?? "");
  const [pending, start] = useTransition();
  const canChangePref = !p.preferred_slot_season || p.preferred_slot_season < season;
  const fam = Object.entries(p.familiarity ?? {}).filter(([, v]) => (v ?? 0) > 0).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).slice(0, 4);

  const run = (fn: () => Promise<{ ok?: boolean; error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); onToast(!r.error, r.error ?? r.message ?? "Feito."); });

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <PlayerAvatar id={p.id} primary={look.primary} secondary={look.secondary} size={64} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-2xl font-extrabold uppercase leading-7 tracking-tight">{p.name}</p>
          <p className="text-xs text-muted">
            {p.preferred_slot ? SLOT_NAME[p.preferred_slot] : { GK: "Guarda-redes", DEF: "Defesa", MID: "Médio", ATT: "Avançado" }[p.group]}
            {p.age !== null ? ` · ${p.age} anos` : ""} · Pot. {p.potential_band}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {p.injured > 0 && <Badge tone="danger">Lesão · {p.injured}j</Badge>}
            {p.suspended > 0 && <Badge tone="warn">Castigo · {p.suspended}j</Badge>}
            {p.listed && <Badge tone="info">À venda</Badge>}
            {ins.captain === p.id && <Badge tone="accent">Capitão</Badge>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <OvrBadge ovr={p.ovr} size="lg" />
          {p.ovr_delta !== 0 && <span className={cn("text-xs font-bold", p.ovr_delta > 0 ? "text-accent" : "text-danger")}>{p.ovr_delta > 0 ? `+${p.ovr_delta}` : p.ovr_delta} época</span>}
        </div>
        <button type="button" onClick={onClose} className="-mr-1 -mt-1 rounded-lg p-1.5 text-muted transition hover:bg-surface-2 hover:text-ink" aria-label="Fechar"><X className="size-4" /></button>
      </div>

      {slot && slotIndex !== null && (
        <div className="rounded-2xl border border-line bg-bg/50 p-3">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-display text-base font-bold uppercase">{SLOT_NAME[slot]}</span>
            <span className={cn("font-bold tabular", fitText(fitOf(p, slot)))}>
              {Math.round(fitOf(p, slot) * 100)}% · rende {effOf(p, slot)}
            </span>
          </div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Função</p>
          <div className="grid gap-1.5">
            {rolesForSlot(slot).map((r) => (
              <button key={r.id} type="button" disabled={locked} onClick={() => onRole(slotIndex, r.id)}
                className={cn("rounded-xl border px-3 py-2 text-left transition", role === r.id ? "border-accent/70 bg-accent/10 shadow-[0_0_0_3px_rgb(212_255_58/.1)]" : "border-line hover:border-line-strong hover:bg-surface-2")}>
                <span className="text-sm font-semibold">{r.label}</span>
                <span className="block text-[11px] leading-4 text-muted">{r.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {inMatchday && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">Responsabilidades</p>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(INS_LABEL) as (keyof LineupInstructions)[]).map((k) => {
              const on = ins[k] === p.id;
              const allowed = k !== "captain" || slot !== null;
              return (
                <button key={k} type="button" disabled={locked || !allowed} onClick={() => onIns(k, on ? null : p.id)} aria-pressed={on}
                  title={!allowed ? "O capitão tem de ser titular" : undefined}
                  className={cn("rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-40", on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink")}>
                  {on ? "✓ " : ""}{INS_LABEL[k]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-muted" title={TRAIT_INFO[traitOf(p.id)].hint}>Personalidade: <b className="text-ink">{TRAIT_INFO[traitOf(p.id)].label}</b> · <span className="text-faint">{TRAIT_INFO[traitOf(p.id)].hint}</span></p>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[["Condição", <Meter key="f" value={p.fitness} label="Condição" />], ["Moral", <Meter key="m" value={p.morale} label="Moral" tone="bg-info" />], ["Forma", <FormArrow key="fo" form={p.form} />]].map(([l, el]) => (
          <div key={l as string} className="rounded-lg bg-bg/50 p-2"><p className="mb-1 text-[10px] uppercase tracking-wide text-faint">{l}</p><div className="flex justify-center">{el}</div></div>
        ))}
      </div>

      <div className="grid grid-cols-4 gap-2 text-center text-sm">
        {[["Jogos", p.stats.apps], ["Golos", p.stats.goals], ["Assist.", p.stats.assists], ["Nota", p.stats.avg?.toFixed(1) ?? "—"]].map(([l, v]) => (
          <div key={l as string} className="rounded-lg bg-bg/50 p-2"><p className="text-[10px] uppercase tracking-wide text-faint">{l}</p><p className="font-bold tabular">{v}</p></div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-lg bg-bg/50 px-3 py-2 text-sm">
        <span className="text-muted">Últimos jogos</span>
        <RatingSpark ratings={[...p.recent].reverse()} width={110} height={22} />
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div><dt className="text-[10px] uppercase tracking-wide text-faint">Valor</dt><dd className="font-semibold tabular">{eur(p.value_cents)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-wide text-faint">Salário/sem.</dt><dd className="font-semibold tabular">{eur(p.wage_cents)}</dd></div>
        <div><dt className="text-[10px] uppercase tracking-wide text-faint">Contrato</dt><dd className="font-semibold tabular">época {p.contract_end}</dd></div>
      </dl>

      <div className="rounded-xl border border-line p-3">
        <p className="mb-1 text-sm font-semibold">Posição preferida</p>
        <p className="mb-2 text-[11px] leading-4 text-muted">
          Especialista rende 100% na sua posição. Sem posição definida rende 97% em todas as do seu setor. A familiaridade cresce com os minutos jogados em cada posição. Podes mudar 1× por época.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PREFERRABLE_SLOTS[p.group].map((s) => (
            <button key={s} type="button" disabled={locked || pending || (!canChangePref && p.preferred_slot !== s) || p.preferred_slot === s}
              onClick={() => run(() => setPreferredSlotAction({ gameId, playerId: p.id, slot: s }))}
              className={cn("rounded-md border px-2.5 py-1 text-xs font-bold transition disabled:cursor-not-allowed",
                p.preferred_slot === s ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink disabled:opacity-40")}
              title={SLOT_NAME[s]}>{SLOT_LABEL[s]}</button>
          ))}
        </div>
        {!canChangePref && <p className="mt-1.5 text-[11px] text-faint">Já foi definida nesta época.</p>}
        {fam.length > 0 && (
          <div className="mt-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-faint">Familiaridade</p>
            {fam.map(([s, v]) => (
              <div key={s} className="flex items-center gap-2 text-xs">
                <span className="w-9 font-bold text-muted">{SLOT_LABEL[s as Slot]}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-info" style={{ width: `${v}%` }} /></div>
                <span className="w-8 text-right tabular text-muted">{Math.round(v ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setShirtNumberAction({ gameId, playerId: p.id, number: num ? Number(num) : null })); }}>
        <label className="flex-1">
          <span className="mb-1 block text-sm font-semibold">Número</span>
          <input className={inputCls} inputMode="numeric" pattern="[0-9]*" maxLength={2} value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, ""))} placeholder="—" disabled={pending} />
        </label>
        <Button type="submit" variant="secondary" disabled={pending}>Guardar</Button>
      </form>

      {p.profile.individual && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-faint">Perfil</p>
          {([["Ataque", p.profile.attack], ["Defesa", p.profile.defense], ["Criação", p.profile.creation], ["Físico", p.profile.physical], ["Bolas paradas", p.profile.set_pieces]] as const).map(([l, v]) => (
            <div key={l} className="flex items-center gap-2 text-xs"><span className="w-24 text-muted">{l}</span><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${v}%` }} /></div></div>
          ))}
        </div>
      )}

      <Link href={`/g/${gameId}/players/${p.id}`} className="block rounded-xl border border-line py-2.5 text-center text-sm font-bold text-ink transition hover:border-accent hover:text-accent">Ver perfil completo →</Link>
    </div>
  );
}
