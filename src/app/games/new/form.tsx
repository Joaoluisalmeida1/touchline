"use client";
import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { Field, inputCls } from "@/components/ui";
import { createGameAction } from "@/server/actions";

interface Opt { snapshotId: string; label: string; synthetic: boolean; leagueId: string; leagueName: string; clubs: number }

export function NewGameForm({ options }: { options: Opt[] }) {
  const [sel, setSel] = useState(0);
  const o = options[sel];
  return (
    <ActionForm action={createGameAction} submitLabel="Criar liga" pendingLabel="A criar plantéis e clubes…" hidden={{ snapshotId: o.snapshotId, leagueId: o.leagueId }}>
      <Field label="Nome da liga">
        <input name="name" required minLength={3} maxLength={60} placeholder="Liga dos Amigos" className={inputCls} />
      </Field>
      <Field label="Competição base" hint={`${o.clubs} clubes. Os clubes sem treinador humano são geridos pela IA.${o.synthetic ? " ATENÇÃO: dataset de desenvolvimento com dados fictícios." : ""}`}>
        <select className={inputCls} value={sel} onChange={(e) => setSel(Number(e.target.value))}>
          {options.map((x, i) => (
            <option key={`${x.snapshotId}-${x.leagueId}`} value={i}>{x.leagueName} — {x.label}{x.synthetic ? " (fictício)" : ""}</option>
          ))}
        </select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Máximo de managers">
          <input name="maxManagers" type="number" min={2} max={20} defaultValue={Math.min(20, o.clubs)} className={inputCls} />
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
