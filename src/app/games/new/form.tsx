"use client";
import { Check, Plus, Trophy } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, cn, inputCls } from "@/components/ui";
import { createGameAction } from "@/server/actions";

interface Opt { snapshotId: string; label: string; synthetic: boolean; leagueId: string; leagueName: string; country?: string | null; clubs: number }

export function NewGameForm({ options }: { options: Opt[] }) {
  const [sel, setSel] = useState(0);
  const o = options[sel];
  return (
    <ActionForm action={createGameAction} submitLabel="Criar liga" pendingLabel="A criar plantéis e clubes…" icon={<Plus className="size-4" strokeWidth={3} />}
      submitClassName="min-h-12 w-full text-base" hidden={{ snapshotId: o.snapshotId, leagueId: o.leagueId }} className="space-y-6">
      <Field label="Nome da liga">
        <input name="name" required minLength={3} maxLength={60} placeholder="Liga dos Amigos" className={cn(inputCls, "min-h-12 text-base")} />
      </Field>

      <fieldset>
        <legend className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted">Competição base</legend>
        <div role="radiogroup" aria-label="Competição base" className="grid max-h-[340px] gap-2 overflow-y-auto pr-1 thin-scroll sm:grid-cols-2">
          {options.map((x, i) => {
            const on = i === sel;
            return (
              <button key={`${x.snapshotId}-${x.leagueId}`} type="button" role="radio" aria-checked={on} onClick={() => setSel(i)}
                className={cn("relative flex items-center gap-3 rounded-2xl border p-3 text-left transition", on ? "border-accent/60 bg-accent/[.07]" : "border-line bg-bg/50 hover:border-line-strong")}>
                <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl ring-1", on ? "bg-accent text-accent-ink ring-accent" : "bg-surface-2 text-muted ring-line")}>
                  <Trophy className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold">{x.leagueName}</span>
                  <span className="block truncate text-xs text-muted">{x.clubs} clubes · {x.label}{x.synthetic ? " (fictício)" : ""}</span>
                </span>
                {on && (
                  <motion.span layoutId="league-check" className="flex size-5 items-center justify-center rounded-full bg-accent text-accent-ink">
                    <Check className="size-3" strokeWidth={4} />
                  </motion.span>
                )}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-faint">Os clubes sem treinador humano são geridos pela IA.{o.synthetic ? " ATENÇÃO: dataset de desenvolvimento com dados fictícios." : ""}</p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Máximo de managers">
          <input name="maxManagers" type="number" min={2} max={20} defaultValue={Math.min(20, o.clubs)} key={o.leagueId} className={inputCls} />
        </Field>
        <Field label="Avanço de jornadas" hint="Diário depende do cron diário da Vercel (±1h).">
          <select name="tickMode" defaultValue="manual" className={inputCls}>
            <option value="manual">Manual (criador carrega no botão)</option>
            <option value="daily">Diário automático</option>
          </select>
        </Field>
        <Field label="Hora limite das escalações">
          <input name="deadlineHour" type="number" min={0} max={23} defaultValue={20} className={inputCls} />
        </Field>
        <Field label="Horas entre jornadas">
          <input name="roundIntervalHours" type="number" min={1} max={336} defaultValue={24} className={inputCls} />
        </Field>
      </div>
      <input type="hidden" name="timezone" value="Europe/Lisbon" />
    </ActionForm>
  );
}
