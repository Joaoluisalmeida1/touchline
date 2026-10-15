import { ActionForm } from "@/components/action-form";
import { CopyInvite } from "@/components/copy-invite";
import { Badge, Card, CardTitle, Field, inputCls } from "@/components/ui";
import { leaveGameAction, revokeInviteAction, rotateInviteAction, updateSettingsAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { serverEnv } from "@/server/env";
import { getGame, getMembers } from "@/server/queries";

export const metadata = { title: "Definições" };

export default async function Settings({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ invite?: string }> }) {
  const { gameId } = await params;
  const { invite } = await searchParams;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const members = await getMembers(user.id, gameId);
  const base = serverEnv().APP_BASE_URL;
  const s = game.settings_json ?? {};
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {game.is_owner && (
        <Card className="lg:col-span-2">
          <CardTitle>Convite</CardTitle>
          {invite && /^[A-Z2-9]{16}$/.test(invite) ? <CopyInvite code={invite} link={`${base}/join/${invite}`} /> : (
            <p className="text-sm text-muted">Por segurança só guardamos o hash do convite. Gera um novo para o voltares a ver (o anterior deixa de funcionar).</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <RotateInvite gameId={gameId} base={base} />
            <ActionForm action={revokeInviteAction} hidden={{ gameId }} submitLabel="Revogar convite" variant="danger" inline confirm="Revogar? Ninguém poderá entrar até gerares um novo." />
          </div>
        </Card>
      )}
      <Card>
        <CardTitle>Managers ({members.length}/{game.max_managers})</CardTitle>
        <ul className="space-y-2 text-sm">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center justify-between">
              <span>{m.display_name} {m.role === "owner" && <Badge tone="info">Criador</Badge>}</span>
              <span className="text-muted">{m.club_name ?? "sem clube"}</span>
            </li>
          ))}
        </ul>
        {!game.is_owner && (
          <div className="mt-4">
            <ActionForm action={leaveGameAction} hidden={{ gameId }} submitLabel="Sair da liga" variant="danger" confirm="Sair da liga? O teu clube passa para a IA." />
          </div>
        )}
      </Card>
      {game.is_owner ? (
        <Card>
          <CardTitle>Regras e calendário</CardTitle>
          <ActionForm action={updateSettingsAction} hidden={{ gameId }} submitLabel="Guardar definições">
            <Field label="Nome"><input name="name" defaultValue={game.name} className={inputCls} /></Field>
            <Field label="Avanço de jornadas" hint="Plano Hobby da Vercel: cron no máximo 1×/dia e com precisão de ±59 min. Modo manual funciona sempre.">
              <select name="tickMode" defaultValue={game.tick_mode} className={inputCls}><option value="manual">Manual</option><option value="daily">Diário (cron)</option></select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Hora limite (0–23)"><input name="deadlineHour" type="number" min={0} max={23} defaultValue={s.deadline_hour ?? 20} className={inputCls} /></Field>
              <Field label="Horas entre jornadas"><input name="roundIntervalHours" type="number" min={1} max={336} defaultValue={s.round_interval_hours ?? 24} className={inputCls} /></Field>
            </div>
            <Field label="Timezone"><input name="timezone" defaultValue={game.timezone} className={inputCls} /></Field>
          </ActionForm>
        </Card>
      ) : (
        <Card>
          <CardTitle>Regras</CardTitle>
          <ul className="space-y-1 text-sm text-muted">
            <li>Vitória {s.points_win ?? 3} pts · Empate {s.points_draw ?? 1} pt</li>
            <li>Plantel entre {s.min_squad ?? 16} e {s.max_squad ?? 32} jogadores</li>
            <li>Avanço: {game.tick_mode === "daily" ? "diário" : "manual pelo criador"}</li>
          </ul>
        </Card>
      )}
    </div>
  );
}

function RotateInvite({ gameId, base }: { gameId: string; base: string }) {
  return (
    <ActionForm action={rotateInviteAction} hidden={{ gameId, base }} submitLabel="Gerar novo convite" variant="secondary" inline />
  );
}
