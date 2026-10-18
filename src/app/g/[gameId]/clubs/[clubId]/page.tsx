import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, CalendarDays, HeartPulse, Shirt, Users } from "lucide-react";
import { ClubLink } from "@/components/club-link";
import { Crest } from "@/components/crest";
import { Badge, ButtonLink, Card, CardTitle, Empty, FormArrow, FormStrip, Meter, OvrBadge, POS_LABEL, PosPill, cn, eur } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getClubProfile, getGame, getSquad, getStandings, type PlayerRow } from "@/server/queries";

export const metadata = { title: "Clube" };

const GROUPS = [["GK", "Guarda-redes"], ["DEF", "Defesas"], ["MID", "Médios"], ["ATT", "Avançados"]] as const;

function status(p: PlayerRow): { label: string; tone: "danger" | "warn" | "default" } | null {
  if (p.injured_matches > 0) return { label: `Lesionado · ${p.injured_matches} j`, tone: "danger" };
  if (p.suspension_matches > 0) return { label: `Castigado · ${p.suspension_matches} j`, tone: "warn" };
  if (p.fitness < 70) return { label: "Cansado", tone: "default" };
  return null;
}

/** Any club's page: who manages it, how it is doing, and its squad with availability. Member-visible data only. */
export default async function ClubPage({ params }: { params: Promise<{ gameId: string; clubId: string }> }) {
  const { gameId, clubId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(clubId)) notFound();
  const user = await requireUser();
  const game = await getGame(user.id, gameId);
  if (!game) notFound();
  const [profile, squad, standings] = await Promise.all([
    getClubProfile(user.id, gameId, clubId), getSquad(user.id, gameId, clubId), getStandings(user.id, gameId).catch(() => []),
  ]);
  if (!profile) notFound();
  const { club, fixtures } = profile;
  const mine = club.id === game.my_club_id;
  const pos = standings.findIndex((s) => s.club_id === club.id);
  const row = pos >= 0 ? standings[pos] : null;
  const out = squad.filter((p) => p.injured_matches > 0 || p.suspension_matches > 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const avgOvr = avg(squad.map((p) => p.current_ovr));
  const ages = squad.flatMap((p) => (p.age ? [p.age] : []));
  const value = squad.reduce((s, p) => s + Number(p.market_value_cents), 0);
  const played = fixtures.filter((f) => f.status === "completed").slice(-5).reverse();
  const upcoming = fixtures.filter((f) => f.status !== "completed").slice(0, 3);
  const opp = (f: (typeof fixtures)[number]) => {
    const home = f.home_club_id === club.id;
    return { home, id: home ? f.away_club_id : f.home_club_id, name: home ? f.away_name : f.home_name, short: home ? f.away_short : f.home_short,
      color: home ? f.away_color : f.home_color, color2: home ? f.away_color2 : f.home_color2 };
  };
  const result = (f: (typeof fixtures)[number]) => {
    const [gf, ga] = f.home_club_id === club.id ? [f.result_home, f.result_away] : [f.result_away, f.result_home];
    return { gf, ga, r: gf > ga ? "V" : gf < ga ? "D" : "E" };
  };

  return (
    <div className="space-y-5">
      <section className="surface relative overflow-hidden rounded-[var(--radius-card)] p-5 sm:p-7">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-32 size-[420px] rounded-full opacity-20 blur-3xl" style={{ background: `radial-gradient(circle, ${club.primary_color}, transparent 65%)` }} />
        <div className="relative flex flex-wrap items-center gap-4 sm:gap-6">
          <Crest id={club.id} name={club.name_snapshot} short={club.short_name} color={club.primary_color} color2={club.secondary_color} size={84} className="drop-shadow-[0_10px_24px_rgb(0_0_0/.55)]" />
          <div className="min-w-0 flex-1 basis-48">
            <p className="eyebrow">{club.manager_name ? `Treinador: ${club.manager_name}` : "Clube da IA"}{mine ? " · o teu clube" : ""}</p>
            <h2 className="headline mt-1 break-words text-3xl sm:truncate sm:text-5xl">{club.name_snapshot}</h2>
            <p className="mt-1 text-sm text-muted">Reputação {club.reputation} · {squad.length} jogadores</p>
          </div>
          <div className="flex w-full items-center justify-around gap-5 border-t border-line pt-4 sm:w-auto sm:justify-start sm:gap-8 sm:border-0 sm:pt-0">
            {row && (
              <>
                <div className="text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-faint">Posição</p><p className="font-display text-3xl font-extrabold tabular">{pos + 1}º</p></div>
                <div className="text-center"><p className="text-[10px] font-bold uppercase tracking-wider text-faint">Pontos</p><p className="font-display text-3xl font-extrabold tabular text-accent">{row.points}</p></div>
                {row.form && <div className="hidden text-center sm:block"><p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-faint">Forma</p><FormStrip form={row.form.slice(-5)} size="sm" /></div>}
              </>
            )}
            <div className="text-center"><OvrBadge ovr={Math.round(Number(club.strength))} size="lg" /><p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-faint">Força</p></div>
          </div>
        </div>
        {mine && <ButtonLink href={`/g/${gameId}/squad`} className="relative mt-5 w-full sm:w-auto"><Shirt className="size-4" />Gerir plantel</ButtonLink>}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Disponíveis", `${squad.length - out.length}/${squad.length}`, out.length ? `${out.length} de fora` : "plantel completo"],
          ["OVR médio", avgOvr ? avgOvr.toFixed(1) : "—", `melhor ${Math.max(0, ...squad.map((p) => p.current_ovr)) || "—"}`],
          ["Idade média", ages.length ? avg(ages).toFixed(1) : "—", ages.length < squad.length ? `${squad.length - ages.length} sem idade` : "anos"],
          ["Valor do plantel", eur(value), "valor de mercado"],
        ].map(([k, v, hint]) => (
          <div key={k} className="surface rounded-[var(--radius-card)] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{k}</p>
            <p className="mt-1.5 font-display text-2xl font-extrabold leading-none tabular sm:text-3xl">{v}</p>
            <p className="mt-1 text-xs text-muted">{hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden p-0 sm:p-0">
          <div className="p-4 pb-0 sm:p-5 sm:pb-0"><CardTitle icon={<Users />}>Plantel</CardTitle></div>
          {squad.length === 0 ? <div className="p-5"><Empty title="Sem jogadores" /></div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm sm:min-w-[620px]">
                <thead className="text-left text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                  <tr className="border-b border-line">
                    <th className="py-2.5 pl-4 sm:pl-5">Jogador</th><th className="w-12 py-2.5 text-center">OVR</th>
                    <th className="hidden w-12 py-2.5 text-center sm:table-cell">Idade</th><th className="hidden w-32 py-2.5 sm:table-cell">Fitness</th>
                    <th className="hidden w-12 py-2.5 text-center md:table-cell">Forma</th><th className="py-2.5 pr-4 text-right sm:pr-5">Estado</th>
                  </tr>
                </thead>
                {GROUPS.map(([g, label]) => {
                  const list = squad.filter((p) => p.position_group === g);
                  if (!list.length) return null;
                  return (
                    <tbody key={g} className="divide-y divide-line/60">
                      <tr className="bg-surface-2/40"><td colSpan={6} className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted sm:px-5">{label} · {list.length}</td></tr>
                      {list.map((p) => {
                        const st = status(p);
                        return (
                          <tr key={p.id} className="transition-colors hover:bg-surface-2/50">
                            <td className="py-2 pl-4 sm:pl-5">
                              <Link href={`/g/${gameId}/players/${p.id}`} className="flex min-w-0 items-center gap-2.5 hover:text-accent">
                                <PosPill group={p.position_group} label={p.position_detail ?? POS_LABEL[p.position_group]} />
                                <span className="truncate font-semibold">{p.name_snapshot}</span>
                              </Link>
                            </td>
                            <td className="py-2 text-center"><OvrBadge ovr={p.current_ovr} size="sm" /></td>
                            <td className="hidden py-2 text-center tabular text-muted sm:table-cell">{p.age ?? "—"}</td>
                            <td className="hidden py-2 pr-3 sm:table-cell"><Meter value={p.fitness} label={`Fitness ${p.fitness}`} /></td>
                            <td className="hidden py-2 text-center md:table-cell"><span className="inline-flex justify-center"><FormArrow form={Number(p.form)} /></span></td>
                            <td className="py-2 pr-4 text-right sm:pr-5">{st ? <Badge tone={st.tone}>{st.label}</Badge> : <span className="text-xs text-faint">Disponível</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  );
                })}
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardTitle icon={<CalendarDays />}>Últimos jogos</CardTitle>
            {played.length === 0 ? <p className="text-sm text-muted">Ainda não jogou.</p> : (
              <ul className="space-y-2">
                {played.map((f) => {
                  const o = opp(f), r = result(f);
                  return (
                    <li key={f.id} className="flex items-center gap-2.5 text-sm">
                      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md font-display text-xs font-black",
                        r.r === "V" ? "bg-up/20 text-up" : r.r === "D" ? "bg-danger/15 text-danger" : "bg-surface-3 text-muted")}>{r.r}</span>
                      <ClubLink gameId={gameId} clubId={o.id} className="flex min-w-0 flex-1 items-center gap-2">
                        <Crest id={o.id} name={o.name} short={o.short} color={o.color} color2={o.color2} size={20} />
                        <span className="truncate">{o.home ? "" : "@ "}{o.name}</span>
                      </ClubLink>
                      <Link href={`/g/${gameId}/matches/${f.id}`} className="font-display font-bold tabular hover:text-accent" aria-label={`Relatório: ${r.gf}–${r.ga}`}>{r.gf}–{r.ga}</Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle>Próximos jogos</CardTitle>
            {upcoming.length === 0 ? <p className="text-sm text-muted">Sem jogos agendados.</p> : (
              <ul className="space-y-2">
                {upcoming.map((f) => {
                  const o = opp(f);
                  return (
                    <li key={f.id} className="flex items-center gap-2.5 text-sm">
                      <span className="w-8 shrink-0 font-display text-xs font-bold text-faint">J{f.round_number}</span>
                      <ClubLink gameId={gameId} clubId={o.id} className="flex min-w-0 flex-1 items-center gap-2">
                        <Crest id={o.id} name={o.name} short={o.short} color={o.color} color2={o.color2} size={20} />
                        <span className="truncate">{o.home ? "" : "@ "}{o.name}</span>
                      </ClubLink>
                      <span className="text-xs text-faint">{o.home ? "Casa" : "Fora"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          {out.length > 0 && (
            <Card>
              <CardTitle icon={<HeartPulse />}>Fora de combate</CardTitle>
              <ul className="space-y-1.5 text-sm">
                {out.map((p) => <li key={p.id} className="flex justify-between gap-2"><Link href={`/g/${gameId}/players/${p.id}`} className="truncate hover:text-accent">{p.name_snapshot}</Link><span className="shrink-0 text-xs text-muted">{status(p)?.label}</span></li>)}
              </ul>
            </Card>
          )}
          <Link href={`/g/${gameId}/table`} className="flex items-center justify-center gap-1 text-sm font-semibold text-muted hover:text-accent">Ver classificação <ArrowRight className="size-4" /></Link>
        </div>
      </div>
    </div>
  );
}
