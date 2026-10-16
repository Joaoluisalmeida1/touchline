import Link from "next/link";
import { CalendarClock, Dumbbell, Inbox, Megaphone, Quote, ShieldAlert, Telescope } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Crest } from "@/components/crest";
import { MatchPlanEditor, PressConference, WeekTabs, type WeekTab } from "@/components/week/week-ui";
import { TONES } from "@/engine/narrative/press";
import { Badge, Card, CardTitle, Empty, FormStrip, OvrBadge, PosPill, Stat, cn } from "@/components/ui";
import { TRAIT_INFO, traitOf } from "@/engine/narrative/traits";
import { TRAINING } from "@/engine/training/training";
import { answerEventAction, saveTrainingAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getPool } from "@/server/db";
import { ensureWeek } from "@/server/services/week";
import { getOpponentReport, getWeek, type InboxRow } from "@/server/week-queries";

export const metadata = { title: "Semana" };

const INTENSITY = [
  { id: "light", label: "Leve", hint: `+${TRAINING.fitnessBonus.light} condição, menos evolução, sem lesões` },
  { id: "normal", label: "Normal", hint: "equilíbrio" },
  { id: "intense", label: "Intensa", hint: `+${Math.round((TRAINING.xpMultiplier.intense - 1) * 100)}% evolução, ${TRAINING.fitnessBonus.intense} condição, risco de lesão` },
] as const;
const FOCUS = [
  { id: "none", label: "Geral", hint: "Sem foco: nada muda no jogo." },
  { id: "attack", label: "Ataque", hint: "Finalização e movimentos ofensivos." },
  { id: "defense", label: "Defesa", hint: "Organização e duelos defensivos." },
  { id: "possession", label: "Posse", hint: "Controlo do meio-campo." },
  { id: "set_pieces", label: "Bolas paradas", hint: "Cantos e livres (meio efeito ofensivo)." },
  { id: "fitness", label: "Físico", hint: `+${TRAINING.fitnessFocusBonus} condição extra após a jornada.` },
  { id: "tactics", label: "Tática", hint: "Um pouco de tudo." },
] as const;

