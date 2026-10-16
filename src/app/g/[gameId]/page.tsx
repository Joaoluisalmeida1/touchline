import Link from "next/link";
import { ArrowLeftRight, ArrowRight, Bell, CalendarDays, ClipboardList, Landmark, Flag, Newspaper, Play, Radio, Trophy, UserPlus } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Crest } from "@/components/crest";
import { AnimatedNumber } from "@/components/fx/animated-number";
import { Countdown } from "@/components/fx/countdown";
import { Stagger, StaggerItem } from "@/components/fx/motion";
import { Badge, ButtonLink, Card, CardTitle, Empty, FormStrip, OvrBadge, cn } from "@/components/ui";
import { markNotificationsReadAction, processMatchdayAction, selectClubAction, startGameAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getClubs, getGame, getLastResult, getNextFixture, getNotifications, getStandings } from "@/server/queries";
import { notificationText } from "@/lib/notifications";
import { getLatestHeadlines } from "@/server/league-queries";
import { getWeekPending } from "@/server/week-queries";
import { getBoardMini } from "@/server/club-queries";
import { getPool } from "@/server/db";
import { ensureWeek } from "@/server/services/week";

const NOTIF_ICON: Record<string, React.ReactNode> = {
  member_joined: <UserPlus />, game_started: <Flag />, matchday_completed: <CalendarDays />, season_completed: <Trophy />,
  offer_received: <ArrowLeftRight />, offer_rejected: <ArrowLeftRight />, transfer_completed: <ArrowLeftRight />, week_ready: <ClipboardList />, board_warning: <Landmark />, board_ultimatum: <Landmark />, board_praise: <Landmark />, offer_countered: <ArrowLeftRight />, achievement: <Trophy />,
};

