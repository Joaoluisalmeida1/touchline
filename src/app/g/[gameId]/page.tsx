import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardTitle, ClubDot, Empty, OvrBadge } from "@/components/ui";
import { markNotificationsReadAction, processMatchdayAction, selectClubAction, startGameAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getClubs, getGame, getLastResult, getNextFixture, getNotifications, getStandings } from "@/server/queries";
import { notificationText } from "@/lib/notifications";

export default async function Overview({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const [clubs, standings, notifications, last, next] = await Promise.all([
    getClubs(user.id, gameId), getStandings(user.id, gameId).catch(() => []), getNotifications(user.id, gameId),
    getLastResult(user.id, gameId, game.my_club_id), game.my_club_id ? getNextFixture(user.id, gameId, game.my_club_id) : null,
  ]);
  const myClub = clubs.find((c) => c.id === game.my_club_id);
  const unread = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {game.is_owner && (
          <Card className="border-info/30">
            <CardTitle>Painel do criador</CardTitle>
            {game.status === "setup" ? (
              <div className="space-y-2 text-sm text-muted">
                <p>Partilha o convite em <Link className="text-info underline" href={`/g/${gameId}/settings`}>Definições</Link>. Quando todos tiverem escolhido clube, inicia a liga — o calendário (ida e volta) é gerado nesse momento.</p>
                <ActionForm action={startGameAction} hidden={{ gameId }} submitLabel="Iniciar liga" pendingLabel="A gerar calendário…" confirm="Iniciar a liga agora? Novos managers ainda podem entrar e assumir clubes da IA." />
              </div>
            ) : game.status === "active" ? (
              <div className="space-y-2 text-sm text-muted">
                <p>Processar a jornada {game.current_matchday + 1}: bloqueia escalações, simula todos os jogos e atualiza tabela, finanças e evolução. É seguro repetir — cada jogo só é aplicado uma vez.</p>
                <ActionForm action={processMatchdayAction} hidden={{ gameId }} submitLabel={`Jogar jornada ${game.current_matchday + 1}`} pendingLabel="A simular jogos…" />
              </div>
            ) : null}
          </Card>
        )}

        {!myClub ? (
          <Card>
            <CardTitle>Escolhe o teu clube</CardTitle>
            <ul className="divide-y divide-line">
              {clubs.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <ClubDot color={c.primary_color} className="h-4 w-4" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{c.name_snapshot}</p>
                      <p className="text-xs text-muted">Força {Number(c.strength).toFixed(1)} · Reputação {c.reputation} · {c.squad_size} jogadores</p>
                    </div>
                  </div>
                  {c.manager_user_id ? <Badge>{c.manager_name}</Badge> : (
                    <ActionForm action={selectClubAction} hidden={{ gameId, clubId: c.id }} submitLabel="Escolher" variant="secondary" inline />
                  )}
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardTitle>O meu clube</CardTitle>
              <div className="flex items-center gap-3">
                <OvrBadge ovr={Math.round(Number(myClub.strength))} size="lg" />
                <div>
                  <p className="text-lg font-bold">{myClub.name_snapshot}</p>
                  <p className="text-sm text-muted">Força do onze inicial · Reputação {myClub.reputation}</p>
                </div>
              </div>
            </Card>
            <Card>
              <CardTitle>Próximo jogo</CardTitle>
              {next ? (
                <div>
                  <p className="font-semibold"><ClubDot color={next.home_color} /> {next.home_name} <span className="text-muted">vs</span> <ClubDot color={next.away_color} /> {next.away_name}</p>
                  <p className="mt-1 text-sm text-muted">Jornada {next.round_number}{next.kickoff_at ? ` · ${new Date(next.kickoff_at).toLocaleString("pt-PT", { timeZone: game.timezone, dateStyle: "medium", timeStyle: "short" })}` : ""}</p>
                  <Link href={`/g/${gameId}/tactics`} className="mt-3 inline-block text-sm font-semibold text-info">Preparar escalação →</Link>
                </div>
              ) : <p className="text-sm text-muted">{game.status === "setup" ? "A liga ainda não começou." : "Sem jogos agendados."}</p>}
            </Card>
          </div>
        )}

        <Card>
          <CardTitle>Último resultado</CardTitle>
          {last ? (
            <Link href={`/g/${gameId}/matches/${last.id}`} className="flex items-center justify-between gap-3 rounded-lg bg-bg/60 p-3 hover:bg-bg">
              <span className="flex-1 truncate text-right font-semibold">{last.home_name}</span>
              <span className="rounded-md bg-surface-2 px-3 py-1 font-black tabular">{last.result_home} – {last.result_away}</span>
              <span className="flex-1 truncate font-semibold">{last.away_name}</span>
            </Link>
          ) : <Empty title="Ainda não houve jogos" />}
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardTitle action={<Link href={`/g/${gameId}/table`} className="text-xs text-info">Ver tudo</Link>}>Classificação</CardTitle>
          {standings.length === 0 ? <p className="text-sm text-muted">Disponível quando a liga começar.</p> : (
            <ol className="space-y-1 text-sm">
              {standings.slice(0, 8).map((s, i) => (
                <li key={s.club_id} className={`flex items-center gap-2 rounded px-2 py-1 ${s.club_id === game.my_club_id ? "bg-accent/10" : ""}`}>
                  <span className="w-5 text-right text-muted tabular">{i + 1}</span>
                  <ClubDot color={s.primary_color} />
                  <span className="flex-1 truncate">{s.name_snapshot}</span>
                  <span className="font-bold tabular">{s.points}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card>
          <CardTitle action={unread > 0 ? (
            <form action={markNotificationsReadAction}><input type="hidden" name="gameId" value={gameId} /><button className="text-xs text-info">Marcar lidas</button></form>
          ) : null}>Notificações {unread > 0 && <Badge tone="info">{unread}</Badge>}</CardTitle>
          {notifications.length === 0 ? <p className="text-sm text-muted">Sem novidades.</p> : (
            <ul className="space-y-2 text-sm">
              {notifications.map((n) => (
                <li key={n.id} className={n.read_at ? "text-muted" : "text-ink"}>
                  {notificationText(n.type, n.payload_json)}
                  <span className="block text-xs text-faint">{new Date(n.created_at).toLocaleString("pt-PT")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
