"use client";
import { X } from "lucide-react";
import { useState, useTransition } from "react";
import type { LineupInstructions, Tactics } from "@/engine/common/types";
import { archiveTacticPresetAction, saveTacticPresetAction } from "@/server/actions";
import { Button, Card, CardTitle, cn, inputCls } from "../ui";
import { FormationThumb } from "./formation-picker";
import type { EditorState, PresetPayload, SquadP } from "./types";

export const TACTIC_OPTIONS: { key: keyof Tactics; label: string; opts: [string, string][]; help: string }[] = [
  { key: "mentality", label: "Mentalidade", opts: [["defensive", "Defensiva"], ["balanced", "Equilibrada"], ["attacking", "Ofensiva"]], help: "Ofensiva cria mais ocasiões mas expõe a defesa." },
  { key: "pressing", label: "Pressão", opts: [["low", "Baixa"], ["medium", "Média"], ["high", "Alta"]], help: "Alta recupera bolas à frente, cansa mais e deixa espaço nas costas." },
  { key: "defensive_line", label: "Linha defensiva", opts: [["low", "Baixa"], ["medium", "Média"], ["high", "Alta"]], help: "Alta comprime o campo mas é vulnerável a bolas em profundidade." },
  { key: "tempo", label: "Ritmo", opts: [["slow", "Lento"], ["normal", "Normal"], ["high", "Alto"]], help: "Alto acelera posses e aumenta o desgaste." },
  { key: "passing_directness", label: "Passe", opts: [["short", "Curto"], ["mixed", "Misto"], ["direct", "Direto"]], help: "Direto progride rápido mas perde mais bolas." },
  { key: "width", label: "Largura", opts: [["narrow", "Estreita"], ["balanced", "Equilibrada"], ["wide", "Larga"]], help: "Larga gera mais cruzamentos e cabeceamentos." },
  { key: "transitions", label: "Transições", opts: [["possession", "Posse"], ["balanced", "Equilibradas"], ["counter", "Contra-ataque"]], help: "Contra-ataque aproveita recuperações para atacar depressa." },
];

const TAKERS: { key: keyof LineupInstructions; label: string; help: string; pool: "xi" | "squad" }[] = [
  { key: "captain", label: "Capitão", help: "Pequeno bónus de liderança enquanto estiver em campo. Tem de ser titular.", pool: "xi" },
  { key: "penalty_taker", label: "Penáltis", help: "Se não estiver em campo, bate o melhor disponível.", pool: "squad" },
  { key: "freekick_taker", label: "Livres diretos", help: "Remata os livres perigosos.", pool: "squad" },
  { key: "corner_taker", label: "Cantos", help: "Bate os cantos e é o assistente nos cabeceamentos.", pool: "squad" },
];

export function InstructionsTab({ gameId, squad, st, locked, presets, onTactics, onIns, onApplyPreset, currentPreset, onToast }: {
  gameId: string; squad: SquadP[]; st: EditorState; locked: boolean;
  presets: { id: string; name: string; payload: PresetPayload }[];
  onTactics: (t: Tactics) => void; onIns: (k: keyof LineupInstructions, id: string | null) => void;
  onApplyPreset: (p: PresetPayload) => void; currentPreset: () => PresetPayload; onToast: (ok: boolean, text: string) => void;
}) {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const xi = st.xi.filter(Boolean) as string[];
  const md = [...xi, ...st.bench];
  const [name, setName] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; message?: string }>) =>
    start(async () => { const r = await fn(); onToast(!r.error, r.error ?? r.message ?? "Feito."); });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card>
        <CardTitle>Instruções de equipa</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          {TACTIC_OPTIONS.map((t) => (
            <div key={t.key}>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{t.label}</p>
              <div role="radiogroup" aria-label={t.label} className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-bg/70 p-1">
                {t.opts.map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={st.tactics[t.key] === v} disabled={locked}
                    onClick={() => onTactics({ ...st.tactics, [t.key]: v } as Tactics)}
                    className={cn("rounded-lg px-2 py-2 text-xs font-bold transition", st.tactics[t.key] === v ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-2 hover:text-ink")}>{l}</button>
                ))}
              </div>
              <p className="mt-1 text-[11px] text-faint">{t.help}</p>
            </div>
          ))}
        </div>
      </Card>
      <div className="space-y-6">
        <Card>
          <CardTitle>Bolas paradas e liderança</CardTitle>
          <div className="space-y-3">
            {TAKERS.map((t) => {
              const pool = (t.pool === "xi" ? xi : md).map((id) => byId.get(id)!).filter(Boolean)
                .sort((a, b) => (b.profile.set_pieces + b.ovr) - (a.profile.set_pieces + a.ovr));
              return (
                <label key={t.key} className="block">
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{t.label}</span>
                  <select className={cn(inputCls, "mt-1")} value={st.ins[t.key] ?? ""} disabled={locked} onChange={(e) => onIns(t.key, e.target.value || null)}>
                    <option value="">Automático</option>
                    {pool.map((p) => <option key={p.id} value={p.id}>{p.shirt !== null ? `${p.shirt} · ` : ""}{p.name} ({p.ovr})</option>)}
                  </select>
                  <span className="mt-0.5 block text-[11px] text-faint">{t.help}</span>
                </label>
              );
            })}
          </div>
        </Card>
        <Card>
          <CardTitle>Predefinições</CardTitle>
          <p className="mb-3 text-xs text-muted">Guarda onze, formação, funções e instruções para trocar num clique (ex.: «Casa», «Fora», «Segurar resultado»). Aplicar só altera o editor; depois carrega em Guardar.</p>
          <ul className="mb-3 space-y-2">
            {presets.length === 0 && <li className="text-sm text-faint">Ainda sem predefinições.</li>}
            {presets.map((pr) => (
              <li key={pr.id} className="flex items-center gap-2.5 rounded-xl border border-line bg-bg/40 p-2">
                <FormationThumb f={pr.payload.formation} size={26} />
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{pr.name}</p><p className="text-[11px] text-muted tabular">{pr.payload.formation}</p></div>
                <Button type="button" variant="secondary" className="min-h-8 px-3" disabled={locked} onClick={() => onApplyPreset(pr.payload)}>Aplicar</Button>
                <button type="button" className="rounded p-1 text-faint hover:text-danger" aria-label={`Apagar ${pr.name}`} disabled={pending}
                  onClick={() => run(() => archiveTacticPresetAction({ gameId, presetId: pr.id }))}><X className="size-4" /></button>
              </li>
            ))}
          </ul>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await saveTacticPresetAction({ gameId, name, payload: currentPreset() as unknown as Record<string, unknown> }); if (!r.error) setName(""); return r; }); }}>
            <input className={inputCls} placeholder="Nome da predefinição" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={pending} />
            <Button type="submit" variant="secondary" disabled={pending || !name.trim() || st.xi.some((x) => !x)}>Guardar</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