export default async function WeekPage({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { gameId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  // lazy: prepares the upcoming round if the after-match step never ran (first round, older leagues)
  await ensureWeek(getPool(), gameId).catch((e) => console.error(JSON.stringify({ level: "error", msg: "week.ensure_failed", error: (e as Error).message })));
  const w = await getWeek(user.id, gameId);
  if (!w) return <Empty title="Ainda não tens clube">Escolhe um clube no Resumo.</Empty>;
  if (w.status !== "active") return <Empty title="A liga ainda não começou" icon={<CalendarClock />}>A semana de jornada abre quando o dono da liga a iniciar.</Empty>;
  const oppId = w.fixture ? (w.fixture.home_club_id === w.club ? w.fixture.away_club_id : w.fixture.home_club_id) : null;
  const report = oppId && w.season_id ? await getOpponentReport(user.id, gameId, w.season_id, oppId, w.club) : null;
  const open = w.inbox.filter((e) => !e.resolved_at);
  const pressOpen = w.press && !w.press.answered_at ? 1 : 0;
  const initial: WeekTab = (["gabinete", "imprensa", "treino", "adversario"] as const).find((t) => t === sp.tab)
    ?? (open.length ? "gabinete" : pressOpen ? "imprensa" : "treino");
  const theirs = (report?.players ?? []).filter((p) => !p.unavailable && p.position_group !== "GK").map((p) => ({ id: p.id, name: p.name, group: p.position_group, ovr: p.current_ovr }));
  const mine = w.mySquad.map((p) => ({ id: p.id, name: p.name_snapshot, group: p.position_group, ovr: p.current_ovr }));

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">Época {w.current_season} · antes da jornada {w.round}{w.total_rounds ? ` de ${w.total_rounds}` : ""}</p>
          <h2 className="headline text-4xl sm:text-5xl">Semana de jornada</h2>
        </div>
        {report && (
          <div className="flex items-center gap-2.5 rounded-2xl border border-line bg-surface/60 px-3 py-2">
            <Crest id={report.club.id} name={report.club.name_snapshot} short={report.club.short_name} color={report.club.primary_color} color2={report.club.secondary_color} size={30} />
            <div className="leading-tight">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{w.fixture!.home_club_id === w.club ? "Em casa" : "Fora"} · próximo</p>
              <p className="font-display text-lg font-bold uppercase">{report.club.name_snapshot}</p>
            </div>
          </div>
        )}
      </header>

      <WeekTabs initial={initial} badges={{ gabinete: open.length, imprensa: pressOpen }} panels={{
        gabinete: <Office gameId={gameId} events={w.inbox} round={w.round} />,
        imprensa: !w.press ? (
          <Empty title="Sem conferência" icon={<Megaphone />}>Há conferência de imprensa antes de cada jogo do teu clube. Volta depois da próxima jornada.</Empty>
        ) : w.press.answered_at ? (
          <PressDone press={w.press} />
        ) : (
          <PressConference gameId={gameId} confId={w.press.id} questions={w.press.questions} opponent={report?.club.name_snapshot ?? "adversário"} rivalHuman={!!report?.club.manager_name} />
        ),
        treino: (
          <div className="space-y-5">
            <Card>
              <CardTitle icon={<Dumbbell />}>Plano de treino semanal</CardTitle>
              <ActionForm action={saveTrainingAction} hidden={{ gameId }} submitLabel="Guardar treino" className="space-y-5">
                <fieldset>
                  <legend className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Intensidade</legend>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {INTENSITY.map((o) => (
                      <label key={o.id} className="cursor-pointer rounded-2xl border border-line bg-bg/50 p-3 transition hover:border-line-strong has-[:checked]:border-accent/60 has-[:checked]:bg-accent/8">
                        <input type="radio" name="intensity" value={o.id} defaultChecked={(w.training?.intensity ?? "normal") === o.id} className="sr-only" />
                        <span className="block font-display text-lg font-bold uppercase">{o.label}</span>
                        <span className="text-xs text-muted">{o.hint}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Foco</legend>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {FOCUS.map((o) => (
                      <label key={o.id} className="cursor-pointer rounded-2xl border border-line bg-bg/50 p-3 transition hover:border-line-strong has-[:checked]:border-accent/60 has-[:checked]:bg-accent/8">
                        <input type="radio" name="focus" value={o.id} defaultChecked={(w.training?.focus ?? "none") === o.id} className="sr-only" />
                        <span className="block text-sm font-bold">{o.label}</span>
                        <span className="text-[11px] leading-4 text-muted">{o.hint}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <p className="text-xs text-faint">O foco dá um pequeno reforço ao setor no próximo jogo (×0,5 leve, ×1,5 intensa). O plano mantém-se até o mudares{w.training ? "" : " — sem plano guardado, o clube treina como até aqui"}.</p>
              </ActionForm>
            </Card>
            <MatchPlanEditor gameId={gameId} initialRules={(w.plan?.rules ?? []) as never} initialMarking={w.plan?.marking ?? []} mine={mine} theirs={theirs} opponent={report?.club.name_snapshot ?? null} />
          </div>
        ),
        adversario: report ? <Scouting r={report} gameId={gameId} /> : <Empty title="Sem adversário" icon={<Telescope />}>Não há jogo marcado para a próxima jornada.</Empty>,
      }} />
    </div>
  );
}

function Office({ gameId, events, round }: { gameId: string; events: InboxRow[]; round: number }) {
  if (!events.length) return <Empty title="Gabinete tranquilo" icon={<Inbox />}>Nada para decidir esta semana. Novos assuntos chegam depois de cada jornada.</Empty>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {events.map((e) => (
        <Card key={e.id} className={cn(e.resolved_at && "opacity-70")} glow={!e.resolved_at}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <Badge tone={e.resolved_at ? "default" : "accent"} dot={!e.resolved_at}>{e.resolved_at ? (e.resolution === "default" ? "Decidido por omissão" : "Decidido") : `Decide até à jornada ${e.deadline_round}`}</Badge>
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">J{e.round}</span>
          </div>
          <h3 className="font-display text-2xl font-bold uppercase leading-tight">{e.title}</h3>
          <p className="mt-1.5 text-sm text-muted">{e.body}</p>
          {e.resolved_at ? (
            <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-sm"><span className="font-bold">{e.choices[e.chosen ?? e.default_choice]?.label}</span> — <span className="text-muted">{e.choices[e.chosen ?? e.default_choice]?.detail}</span></p>
          ) : (
            <ActionForm action={answerEventAction} hidden={{ gameId, eventId: e.id }} submitLabel="Decidir" className="mt-4 space-y-2">
              {e.choices.map((c, i) => (
                <label key={i} className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-bg/50 px-3 py-2.5 transition hover:border-line-strong has-[:checked]:border-accent/60 has-[:checked]:bg-accent/8">
                  <input type="radio" name="choice" value={i} defaultChecked={i === e.default_choice} className="mt-1 accent-[var(--color-accent)]" />
                  <span>
                    <span className="block text-sm font-bold">{c.label}{i === e.default_choice && <span className="ml-2 text-[10px] font-bold uppercase tracking-[0.1em] text-faint">por omissão</span>}</span>
                    <span className="text-xs text-muted">{c.detail}</span>
                  </span>
                </label>
              ))}
            </ActionForm>
          )}
        </Card>
      ))}
      <p className="text-xs text-faint lg:col-span-2">Sem resposta, vale a opção por omissão quando a jornada {round} começar. Os clubes da IA recebem os mesmos assuntos.</p>
    </div>
  );
}

function PressDone({ press }: { press: NonNullable<Awaited<ReturnType<typeof getWeek>>>["press"] }) {
  if (!press) return null;
  const tone = (t?: string) => (t && t in TONES ? TONES[t as keyof typeof TONES].label : "—");
  return (
    <Card>
      <CardTitle icon={<Quote />}>Conferência terminada</CardTitle>
      <ol className="space-y-4">
        {press.questions.map((q) => {
          const a = press.answers?.find((x) => x.key === q.key);
          return (
            <li key={q.key}>
              <p className="text-sm font-semibold text-muted">{q.text}</p>
              <p className="mt-1 flex flex-wrap items-baseline gap-2">
                <Badge tone={a?.tone === "provocative" ? "danger" : a?.tone === "calm" ? "info" : a?.tone === "confident" ? "accent" : "default"}>{tone(a?.tone)}</Badge>
                <span className="text-[15px] italic">{a?.text ? `«${a.text}»` : "Sem comentários."}</span>
              </p>
            </li>
          );
        })}
      </ol>
      {press.effects && (
        <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4 text-xs">
          {press.effects.morale > 0 && <Badge tone="accent">Moral do plantel +{press.effects.morale}</Badge>}
          {press.effects.own_control > 0 && <Badge tone="accent">Controlo +{press.effects.own_control.toFixed(2)}</Badge>}
          {press.effects.opp_control < 0 && <Badge tone="danger">Rival desestabilizado {press.effects.opp_control.toFixed(1)}</Badge>}
          {press.effects.calm && <Badge tone="info">Imune a provocações</Badge>}
        </div>
      )}
    </Card>
  );
}

function Scouting({ r, gameId }: { r: NonNullable<Awaited<ReturnType<typeof getOpponentReport>>>; gameId: string }) {
  const fit = r.players.filter((p) => !p.unavailable);
  const key = [...fit.filter((p) => p.position_group === "GK").slice(0, 1), ...fit.filter((p) => p.position_group !== "GK").slice(0, 5)]
    .sort((a, b) => b.current_ovr - a.current_ovr);
  const out = r.players.filter((p) => p.unavailable);
  const scorers = [...r.players].filter((p) => p.goals > 0).sort((a, b) => b.goals - a.goals).slice(0, 3);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-5">
        <Card>
          <CardTitle icon={<Telescope />} action={r.club.manager_name ? <Badge tone="info">Treinador: {r.club.manager_name}</Badge> : <Badge>IA</Badge>}>Relatório do olheiro</CardTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Posição">{r.standing && r.played ? `${r.standing.position}.º` : "—"}</Stat>
            <Stat label="Golos / jogo" hint={`sofre ${r.avg.ga.toFixed(1)}`}>{r.avg.gf.toFixed(1)}</Stat>
            <Stat label="xG / jogo" hint={`concede ${r.avg.xga.toFixed(2)}`}>{r.avg.xgf.toFixed(2)}</Stat>
            <Stat label="Sistema" hint="último jogo">{r.formation ?? "—"}</Stat>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-muted">Forma</span>{r.form ? <FormStrip form={r.form} /> : <span className="text-faint">sem jogos</span>}
            <span className="ml-auto text-muted">Historial: <b className="text-ink">{r.h2h.w}V {r.h2h.d}E {r.h2h.l}D</b></span>
          </div>
        </Card>
        <Card>
          <CardTitle>Jogadores-chave</CardTitle>
          <ul className="divide-y divide-line">
            {key.map((p) => {
              const t = TRAIT_INFO[traitOf(p.id)];
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <OvrBadge ovr={p.current_ovr} size="sm" />
                  <PosPill group={p.position_group} label={p.position_detail ?? undefined} />
                  <Link href={`/g/${gameId}/players/${p.id}`} className="flex-1 truncate font-semibold hover:text-accent">{p.name}</Link>
                  <span className="hidden text-xs text-faint sm:inline" title={t.hint}>{t.label}</span>
                  <span className="w-16 text-right text-xs text-muted tabular">{p.goals}G {p.assists}A</span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      <div className="space-y-5">
        <Card>
          <CardTitle icon={<ShieldAlert />}>Ausências</CardTitle>
          {out.length ? (
            <ul className="space-y-1.5 text-sm">{out.map((p) => <li key={p.id} className="flex justify-between gap-2"><span className="font-semibold">{p.name}</span><span className="text-xs text-danger">{p.injury_type ?? "Castigado"}</span></li>)}</ul>
          ) : <p className="text-sm text-muted">Plantel completo.</p>}
        </Card>
        {scorers.length > 0 && (
          <Card>
            <CardTitle>Marcadores</CardTitle>
            <ul className="space-y-1.5 text-sm">{scorers.map((p) => <li key={p.id} className="flex justify-between"><span className="font-semibold">{p.name}</span><span className="font-display font-bold tabular">{p.goals}</span></li>)}</ul>
          </Card>
        )}
        {r.quotes && (
          <Card>
            <CardTitle icon={<Quote />}>Disse na imprensa (J{r.quotes.round})</CardTitle>
            <ul className="space-y-2 text-sm italic">
              {r.quotes.answers.filter((a) => a.text).slice(0, 2).map((a) => <li key={a.key}>«{a.text}»</li>)}
              {!r.quotes.answers.some((a) => a.text) && <li className="not-italic text-muted">Sem comentários.</li>}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
