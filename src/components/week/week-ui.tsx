"use client";
import { Check, Crosshair, Megaphone, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, useTransition, type ReactNode } from "react";
import { answerPressAction, saveMatchPlanAction } from "@/server/actions";
import { PillTabs } from "../fx/tabs";
import { Badge, Button, Card, CardTitle, PosPill, cn, inputCls } from "../ui";

/* ------------------------------------------------------------------ tabs shell */

export type WeekTab = "gabinete" | "imprensa" | "treino" | "adversario";

export function WeekTabs({ panels, badges, initial }: { panels: Record<WeekTab, ReactNode>; badges: Partial<Record<WeekTab, number>>; initial: WeekTab }) {
  const [tab, setTab] = useState<WeekTab>(initial);
  const dot = (n?: number) => (n ? <span className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-extrabold text-accent-ink">{n}</span> : null);
  return (
    <div className="space-y-5">
      <PillTabs label="Semana de jornada" value={tab} onChange={setTab} stretch tabs={[
        { id: "gabinete", label: <>Gabinete{dot(badges.gabinete)}</> },
        { id: "imprensa", label: <>Imprensa{dot(badges.imprensa)}</> },
        { id: "treino", label: "Treino" },
        { id: "adversario", label: "Adversário" },
      ]} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
          {panels[tab]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function useToast() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const el = (
    <div aria-live="polite" className="min-h-5 text-sm">
      {msg && <p className={cn("font-medium", msg.ok ? "text-accent" : "text-danger")}>{msg.text}</p>}
    </div>
  );
  return { el, say: (ok: boolean, text: string) => setMsg({ ok, text }) };
}

/* ------------------------------------------------------------------ press conference */

export const TONES: { id: "confident" | "calm" | "provocative" | "evasive"; label: string; hint: string; cls: string }[] = [
  { id: "confident", label: "Confiante", hint: "+moral e um pouco mais de controlo do jogo", cls: "data-[on=true]:bg-accent data-[on=true]:text-accent-ink" },
  { id: "calm", label: "Calmo", hint: "+moral; imune às provocações do rival", cls: "data-[on=true]:bg-info data-[on=true]:text-[#00202e]" },
  { id: "provocative", label: "Provocador", hint: "+moral; desestabiliza um rival humano (se ele não responder com calma)", cls: "data-[on=true]:bg-danger data-[on=true]:text-white" },
  { id: "evasive", label: "Evasivo", hint: "sem efeitos", cls: "data-[on=true]:bg-surface-3 data-[on=true]:text-ink" },
];

export function PressConference({ gameId, confId, questions, opponent, rivalHuman, disabled }: {
  gameId: string; confId: string; questions: { key: string; text: string }[]; opponent: string; rivalHuman: boolean; disabled?: boolean;
}) {
  const [ans, setAns] = useState(() => questions.map((q) => ({ key: q.key, tone: "" as string, text: "" })));
  const [pending, start] = useTransition();
  const { el, say } = useToast();
  const set = (i: number, patch: Partial<(typeof ans)[number]>) => setAns((a) => a.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const ready = ans.every((a) => a.tone);
  const submit = () => start(async () => {
    const r = await answerPressAction({ gameId, confId, answers: ans as never });
    say(!r.error, r.error ?? r.message ?? "Feito.");
  });
  return (
    <Card>
      <CardTitle icon={<Megaphone />} action={rivalHuman ? <Badge tone="danger">Rival humano</Badge> : undefined}>Antevisão · {opponent}</CardTitle>
      <ol className="space-y-5">
        {questions.map((q, i) => (
          <li key={q.key} className="space-y-2.5">
            <p className="flex gap-2 text-[15px] font-semibold leading-snug"><span className="font-display text-faint">{i + 1}.</span>{q.text}</p>
            <div role="radiogroup" aria-label={`Tom da resposta ${i + 1}`} className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-bg/70 p-1 sm:grid-cols-4">
              {TONES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={ans[i].tone === t.id} data-on={ans[i].tone === t.id} title={t.hint} disabled={disabled || pending}
                  onClick={() => set(i, { tone: t.id })}
                  className={cn("rounded-lg px-2 py-2 text-xs font-bold text-muted transition hover:bg-surface-2 hover:text-ink", t.cls)}>{t.label}</button>
              ))}
            </div>
            <div className="relative">
              <textarea rows={2} maxLength={280} disabled={disabled || pending} value={ans[i].text} onChange={(e) => set(i, { text: e.target.value })}
                placeholder="Escreve a tua resposta (opcional) — vai ser citada n'O Apito."
                className={cn(inputCls, "min-h-16 resize-none py-2.5 leading-relaxed")} aria-label={`Texto da resposta ${i + 1}`} />
              <span className="pointer-events-none absolute bottom-2 right-3 text-[10px] font-bold text-faint tabular">{ans[i].text.length}/280</span>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="max-w-sm text-xs text-faint">O tom decide o efeito; o texto é teu e fica público na liga depois de responderes.</p>
        <Button type="button" onClick={submit} disabled={!ready || pending || disabled}>{pending ? "A enviar…" : "Responder aos jornalistas"}</Button>
      </div>
      {el}
    </Card>
  );
}

/* ------------------------------------------------------------------ match plan (rules + marking) */

interface Rule { minute: number; when: "losing" | "drawing" | "winning"; mentality?: "defensive" | "balanced" | "attacking"; sub?: { out: string; in: string } }
type Pl = { id: string; name: string; group: string; ovr: number };

const WHEN: [Rule["when"], string][] = [["losing", "a perder"], ["drawing", "empatado"], ["winning", "a ganhar"]];
const MENT: [NonNullable<Rule["mentality"]> | "", string][] = [["", "manter"], ["defensive", "Defensiva"], ["balanced", "Equilibrada"], ["attacking", "Ofensiva"]];

export function MatchPlanEditor({ gameId, initialRules, initialMarking, mine, theirs, opponent, locked }: {
  gameId: string; initialRules: Rule[]; initialMarking: string[]; mine: Pl[]; theirs: Pl[]; opponent: string | null; locked?: boolean;
}) {
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [marking, setMarking] = useState<string[]>(initialMarking.filter((id) => theirs.some((p) => p.id === id)));
  const [pending, start] = useTransition();
  const { el, say } = useToast();
  const upd = (i: number, r: Partial<Rule>) => setRules((xs) => xs.map((x, k) => (k === i ? { ...x, ...r } : x)));
  const save = () => start(async () => {
    const clean = rules.map((r) => ({ minute: r.minute, when: r.when, ...(r.mentality ? { mentality: r.mentality } : {}), ...(r.sub?.out && r.sub?.in ? { sub: r.sub } : {}) }));
    const res = await saveMatchPlanAction({ gameId, rules: clean, marking });
    say(!res.error, res.error ?? res.message ?? "Guardado.");
  });
  const sel = cn(inputCls, "min-h-10 py-1.5 text-xs");
  return (
    <Card>
      <CardTitle icon={<Crosshair />}>Plano de jogo</CardTitle>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Regras na 2.ª parte (até 3)</p>
          <AnimatePresence initial={false}>
            {rules.map((r, i) => (
              <motion.div key={i} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                className="space-y-2 rounded-2xl border border-line bg-bg/50 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-muted">Ao minuto</span>
                  <input type="number" min={46} max={88} value={r.minute} disabled={locked} onChange={(e) => upd(i, { minute: Number(e.target.value) })}
                    className={cn(inputCls, "min-h-10 w-20 py-1.5 tabular")} aria-label="Minuto" />
                  <span className="font-semibold text-muted">se estiver</span>
                  <select value={r.when} disabled={locked} onChange={(e) => upd(i, { when: e.target.value as Rule["when"] })} className={cn(sel, "w-32")} aria-label="Condição">
                    {WHEN.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  <button type="button" onClick={() => setRules((xs) => xs.filter((_, k) => k !== i))} disabled={locked} className="ml-auto rounded-lg p-1.5 text-faint hover:bg-surface-2 hover:text-danger" aria-label="Remover regra"><Trash2 className="size-4" /></button>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <select value={r.mentality ?? ""} disabled={locked} onChange={(e) => upd(i, { mentality: (e.target.value || undefined) as Rule["mentality"] })} className={sel} aria-label="Mentalidade">
                    {MENT.map(([v, l]) => <option key={v} value={v}>{v ? `Mentalidade ${l}` : "Mentalidade: manter"}</option>)}
                  </select>
                  <select value={r.sub?.out ?? ""} disabled={locked} onChange={(e) => upd(i, { sub: { out: e.target.value, in: r.sub?.in ?? "" } })} className={sel} aria-label="Sai">
                    <option value="">Sai: ninguém</option>
                    {mine.map((p) => <option key={p.id} value={p.id}>Sai {p.name}</option>)}
                  </select>
                  <select value={r.sub?.in ?? ""} disabled={locked || !r.sub?.out} onChange={(e) => upd(i, { sub: { out: r.sub?.out ?? "", in: e.target.value } })} className={sel} aria-label="Entra">
                    <option value="">Entra: ninguém</option>
                    {mine.filter((p) => p.id !== r.sub?.out).map((p) => <option key={p.id} value={p.id}>Entra {p.name}</option>)}
                  </select>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {rules.length < 3 && (
            <Button type="button" variant="secondary" disabled={locked} onClick={() => setRules((xs) => [...xs, { minute: 65, when: "losing", mentality: "attacking" }])}>
              <Plus className="size-4" /> Adicionar regra
            </Button>
          )}
          <p className="text-xs text-faint">A substituição só acontece se os dois jogadores estiverem no jogo (titular a sair, suplente a entrar) e ainda houver substituições.</p>
        </div>
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Marcação individual {opponent ? `· ${opponent}` : ""} (até 2)</p>
          {!theirs.length ? <p className="text-sm text-muted">Sem jogo marcado para a próxima jornada.</p> : (
            <ul className="max-h-80 space-y-1 overflow-y-auto pr-1">
              {theirs.slice(0, 16).map((p) => {
                const on = marking.includes(p.id);
                return (
                  <li key={p.id}>
                    <button type="button" disabled={locked || (!on && marking.length >= 2)} aria-pressed={on}
                      onClick={() => setMarking((m) => (on ? m.filter((x) => x !== p.id) : [...m, p.id]))}
                      className={cn("flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition disabled:opacity-40", on ? "bg-accent/10 ring-1 ring-accent/40" : "hover:bg-surface-2")}>
                      <PosPill group={p.group} />
                      <span className="flex-1 truncate font-semibold">{p.name}</span>
                      <span className="font-display font-bold tabular text-muted">{p.ovr}</span>
                      <span className={cn("flex size-5 items-center justify-center rounded-md ring-1", on ? "bg-accent text-accent-ink ring-accent" : "ring-line-strong")}>{on && <Check className="size-3.5" />}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="text-xs text-faint">Cada jogador marcado rende cerca de 6% menos; o custo é meio ponto de controlo do meio-campo por marcação.</p>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        {el}
        <Button type="button" onClick={save} disabled={pending || locked}>{pending ? "A guardar…" : "Guardar plano"}</Button>
      </div>
    </Card>
  );
}
