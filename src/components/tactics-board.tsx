"use client";
import { useMemo, useState, useTransition } from "react";
import { FORMATIONS, type Formation, type Slot, type Tactics } from "@/engine/common/types";
import { FORMATION_SLOTS, SLOT_GROUP, slotCoordinates, slotSuitability } from "@/engine/lineup/formations";
import { autoPickLineup, isAvailable, type SquadPlayer } from "@/engine/lineup/autopick";
import { saveLineupAction } from "@/server/actions";
import { Button, Card, CardTitle, OvrBadge, POS_LABEL, cn, inputCls } from "./ui";

interface P extends SquadPlayer { name: string; form: number }

/** Map the engine's auto-pick onto the formation's slot order. */
function autoAssigned(squad: SquadPlayer[], f: Formation): { assigned: (string | null)[]; bench: string[] } {
  const auto = autoPickLineup(squad, f);
  const used = new Set<number>();
  const assigned = FORMATION_SLOTS[f].map((slot) => {
    const k = auto.starters.findIndex((s, i) => s.slot === slot && !used.has(i));
    if (k === -1) return null;
    used.add(k);
    return auto.starters[k].player_id;
  });
  return { assigned, bench: auto.bench };
}

const TACTIC_OPTIONS: { key: keyof Tactics; label: string; opts: [string, string][]; help: string }[] = [
  { key: "mentality", label: "Mentalidade", opts: [["defensive", "Defensiva"], ["balanced", "Equilibrada"], ["attacking", "Ofensiva"]], help: "Ofensiva cria mais ocasiões mas expõe a defesa." },
  { key: "pressing", label: "Pressão", opts: [["low", "Baixa"], ["medium", "Média"], ["high", "Alta"]], help: "Alta recupera bolas à frente, cansa mais e deixa espaço nas costas." },
  { key: "defensive_line", label: "Linha defensiva", opts: [["low", "Baixa"], ["medium", "Média"], ["high", "Alta"]], help: "Alta comprime o campo mas é vulnerável a bolas em profundidade." },
  { key: "tempo", label: "Ritmo", opts: [["slow", "Lento"], ["normal", "Normal"], ["high", "Alto"]], help: "Alto acelera posses e aumenta o desgaste." },
  { key: "passing_directness", label: "Passe", opts: [["short", "Curto"], ["mixed", "Misto"], ["direct", "Direto"]], help: "Direto progride rápido mas perde mais bolas." },
  { key: "width", label: "Largura", opts: [["narrow", "Estreita"], ["balanced", "Equilibrada"], ["wide", "Larga"]], help: "Larga gera mais cruzamentos e cabeceamentos." },
  { key: "transitions", label: "Transições", opts: [["possession", "Posse"], ["balanced", "Equilibradas"], ["counter", "Contra-ataque"]], help: "Contra-ataque aproveita recuperações para atacar depressa." },
];

