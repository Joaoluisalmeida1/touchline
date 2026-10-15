"use client";
import {
  DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, CircleCheck, CircleX, Info, LayoutGrid, ListOrdered, LoaderCircle, Lock, Redo2, Save, Shirt, SlidersHorizontal, Undo2, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import type { Formation, LineupInstructions, PositionGroup, Tactics } from "@/engine/common/types";
import type { AutoPickMode } from "@/engine/lineup/autopick";
import { FORMATION_SLOTS, SLOT_LABEL } from "@/engine/lineup/formations";
import { saveLineupAction } from "@/server/actions";
import { AnimatedNumber } from "../fx/animated-number";
import { Bar } from "../fx/motion";
import { PillTabs } from "../fx/tabs";
import { Button, Card, CardTitle, OvrBadge, POS_LABEL, POS_TONE, cn } from "../ui";
import { ClubBadge } from "./avatar";
import { DepthChart } from "./depth";
import {
  MAX_BENCH, autoPick, changeFormation, cleanInstructions, fromPreset, lineupWarnings, locate, movePlayer, sameState, strength,
  toPreset, toSavePayload, type Zone,
} from "./editor";
import { FormationPicker } from "./formation-picker";
import { InstructionsTab } from "./instructions";
import { ListView } from "./list-view";
import { DropZone, Draggable, Pitch, PitchToken, PlayerChip } from "./pitch";
import { PlayerPanel } from "./player-panel";
import type { ClubLook, EditorState, PresetPayload, SquadP } from "./types";

export type HubTab = "equipa" | "instrucoes" | "lista" | "profundidade";
const TABS = [
  { id: "equipa", label: "Equipa", icon: <Shirt className="hidden size-4 sm:block" /> },
  { id: "instrucoes", label: "Instruções", icon: <SlidersHorizontal className="hidden size-4 sm:block" /> },
  { id: "lista", label: "Lista", icon: <ListOrdered className="hidden size-4 sm:block" /> },
  { id: "profundidade", label: "Profundidade", icon: <LayoutGrid className="hidden size-4 sm:block" /> },
] satisfies { id: HubTab; label: string; icon: React.ReactNode }[];

export function SquadHub(props: {
  gameId: string; squad: SquadP[]; look: ClubLook; clubId: string; season: number; locked: boolean;
  initial: EditorState; saved: boolean; presets: { id: string; name: string; payload: PresetPayload }[];
  initialTab: HubTab; serverWarnings: string[];
}) {
  const { squad, look, locked, gameId } = props;
  const byId = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);
  const [tab, setTab] = useState<HubTab>(props.initialTab);
  const [st, setSt] = useState<EditorState>(props.initial);
  const [baseline, setBaseline] = useState<EditorState>(props.initial);
  const [past, setPast] = useState<EditorState[]>([]);
  const [future, setFuture] = useState<EditorState[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); }, [toast]);
  const say = useCallback((ok: boolean, text: string) => setToast({ ok, text }), []);

  const commit = (next: EditorState) => {
    if (sameState(st, next)) return;
    setPast((p) => [...p.slice(-49), st]);
    setFuture([]);
    setSt(next);
  };
  const undo = () => { if (!past.length) return; setFuture((f) => [st, ...f]); setSt(past[past.length - 1]); setPast((p) => p.slice(0, -1)); };
  const redo = () => { if (!future.length) return; setPast((p) => [...p, st]); setSt(future[0]); setFuture((f) => f.slice(1)); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.closest("input,textarea,select")) return;
      if (e.key.toLowerCase() === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const dirty = !sameState(st, baseline);
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const move = (id: string, to: Zone) => {
    if (locked) return;
    const r = movePlayer(squad, st, id, to);
    if (r.error) say(false, r.error);
    else commit(r.state);
  };

  // ---------- tap-to-place ----------
  const tapPlayer = (id: string) => {
    if (!selected || selected === id) { setSelected(selected === id ? null : id); return; }
    const target = locate(st, id);
    const from = locate(st, selected);
    if (target.kind === "slot") move(selected, { kind: "slot", index: target.index });
    else if (target.kind === "bench" && from.kind !== "bench") move(selected, { kind: "bench", index: target.index });
    else { setSelected(id); return; }
    setSelected(null);
  };
  const tapSlot = (index: number) => {
    const occupant = st.xi[index];
    if (selected && selected !== occupant) { move(selected, { kind: "slot", index }); setSelected(null); return; }
    if (occupant) setSelected(selected === occupant ? null : occupant);
  };

  // ---------- drag & drop ----------
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 160, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );
  const onDragStart = (e: DragStartEvent) => setDragId((e.active.data.current as { playerId: string }).playerId);
  const onDragEnd = (e: DragEndEvent) => {
    setDragId(null);
    const id = (e.active.data.current as { playerId: string } | undefined)?.playerId;
    const over = e.over?.id ? String(e.over.id) : null;
    if (!id || !over) return;
    if (over.startsWith("slot:")) move(id, { kind: "slot", index: Number(over.slice(5)) });
    else if (over.startsWith("benchp:")) move(id, { kind: "bench", index: Number(over.slice(7)) });
    else if (over === "bench") move(id, { kind: "bench" });
    else if (over === "reserves") move(id, { kind: "reserves" });
  };

  const save = () => start(async () => {
    const payload = toSavePayload(st);
    const r = await saveLineupAction({ gameId, ...payload, instructions: Object.fromEntries(Object.entries(payload.instructions).map(([k, v]) => [k, v ?? null])) });
    if (r.error) say(false, r.error);
    else { say(true, r.message ?? "Guardado."); setBaseline(st); }
  });

  const s = strength(squad, st);
  const s0 = useMemo(() => strength(squad, baseline), [squad, baseline]);
  const warnings = lineupWarnings(squad, st);
  const complete = st.xi.every((x) => x);
  const blocking = warnings.some((w) => w.level === "error");
  const sel = selected ? byId.get(selected) : undefined;
  const selWhere = selected ? locate(st, selected) : null;
  const slots = FORMATION_SLOTS[st.formation];
  const reserves = squad.filter((p) => !st.xi.includes(p.id) && !st.bench.includes(p.id));
  const dragged = dragId ? byId.get(dragId) : undefined;

  const panel = sel && (
    <PlayerPanel key={sel.id} p={sel} gameId={gameId} look={look} season={props.season} locked={locked}
      slot={selWhere?.kind === "slot" ? slots[selWhere.index] : null} slotIndex={selWhere?.kind === "slot" ? selWhere.index : null}
      role={selWhere?.kind === "slot" ? st.roles[selWhere.index] : null} ins={st.ins} inMatchday={selWhere?.kind !== "reserves"}
      onRole={(i, role) => commit({ ...st, roles: st.roles.map((r, k) => (k === i ? role : r)) })}
      onIns={(k, id) => commit(cleanInstructions({ ...st, ins: { ...st.ins, [k]: id } }))}
      onClose={() => setSelected(null)} onToast={say} />
  );

  return (
    <div className="space-y-4 pb-28 [&_[role=presentation]]:select-none">
      <div className="flex flex-wrap items-center gap-3">
        <ClubBadge seed={props.clubId} name={look.name} short={look.short} primary={look.primary} secondary={look.secondary} size={40} className="hidden sm:block" />
        <div className="no-scrollbar -mx-4 max-w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:max-w-full sm:px-0">
          <PillTabs label="Plantel" value={tab} onChange={setTab} tabs={TABS} />
        </div>
        {locked && <span className="flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-xs font-semibold text-warn"><Lock className="size-3.5" />Jornada em processamento — edição bloqueada</span>}
      </div>

      <DndContext sensors={sensors} collisionDetection={pointerWithin} autoScroll={{ threshold: { x: 0, y: 0.08 }, acceleration: 6 }} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
        {tab === "equipa" && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-3">
              <Card className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <FormationPicker value={st.formation} disabled={locked} onChange={(f: Formation) => commit(changeFormation(squad, st, f))} />
                  <AutoMenu disabled={locked} onPick={(m) => { commit(autoPick(squad, st, m)); say(true, "Onze sugerido aplicado."); }} />
                  <div className="ml-auto flex items-center gap-1">
                    <Button type="button" variant="ghost" className="min-h-10 px-2.5" onClick={undo} disabled={!past.length} title="Desfazer (Ctrl+Z)" aria-label="Desfazer"><Undo2 className="size-4" /></Button>
                    <Button type="button" variant="ghost" className="min-h-10 px-2.5" onClick={redo} disabled={!future.length} title="Refazer (Ctrl+Shift+Z)" aria-label="Refazer"><Redo2 className="size-4" /></Button>
                  </div>
                </div>
                {s && <StrengthBars s={s} base={s0} />}
              </Card>
              <Pitch squad={squad} st={st} look={look} selected={selected} locked={locked} onSlotClick={tapSlot} />
              <p className="text-center text-xs text-faint">
                Arrasta jogadores entre o campo, o banco e as reservas — ou toca num jogador e depois no destino. O anel indica a adaptação à posição
                (<span className="text-accent">verde</span> ≥97%, <span className="text-warn">amarelo</span> ≥90%, <span className="text-danger">vermelho</span> abaixo).
              </p>
            </div>

            <div className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-8.5rem)] lg:self-start lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin]">
              {panel ? <Card>{panel}</Card> : (
                <Card>
                  <CardTitle icon={<CircleCheck />}>Estado do onze</CardTitle>
                  <Warnings list={warnings} server={props.serverWarnings} />
                </Card>
              )}
              <DropZone id="bench" className="rounded-[var(--radius-card)]" activeClassName="ring-2 ring-accent">
                <Card>
                  <CardTitle action={<span className="text-xs text-muted tabular">{st.bench.length}/{MAX_BENCH}</span>}>Banco</CardTitle>
                  <ul className="space-y-1.5">
                    {st.bench.map((id, i) => {
                      const p = byId.get(id);
                      if (!p) return null;
                      return (
                        <li key={id}>
                          <DropZone id={`benchp:${i}`} className="rounded-lg" activeClassName="ring-2 ring-accent">
                            <Draggable id={id} disabled={locked}>
                              <button type="button" className="block w-full text-left" onClick={() => tapPlayer(id)} disabled={locked}>
                                <PlayerChip p={p} look={look} selected={selected === id}
                                  sub={<><span className={cn("font-bold", POS_TONE[p.group])}>{p.preferred_slot ? SLOT_LABEL[p.preferred_slot] : POS_LABEL[p.group]}</span><span>· cond. {p.fitness}%</span>{st.ins.penalty_taker === id && <span>· penáltis</span>}</>}
                                  right={<OvrBadge ovr={p.ovr} size="sm" />} />
                              </button>
                            </Draggable>
                          </DropZone>
                        </li>
                      );
                    })}
                    {st.bench.length < MAX_BENCH && (
                      <li className="rounded-xl border border-dashed border-line-strong px-3 py-2.5 text-center text-xs text-faint">
                        {selected && locate(st, selected).kind !== "bench"
                          ? <button type="button" className="font-semibold text-accent" onClick={() => { move(selected, { kind: "bench" }); setSelected(null); }}>Pôr {byId.get(selected)?.name} no banco</button>
                          : "Arrasta para aqui"}
                      </li>
                    )}
                  </ul>
                </Card>
              </DropZone>
              <DropZone id="reserves" className="rounded-[var(--radius-card)]" activeClassName="ring-2 ring-accent">
                <Card>
                  <CardTitle action={selected && locate(st, selected).kind !== "reserves"
                    ? <button type="button" className="text-xs font-semibold text-accent" onClick={() => { move(selected, { kind: "reserves" }); setSelected(null); }}>Retirar da convocatória</button>
                    : <span className="text-xs text-muted">{reserves.length}</span>}>Não convocados</CardTitle>
                  {(["GK", "DEF", "MID", "ATT"] as PositionGroup[]).map((g) => {
                    const list = reserves.filter((p) => p.group === g);
                    if (!list.length) return null;
                    return (
                      <div key={g} className="mb-2 last:mb-0">
                        <p className={cn("mb-1 text-[11px] font-bold uppercase tracking-wider", POS_TONE[g])}>{{ GK: "Guarda-redes", DEF: "Defesas", MID: "Médios", ATT: "Avançados" }[g]}</p>
                        <ul className="space-y-1.5">
                          {list.map((p) => (
                            <li key={p.id}>
                              <Draggable id={p.id} disabled={locked}>
                                <button type="button" className="block w-full text-left" onClick={() => tapPlayer(p.id)} disabled={locked}>
                                  <PlayerChip p={p} look={look} selected={selected === p.id}
                                    sub={<>{p.preferred_slot && <span className="font-bold">{SLOT_LABEL[p.preferred_slot]}</span>}<span>cond. {p.fitness}%</span>
                                      {p.injured > 0 && <span className="text-danger">· lesionado {p.injured}j</span>}{p.suspended > 0 && <span className="text-warn">· suspenso</span>}</>}
                                    right={<OvrBadge ovr={p.ovr} size="sm" />} />
                                </button>
                              </Draggable>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </Card>
              </DropZone>
            </div>
          </div>
        )}
        <DragOverlay dropAnimation={null}>
          {dragged && (
            <div className="pointer-events-none">
              <PitchToken p={dragged} slot={dragged.preferred_slot ?? ({ GK: "GK", DEF: "CB", MID: "CM", ATT: "ST" } as const)[dragged.group]} look={look} compact />
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {tab === "instrucoes" && (
        <InstructionsTab gameId={gameId} squad={squad} st={st} locked={locked} presets={props.presets}
          onTactics={(t: Tactics) => commit({ ...st, tactics: t })}
          onIns={(k: keyof LineupInstructions, id) => commit(cleanInstructions({ ...st, ins: { ...st.ins, [k]: id } }))}
          onApplyPreset={(p) => { commit(fromPreset(squad, p)); say(true, "Predefinição aplicada ao editor. Revê e guarda."); setTab("equipa"); }}
          currentPreset={() => toPreset(st)} onToast={say} />
      )}
      {tab === "lista" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <ListView squad={squad} st={st} look={look} selected={selected} onOpen={(id) => setSelected(id)} />
          {panel && <Card className="xl:sticky xl:top-4 xl:self-start">{panel}</Card>}
        </div>
      )}
      {tab === "profundidade" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <DepthChart squad={squad} st={st} look={look} onOpen={(id) => setSelected(id)} />
          {panel && <Card className="xl:sticky xl:top-4 xl:self-start">{panel}</Card>}
        </div>
      )}

      {/* floating save bar (sits above the mobile dock) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(66px+env(safe-area-inset-bottom))] z-30 px-3 md:bottom-5">
        <motion.div layout className={cn("pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-2xl border bg-surface/95 p-2 pl-4 shadow-[0_20px_50px_-15px_rgb(0_0_0/.9)] backdrop-blur-xl sm:gap-3",
          dirty ? "border-accent/40" : "border-line-strong")}>
          <div className="min-w-0 flex-1 text-sm" aria-live="polite">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={toast ? `t-${toast.text}` : locked ? "l" : dirty ? "d" : "s"} className="flex items-center gap-2 truncate"
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6, filter: "blur(4px)" }} transition={{ duration: 0.18 }}>
                {toast ? <><span className={cn("flex size-5 shrink-0 items-center justify-center rounded-full", toast.ok ? "bg-accent text-accent-ink" : "bg-danger text-white")}>{toast.ok ? <CircleCheck className="size-3.5" /> : <CircleX className="size-3.5" />}</span><span className={cn("truncate font-semibold", toast.ok ? "text-accent" : "text-danger")}>{toast.text}</span></>
                  : locked ? <span className="flex items-center gap-1.5 text-warn"><Lock className="size-3.5" />Bloqueado durante a jornada.</span>
                  : dirty ? <><span className="size-2 shrink-0 animate-pulse-dot rounded-full bg-accent" /><span className="truncate font-semibold text-ink">Alterações por guardar</span></>
                  : <span className="truncate text-muted">{props.saved ? "Escalação guardada." : "Ainda não guardaste nenhuma escalação — a IA escolhe por ti."}</span>}
              </motion.p>
            </AnimatePresence>
          </div>
          {dirty && <Button type="button" variant="ghost" className="hidden sm:inline-flex" onClick={() => { commit(baseline); }} disabled={pending}>Descartar</Button>}
          <Button type="button" onClick={save} disabled={locked || pending || !complete || blocking || (!dirty && props.saved)}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {pending ? "A guardar…" : !complete ? "Completa o onze" : "Guardar escalação"}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

function AutoMenu({ onPick, disabled }: { onPick: (m: AutoPickMode) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const opts: [AutoPickMode, string, string][] = [
    ["best", "Melhor onze", "Os mais fortes, com penalização por cansaço."],
    ["rest", "Poupar cansados", "Evita quem tem a condição física em baixo."],
    ["rotate", "Rodar plantel", "Dá minutos a quem tem jogado menos."],
  ];
  return (
    <div className="relative">
      <Button type="button" variant="secondary" className="min-h-10" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Wand2 className="size-4 text-accent" />Auto-escalar
      </Button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6, scale: 0.97, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
            className="absolute left-0 z-40 mt-2 w-72 origin-top-left rounded-2xl border border-line-strong bg-surface p-1.5 shadow-2xl" onMouseLeave={() => setOpen(false)}>
            {opts.map(([m, l, d]) => (
              <button key={m} type="button" className="block w-full rounded-xl px-3 py-2.5 text-left transition hover:bg-surface-2" onClick={() => { onPick(m); setOpen(false); }}>
                <span className="text-sm font-bold">{l}</span><span className="block text-[11px] text-muted">{d}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function StrengthBars({ s, base }: { s: NonNullable<ReturnType<typeof strength>>; base: ReturnType<typeof strength> }) {
  const items: [string, number, number | undefined, string][] = [
    ["Meio-campo", s.control, base?.control, "Controlo da posse e progressão"],
    ["Ataque", s.attack, base?.attack, "Criação de ocasiões"],
    ["Defesa", s.defense, base?.defense, "Travar o ataque adversário"],
    ["Baliza", s.keeper, base?.keeper, "Guarda-redes"],
  ];
  return (
    <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
      {items.map(([l, v, b, help]) => {
        const d = b === undefined ? 0 : Math.round((v - b) * 10) / 10;
        return (
          <div key={l} title={help}>
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{l}</span>
              <span className="flex items-baseline gap-1">
                <AnimatePresence>{d !== 0 && (
                  <motion.span initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.6 }}
                    className={cn("rounded px-1 font-display text-[11px] font-bold", d > 0 ? "bg-accent/15 text-accent" : "bg-danger/15 text-danger")}>{d > 0 ? `+${d}` : d}</motion.span>
                )}</AnimatePresence>
                <AnimatedNumber value={v} format="dec1" className="font-display text-xl font-extrabold leading-none" />
              </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line">
              <Bar pct={Math.max(4, Math.min(100, ((v - 45) / 50) * 100))} className="h-full rounded-full bg-gradient-to-r from-accent/60 to-accent" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Warnings({ list, server }: { list: ReturnType<typeof lineupWarnings>; server: string[] }) {
  if (!list.length && !server.length) return <p className="flex items-center gap-2 text-sm font-semibold text-accent"><CircleCheck className="size-4" />Tudo em ordem.</p>;
  const tone = { error: "text-danger", warn: "text-warn", info: "text-muted" } as const;
  const icon = { error: <CircleX className="size-4" />, warn: <AlertTriangle className="size-4" />, info: <Info className="size-4" /> } as const;
  return (
    <ul className="space-y-1.5 text-sm">
      {list.map((w, i) => (
        <li key={i} className={cn("flex gap-2 rounded-xl bg-bg/50 px-2.5 py-2", tone[w.level])}>
          <span className="mt-0.5 shrink-0">{icon[w.level]}</span>
          <span>{w.text}</span>
        </li>
      ))}
      {server.length > 0 && <li className="pt-1 text-xs text-faint">Última correção automática do servidor: {server.length} ajuste(s).</li>}
    </ul>
  );
}