export default async function Overview({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  if (game.status === "active" && game.my_club_id) {
    await ensureWeek(getPool(), gameId).catch((e) => console.error(JSON.stringify({ level: "error", msg: "week.ensure_failed", error: (e as Error).message })));
  }
  const [clubs, standings, notifications, last, next, headlines, pending, board] = await Promise.all([
    getClubs(user.id, gameId), getStandings(user.id, gameId).catch(() => []), getNotifications(user.id, gameId),
    getLastResult(user.id, gameId, game.my_club_id), game.my_club_id ? getNextFixture(user.id, gameId, game.my_club_id) : null,
    getLatestHeadlines(user.id, gameId, 3).catch(() => []),
    game.my_club_id && game.status === "active" ? getWeekPending(user.id, gameId, game.my_club_id).catch(() => null) : null,
    game.my_club_id && game.status === "active" ? getBoardMini(user.id, gameId, game.my_club_id).catch(() => null) : null,
  ]);
  const myClub = clubs.find((c) => c.id === game.my_club_id);
  const unread = notifications.filter((n) => !n.read_at).length;
  const myPos = standings.findIndex((s) => s.club_id === game.my_club_id);
  const myRow = myPos >= 0 ? standings[myPos] : null;
  const fmtDate = (d: string) => new Date(d).toLocaleString("pt-PT", { timeZone: game.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <Stagger className="min-w-0 space-y-5">
        {game.is_owner && game.status !== "finished" && game.status !== "archived" && (
          <StaggerItem>
            <Card glow className="overflow-hidden">
              <div aria-hidden className="pointer-events-none absolute -right-10 -top-16 size-52 rounded-full bg-accent/10 blur-3xl" />
              <CardTitle icon={<Radio />}>Painel do criador</CardTitle>
              {game.status === "setup" ? (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <p className="max-w-lg text-sm leading-6 text-muted">Partilha o convite em <Link className="font-semibold text-ink underline decoration-accent/60 underline-offset-4" href={`/g/${gameId}/settings`}>Definições</Link>. Quando todos tiverem escolhido clube, inicia a liga — o calendário (ida e volta) é gerado nesse momento.</p>
                  <ActionForm action={startGameAction} hidden={{ gameId }} submitLabel="Iniciar liga" pendingLabel="A gerar calendário…" icon={<Flag className="size-4" />}
                    confirm="Iniciar a liga agora? Novos managers ainda podem entrar e assumir clubes da IA." className="sm:shrink-0" />
                </div>
              ) : (
                <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <p className="max-w-lg text-sm leading-6 text-muted">Processar a jornada {game.current_matchday + 1}: bloqueia escalações, simula todos os jogos e atualiza tabela, finanças e evolução. É seguro repetir — cada jogo só é aplicado uma vez.</p>
                  <ActionForm action={processMatchdayAction} hidden={{ gameId }} submitLabel={`Jogar jornada ${game.current_matchday + 1}`} pendingLabel="A simular jogos…"
                    icon={<Play className="size-4 fill-current" />} className="sm:shrink-0 sm:text-right" submitClassName="min-h-12 px-6 text-base" />
                </div>
              )}
            </Card>
          </StaggerItem>
        )}

        {!myClub ? (
          <StaggerItem>
            <Card>
              <CardTitle>Escolhe o teu clube</CardTitle>
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {clubs.map((c) => (
                  <li key={c.id} className={cn("flex items-center gap-3 rounded-2xl border border-line bg-bg/40 p-3 transition", !c.manager_user_id && "hover:border-line-strong hover:bg-surface-2")}>
                    <Crest id={c.id} name={c.name_snapshot} short={c.short_name} color={c.primary_color} color2={c.secondary_color} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{c.name_snapshot}</p>
                      <p className="text-xs text-muted">Reputação {c.reputation} · {c.squad_size} jogadores</p>
                    </div>
                    <OvrBadge ovr={Math.round(Number(c.strength))} size="sm" />
                    {c.manager_user_id ? <Badge>{c.manager_name}</Badge> : (
                      <ActionForm action={selectClubAction} hidden={{ gameId, clubId: c.id }} submitLabel="Escolher" variant="secondary" inline submitClassName="min-h-9 px-3" />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </StaggerItem>
        ) : (
          <>
            <StaggerItem>
              <section className="surface relative overflow-hidden rounded-[var(--radius-card)]">
                {next && (
                  <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[.18]"
                    style={{ background: `linear-gradient(105deg, ${next.home_color} 0%, transparent 38%, transparent 62%, ${next.away_color} 100%)` }} />
                )}
                <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0 opacity-60" />
                <div className="relative p-5 sm:p-7">
                  <div className="flex items-center justify-between gap-3">
                    <p className="eyebrow">Próximo jogo{next ? ` · Jornada ${next.round_number}` : ""}</p>
                    {next?.kickoff_at && <p className="text-xs font-semibold capitalize text-muted">{fmtDate(next.kickoff_at)}</p>}
                  </div>
                  {next ? (
                    <>
                      <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-6">
                        {(["home", "away"] as const).map((side) => {
                          const id = side === "home" ? next.home_club_id : next.away_club_id;
                          const mine = id === game.my_club_id;
                          const el = (
                            <div key={side} className={cn("flex min-w-0 flex-col items-center gap-2 text-center", side === "away" && "order-3")}>
                              <Crest id={id} name={side === "home" ? next.home_name : next.away_name} short={side === "home" ? next.home_short : next.away_short}
                                color={side === "home" ? next.home_color : next.away_color} color2={side === "home" ? next.home_color2 : next.away_color2}
                                size={76} className="drop-shadow-[0_10px_24px_rgb(0_0_0/.55)]" />
                              <p className={cn("headline line-clamp-2 text-lg sm:text-2xl", mine ? "text-ink" : "text-ink/85")}>{side === "home" ? next.home_name : next.away_name}</p>
                              <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-faint">{side === "home" ? "Casa" : "Fora"}{mine ? " · tu" : ""}</span>
                            </div>
                          );
                          return el;
                        })}
                        <div className="order-2 flex flex-col items-center">
                          <span className="headline text-4xl italic text-accent sm:text-6xl">VS</span>
                        </div>
                      </div>
                      <div className="mt-6 flex flex-col items-center justify-between gap-4 border-t border-line/70 pt-5 sm:flex-row">
                        {next.kickoff_at ? <Countdown to={next.kickoff_at} label="Fecho das escalações" /> : <span />}
                        <ButtonLink href={`/g/${gameId}/tactics`} className="w-full sm:w-auto">Preparar escalação <ArrowRight className="size-4" /></ButtonLink>
                      </div>
                    </>
                  ) : (
                    <p className="mt-4 text-sm text-muted">{game.status === "setup" ? "A liga ainda não começou — o calendário aparece quando o criador a iniciar." : "Sem jogos agendados."}</p>
                  )}
                </div>
              </section>
            </StaggerItem>

            <StaggerItem className="grid gap-5 sm:grid-cols-2">
              <Card>
                <CardTitle>O meu clube</CardTitle>
                <div className="flex items-center gap-3">
                  <Crest id={myClub.id} name={myClub.name_snapshot} short={myClub.short_name} color={myClub.primary_color} color2={myClub.secondary_color} size={56} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-xl font-bold uppercase">{myClub.name_snapshot}</p>
                    <p className="text-xs text-muted">Reputação {myClub.reputation} · {myClub.squad_size} jogadores</p>
                  </div>
                  <div className="text-center">
                    <OvrBadge ovr={Math.round(Number(myClub.strength))} size="lg" />
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-faint">Força</p>
                  </div>
                </div>
                {myRow && (
                  <div className="mt-4 grid grid-cols-3 gap-2 border-t border-line/70 pt-4 text-center">
                    <div><p className="text-[10px] font-bold uppercase tracking-wider text-faint">Posição</p><p className="font-display text-2xl font-extrabold"><AnimatedNumber value={myPos + 1} />º</p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-wider text-faint">Pontos</p><p className="font-display text-2xl font-extrabold text-accent"><AnimatedNumber value={myRow.points} /></p></div>
                    <div><p className="text-[10px] font-bold uppercase tracking-wider text-faint">Forma</p><div className="mt-1.5 flex justify-center">{myRow.form ? <FormStrip form={myRow.form.slice(-5)} size="sm" /> : <span className="text-faint">—</span>}</div></div>
                  </div>
                )}
              </Card>
              <Card>
                <CardTitle>Último resultado</CardTitle>
                {last ? (
                  <Link href={`/g/${gameId}/matches/${last.id}`} className="group block rounded-2xl border border-line bg-bg/60 p-3 transition hover:border-line-strong">
                    <p className="mb-2 text-center text-[10px] font-bold uppercase tracking-[0.16em] text-faint">Jornada {last.round_number} · Final</p>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <div className="flex min-w-0 flex-col items-center gap-1 text-center">
                        <Crest id={last.home_club_id} name={last.home_name} short={last.home_short} color={last.home_color} color2={last.home_color2} size={36} />
                        <span className="w-full truncate text-xs font-semibold">{last.home_name}</span>
                      </div>
                      <span className="rounded-xl bg-surface-3 px-3 py-1 font-display text-3xl font-extrabold tabular ring-1 ring-line-strong">
                        {last.result_home}<span className="mx-1 text-faint">–</span>{last.result_away}
                      </span>
                      <div className="flex min-w-0 flex-col items-center gap-1 text-center">
                        <Crest id={last.away_club_id} name={last.away_name} short={last.away_short} color={last.away_color} color2={last.away_color2} size={36} />
                        <span className="w-full truncate text-xs font-semibold">{last.away_name}</span>
                      </div>
                    </div>
                    <p className="mt-3 flex items-center justify-center gap-1 text-xs font-semibold text-muted transition group-hover:text-accent">Ver relatório do jogo <ArrowRight className="size-3.5" /></p>
                  </Link>
                ) : <Empty title="Ainda não houve jogos" icon={<CalendarDays />} />}
              </Card>
            </StaggerItem>
          </>
        )}
      </Stagger>

      <Stagger className="space-y-5" gap={0.08}>
        {pending && (pending.events > 0 || pending.press > 0) && (
          <StaggerItem>
            <Card glow>
              <CardTitle icon={<ClipboardList />}>Semana de jornada</CardTitle>
              <ul className="space-y-1.5 text-sm">
                {pending.press > 0 && <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-accent" />Conferência de imprensa por responder</li>}
                {pending.events > 0 && <li className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-accent" />{pending.events} {pending.events === 1 ? "assunto" : "assuntos"} no Gabinete</li>}
              </ul>
              <ButtonLink href={`/g/${gameId}/week`} className="mt-4 w-full">Abrir a semana <ArrowRight className="size-4" /></ButtonLink>
            </Card>
          </StaggerItem>
        )}
        {board && (
          <StaggerItem>
            <Card>
              <CardTitle icon={<Landmark />} action={<Link href={`/g/${gameId}/club`} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-accent">Clube <ArrowRight className="size-3" /></Link>}>Direção</CardTitle>
              <div className="flex items-end justify-between gap-3">
                <p className="font-display text-5xl font-extrabold leading-none tabular">{board.confidence}<span className="text-lg text-faint">/100</span></p>
                {board.fan_mood !== null && <p className="text-right text-xs text-muted">Adeptos<br /><b className="font-display text-2xl text-ink tabular">{board.fan_mood}</b></p>}
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className={cn("h-full rounded-full", board.confidence < 20 ? "bg-danger" : board.confidence < 35 ? "bg-warn" : "bg-accent")} style={{ width: `${board.confidence}%` }} /></div>
              <p className="mt-3 text-sm text-muted">Objetivo: <b className="text-ink">{board.objective.label}</b></p>
            </Card>
          </StaggerItem>
        )}
        {headlines.length > 0 && (
          <StaggerItem>
            <Card>
              <CardTitle icon={<Newspaper />} action={<Link href={`/g/${gameId}/news`} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-accent">Ler o jornal <ArrowRight className="size-3" /></Link>}>O Apito · J{headlines[0].round}</CardTitle>
              <ul className="space-y-3">
                {headlines.map((h, i) => (
                  <li key={h.id}>
                    <Link href={h.fixture_id ? `/g/${gameId}/matches/${h.fixture_id}` : `/g/${gameId}/news`} className="group block">
                      <p className={cn("font-display font-extrabold uppercase leading-tight transition group-hover:text-accent", i === 0 ? "text-2xl" : "text-base text-ink/90")}>{h.headline}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          </StaggerItem>
        )}
        <StaggerItem>
          <Card className="p-0 sm:p-0">
            <div className="p-4 pb-0 sm:p-5 sm:pb-0">
              <CardTitle action={<Link href={`/g/${gameId}/table`} className="flex items-center gap-1 text-xs font-semibold text-muted hover:text-accent">Ver tudo <ArrowRight className="size-3" /></Link>}>Classificação</CardTitle>
            </div>
            {standings.length === 0 ? <p className="px-5 pb-5 text-sm text-muted">Disponível quando a liga começar.</p> : (
              <ol className="pb-2">
                {standings.slice(0, 8).map((s, i) => {
                  const mine = s.club_id === game.my_club_id;
                  return (
                    <li key={s.club_id} className={cn("relative flex items-center gap-2.5 px-4 py-2 text-sm sm:px-5", mine && "bg-accent/[.07]")}>
                      {mine && <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-r bg-accent" />}
                      <span className={cn("w-5 text-right font-display text-base font-bold tabular", i === 0 ? "text-accent" : "text-faint")}>{i + 1}</span>
                      <Crest id={s.club_id} name={s.name_snapshot} short={s.short_name} color={s.primary_color} color2={s.secondary_color} size={22} />
                      <span className={cn("flex-1 truncate", mine ? "font-bold" : "font-medium")}>{s.name_snapshot}</span>
                      <span className="hidden sm:inline-flex">{s.form && <FormStrip form={s.form.slice(-3)} size="sm" />}</span>
                      <span className="w-7 text-right font-display text-lg font-extrabold tabular">{s.points}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>
        </StaggerItem>
        <StaggerItem>
          <Card>
            <CardTitle icon={<Bell />} action={unread > 0 ? (
              <form action={markNotificationsReadAction}><input type="hidden" name="gameId" value={gameId} /><button className="text-xs font-semibold text-muted hover:text-accent">Marcar lidas</button></form>
            ) : null}>Notificações {unread > 0 && <Badge tone="accent">{unread}</Badge>}</CardTitle>
            {notifications.length === 0 ? <p className="text-sm text-muted">Sem novidades.</p> : (
              <ul className="relative space-y-3 text-sm before:absolute before:inset-y-2 before:left-[15px] before:w-px before:bg-line">
                {notifications.map((n) => (
                  <li key={n.id} className={cn("relative flex gap-3", n.read_at ? "text-muted" : "text-ink")}>
                    <span className={cn("relative z-10 flex size-[31px] shrink-0 items-center justify-center rounded-full ring-1 [&_svg]:size-3.5",
                      n.read_at ? "bg-surface-2 text-faint ring-line" : "bg-accent/15 text-accent ring-accent/30")}>
                      {NOTIF_ICON[n.type] ?? <Bell />}
                    </span>
                    <span className="min-w-0 pt-1 leading-5">
                      {notificationText(n.type, n.payload_json)}
                      <span className="block text-[11px] text-faint">{new Date(n.created_at).toLocaleString("pt-PT", { timeZone: game.timezone, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