export function TacticsBoard(props: {
  gameId: string; locked: boolean; squad: P[]; initialFormation: string; initialStarters: { player_id: string; slot: Slot }[] | null;
  initialBench: string[]; initialTactics: Tactics; warnings: string[];
}) {
  const byId = useMemo(() => new Map(props.squad.map((p) => [p.id, p])), [props.squad]);
  const initial = useMemo(() => {
    const f = (FORMATIONS.includes(props.initialFormation as Formation) ? props.initialFormation : "4-3-3") as Formation;
    if (props.initialStarters?.length) {
      const slots = FORMATION_SLOTS[f];
      const assigned: (string | null)[] = slots.map(() => null);
      for (const s of props.initialStarters) {
        const idx = slots.findIndex((slot, i) => slot === s.slot && assigned[i] === null);
        if (idx >= 0 && byId.has(s.player_id)) assigned[idx] = s.player_id;
      }
      return { f, assigned, bench: props.initialBench.filter((id) => byId.has(id)) };
    }
    return { f, ...autoAssigned(props.squad, f) };
  }, [props, byId]);

  const [formation, setFormation] = useState<Formation>(initial.f);
  const [assigned, setAssigned] = useState<(string | null)[]>(initial.assigned);
  const [bench, setBench] = useState<string[]>(initial.bench);
  const [tactics, setTactics] = useState<Tactics>(props.initialTactics);
  const [picked, setPicked] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const slots = FORMATION_SLOTS[formation];
  const coords = slotCoordinates(formation);
  const coordIdx = useMemo(() => {
    const used = new Set<number>();
    return slots.map((s) => {
      const i = coords.findIndex((c, k) => c.slot === s && !used.has(k));
      used.add(i);
      return coords[i];
    });
  }, [slots, coords]);

  function autoFill(f = formation) {
    const a = autoAssigned(props.squad, f);
    setAssigned(a.assigned);
    setBench(a.bench);
  }

  function changeFormation(f: Formation) {
    setFormation(f);
    // keep players, re-map by best suitability
    const pool = assigned.filter(Boolean) as string[];
    const sl = FORMATION_SLOTS[f];
    const next: (string | null)[] = sl.map(() => null);
    const order = sl.map((_, i) => i).sort((a, b) => (sl[a] === "GK" ? -1 : sl[b] === "GK" ? 1 : 0));
    for (const i of order) {
      let best = -1, score = -1;
      pool.forEach((id, k) => {
        const p = byId.get(id)!;
        const s = slotSuitability(p.position_group, sl[i]) * p.current_ovr;
        if (s > score) { score = s; best = k; }
      });
      if (best >= 0) next[i] = pool.splice(best, 1)[0];
    }
    setAssigned(next);
  }

  function assign(slotIdx: number, playerId: string | null) {
    setAssigned((cur) => {
      const next = [...cur];
      const prevIdx = playerId ? next.indexOf(playerId) : -1;
      if (prevIdx >= 0) next[prevIdx] = next[slotIdx]; // swap
      next[slotIdx] = playerId;
      return next;
    });
    if (playerId) setBench((b) => b.filter((x) => x !== playerId));
    setPicked(null);
  }

  function toggleBench(id: string) {
    setBench((b) => (b.includes(id) ? b.filter((x) => x !== id) : b.length >= 9 ? b : [...b, id]));
    setAssigned((a) => a.map((x) => (x === id ? null : x)));
  }

  const startersValid = assigned.every((x) => x !== null);
  const avg = startersValid ? Math.round((assigned as string[]).reduce((s, id) => s + byId.get(id)!.current_ovr * slotSuitability(byId.get(id)!.position_group, slots[assigned.indexOf(id)]), 0) / 11) : null;

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveLineupAction({
        gameId: props.gameId, formation,
        starters: (assigned as string[]).map((id, i) => ({ player_id: id, slot: slots[i] })),
        bench, tactics,
      });
      setMsg(r.error ? { text: r.error } : { ok: true, text: r.message ?? "Guardado." });
    });
  }

  const reserves = props.squad.filter((p) => !assigned.includes(p.id));

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted" htmlFor="formation">Formação</label>
            <select id="formation" className={cn(inputCls, "w-auto")} value={formation} onChange={(e) => changeFormation(e.target.value as Formation)} disabled={props.locked}>
              {FORMATIONS.map((f) => <option key={f}>{f}</option>)}
            </select>
            <Button variant="secondary" onClick={() => autoFill()} disabled={props.locked} type="button">Auto-escalar</Button>
            {avg !== null && <span className="ml-auto text-sm text-muted">Força efetiva do onze: <b className="text-ink tabular">{avg}</b></span>}
          </div>
          <div className="relative mx-auto aspect-[3/4] max-h-[620px] w-full max-w-[480px] overflow-hidden rounded-xl border border-emerald-900/60 bg-[repeating-linear-gradient(0deg,#0f3d2a_0,#0f3d2a_8%,#0d3524_8%,#0d3524_16%)]">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 133" preserveAspectRatio="none" aria-hidden>
              <g fill="none" stroke="rgba(255,255,255,.35)" strokeWidth=".4">
                <rect x="3" y="3" width="94" height="127" /><line x1="3" y1="66.5" x2="97" y2="66.5" /><circle cx="50" cy="66.5" r="9" />
                <rect x="25" y="3" width="50" height="16" /><rect x="25" y="114" width="50" height="16" />
              </g>
            </svg>
            {slots.map((slot, i) => {
              const c = coordIdx[i];
              const p = assigned[i] ? byId.get(assigned[i]!) : null;
              const suit = p ? slotSuitability(p.position_group, slot) : 1;
              return (
                <button key={i} type="button" disabled={props.locked}
                  onClick={() => (picked ? assign(i, picked) : setPicked(null))}
                  className={cn("absolute flex w-24 -translate-x-1/2 translate-y-1/2 flex-col items-center gap-0.5 rounded-lg p-1 text-center",
                    picked ? "ring-2 ring-info/60" : "")}
                  style={{ left: `${c.x}%`, bottom: `${c.y}%` }}
                  aria-label={`${slot}: ${p ? p.name : "vazio"}${picked ? " — clicar para colocar aqui" : ""}`}>
                  {p ? <OvrBadge ovr={p.current_ovr} size="sm" /> : <span className="h-7 w-7 rounded-lg border border-dashed border-white/50" />}
                  <span className="max-w-full truncate rounded bg-black/55 px-1 text-[11px] font-semibold">{p ? p.name.split(" ").slice(-1)[0] : slot}</span>
                  <span className={cn("text-[10px] font-bold", suit < 0.95 ? "text-warn" : "text-white/70")}>{slot}{suit < 0.95 ? " ⚠" : ""}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted">Toque num jogador da lista e depois num lugar do campo para o colocar (ou use as listas abaixo). ⚠ = fora da posição natural (penalização).</p>
        </Card>

        <Card>
          <CardTitle>Onze (lista acessível)</CardTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {slots.map((slot, i) => (
              <label key={i} className="flex items-center gap-2 text-sm">
                <span className="w-10 shrink-0 font-bold text-muted">{slot}</span>
                <select className={inputCls} value={assigned[i] ?? ""} disabled={props.locked} onChange={(e) => assign(i, e.target.value || null)}>
                  <option value="">— vazio —</option>
                  {props.squad.filter(isAvailable).sort((a, b) => slotSuitability(b.position_group, slot) * b.current_ovr - slotSuitability(a.position_group, slot) * a.current_ovr).map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {POS_LABEL[p.position_group]} {p.current_ovr}{SLOT_GROUP[slot] !== p.position_group ? " (adaptado)" : ""}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardTitle>Instruções táticas</CardTitle>
          <div className="space-y-3">
            {TACTIC_OPTIONS.map((t) => (
              <div key={t.key}>
                <p className="mb-1 text-sm font-medium">{t.label}</p>
                <div role="radiogroup" aria-label={t.label} className="grid grid-cols-3 gap-1 rounded-lg bg-bg p-1">
                  {t.opts.map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={tactics[t.key] === v} disabled={props.locked}
                      onClick={() => setTactics((x) => ({ ...x, [t.key]: v }))}
                      className={cn("rounded-md px-2 py-1.5 text-xs font-semibold", tactics[t.key] === v ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}>{l}</button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-faint">{t.help}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card>
          <CardTitle>Plantel ({bench.length}/9 no banco)</CardTitle>
          <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1 text-sm">
            {reserves.map((p) => {
              const unavailable = !isAvailable(p);
              return (
                <li key={p.id} className={cn("flex items-center gap-2 rounded-lg px-2 py-1", picked === p.id && "bg-info/15", unavailable && "opacity-50")}>
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" disabled={unavailable || props.locked} onClick={() => setPicked(picked === p.id ? null : p.id)} aria-pressed={picked === p.id}>
                    <OvrBadge ovr={p.current_ovr} size="sm" />
                    <span className="truncate">{p.name}</span>
                    <span className="text-xs text-muted">{POS_LABEL[p.position_group]}</span>
                    {p.injured_matches > 0 && <span className="text-xs text-danger">lesionado</span>}
                    {p.suspension_matches > 0 && <span className="text-xs text-warn">suspenso</span>}
                  </button>
                  {!unavailable && (
                    <label className="flex items-center gap-1 text-xs text-muted">
                      <input type="checkbox" checked={bench.includes(p.id)} onChange={() => toggleBench(p.id)} disabled={props.locked} /> banco
                    </label>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        {props.warnings.length > 0 && <p className="text-xs text-warn">Avisos da última correção automática: {props.warnings.join(", ")}</p>}
        <div className="sticky bottom-3">
          <Button className="w-full" onClick={save} disabled={!startersValid || pending || props.locked} type="button">
            {props.locked ? "Bloqueado durante a jornada" : pending ? "A guardar…" : startersValid ? "Guardar escalação e tática" : "Completa o onze"}
          </Button>
          <p aria-live="polite" className={cn("mt-2 text-center text-sm", msg?.ok ? "text-accent" : "text-danger")}>{msg?.text}</p>
        </div>
      </div>
    </div>
  );
}
