import { Bell, Crown, KeyRound, ScrollText, SlidersHorizontal, Users } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { CopyInvite } from "@/components/copy-invite";
import { PushToggle } from "@/components/push-toggle";
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
    <div className="grid gap-5 lg:grid-cols-2">
      {game.is_owner && (
        <Card glow={!!invite} className="lg:col-span-2">
          <CardTitle icon={<KeyRound />}>Convite</CardTitle>
          {invite && /^[A-Z2-9]{16}$/.test(invite) ? <CopyInvite code={invite} link={`${base}/join/${invite}`} /> : (
            <p className="text-sm text-muted">Por segurança só guardamos o hash do convite. Gera um novo para o voltares a ver (o anterior deixa de funcionar).</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <ActionForm action={rotateInviteAction} hidden={{ gameId, base }} submitLabel="Gerar novo convite" variant="secondary" inline />
            <ActionForm action={revokeInviteAction} hidden={{ gameId }} submitLabel="Revogar convite" variant="danger" inline confirm="Revogar? Ninguém poderá entrar até gerares um novo." />
          </div>
        </Card>
      )}
      <Card>
        <CardTitle icon={<Users />} action={<span className="font-display text-sm font-bold text-faint">{members.length}/{game.max_managers}</span>}>Managers</CardTitle>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${(members.length / Math.max(1, game.max_managers)) * 100}%` }} /></div>
        <ul className="space-y-2 text-sm">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 rounded-xl border border-line bg-bg/40 px-3 py-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 font-display text-sm font-bold ring-1 ring-line-strong">{String(m.display_name ?? "?").slice(0, 2).toUpperCase()}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 truncate font-semibold">{m.display_name}{m.role === "owner" && <Crown className="size-3.5 text-gold" aria-label="Criador" />}</span>
                <span className="block truncate text-xs text-muted">{m.club_name ?? "sem clube"}</span>
              </span>
              {m.role === "owner" && <Badge tone="info">Criador</Badge>}
            </li>
          ))}
        </ul>
        {!game.is_owner && (
          <div className="mt-5 border-t border-line pt-4">
            <ActionForm action={leaveGameAction} hidden={{ gameId }} submitLabel="Sair da liga" variant="danger" confirm="Sair da liga? O teu clube passa para a IA." />
          </div>
        )}
      </Card>
      {game.is_owner ? (
        <Card>
          <CardTitle icon={<SlidersHorizontal />}>Regras e calendário</CardTitle>
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
          <CardTitle icon={<ScrollText />}>Regras</CardTitle>
          <dl className="grid grid-cols-2 gap-2.5 text-sm">
            {[["Vitória", `${s.points_win ?? 3} pontos`], ["Empate", `${s.points_draw ?? 1} ponto`], ["Plantel", `${s.min_squad ?? 16}–${s.max_squad ?? 32} jogadores`], ["Avanço", game.tick_mode === "daily" ? "Diário" : "Manual (criador)"]].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-bg/40 p-3">
                <dt className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{k}</dt>
                <dd className="mt-1 font-display text-lg font-bold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
      <Card className="lg:col-span-2">
        <CardTitle icon={<Bell />}>Notificações no telemóvel</CardTitle>
        <PushToggle publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />
      </Card>
    </div>
  );
}
