import Link from "next/link";
import { ArrowRight, Newspaper, Star, Target } from "lucide-react";
import { Crest } from "@/components/crest";
import { Stagger, StaggerItem } from "@/components/fx/motion";
import { TeamOfRound } from "@/components/team-of-round";
import { Card, CardTitle, Empty, cn } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getPool } from "@/server/db";
import { getClubsLook, getEdition, getEditions } from "@/server/league-queries";
import { getGame } from "@/server/queries";
import { ensureEditions } from "@/server/services/newspaper";

export const metadata = { title: "O Apito" };

const KIND_LABEL: Record<string, string> = {
  derby: "Duelo de treinadores", upset: "Surpresa", thrashing: "Goleada", hat_trick: "Hat-trick", comeback: "Reviravolta",
  late_winner: "Golo tardio", new_leader: "Liderança", red_card: "Expulsão", goal_fest: "Festival de golos", human_result: "Os nossos", title_race: "Título",
};

export default async function NewsPage({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ s?: string; r?: string }> }) {
  const { gameId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const game = await getGame(user.id, gameId);
  if (!game) return null;
  // back-fill editions for rounds processed before the newspaper existed (idempotent, cheap when nothing is missing)
  await ensureEditions(getPool(), gameId).catch((e) => console.error(JSON.stringify({ level: "error", msg: "newspaper.backfill_failed", error: (e as Error).message })));
  const editions = await getEditions(user.id, gameId);
  if (!editions.length) return <Empty title="Ainda sem edições" icon={<Newspaper />}>O Apito sai depois de cada jornada.</Empty>;
  const sel = editions.find((e) => e.season === Number(sp.s) && e.round === Number(sp.r)) ?? editions[0];
  const [{ news, awards }, clubs] = await Promise.all([getEdition(user.id, gameId, sel.season, sel.round), getClubsLook(user.id, gameId)]);
  const look = new Map(clubs.map((c) => [c.id, c]));
  const [lead, ...rest] = news;
  const crest = (id: string, size: number) => {
    const c = look.get(id);
    return c ? <Crest id={id} name={c.name_snapshot} short={c.short_name} color={c.primary_color} color2={c.secondary_color} size={size} /> : null;
  };
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-4 border-double border-line-strong pb-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-faint">O jornal de {game.name}</p>
          <h2 className="headline text-6xl italic sm:text-7xl">O Apito</h2>
        </div>
        <p className="font-display text-lg font-bold uppercase text-muted">Época {sel.season} · Jornada {sel.round}</p>
      </header>
      <nav aria-label="Edições" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {editions.map((e) => {
          const on = e.season === sel.season && e.round === sel.round;
          return (
            <Link key={`${e.season}-${e.round}`} href={`?s=${e.season}&r=${e.round}`} aria-current={on ? "page" : undefined}
              className={cn("flex h-10 shrink-0 items-center rounded-xl px-3 font-display text-base font-bold ring-1 transition", on ? "bg-accent text-accent-ink ring-accent" : "bg-surface-2 text-muted ring-line hover:text-ink")}>
              {editions.some((x) => x.season !== e.season) ? `E${e.season} ` : ""}J{e.round}
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Stagger className="min-w-0 space-y-4">
          {lead && (
            <StaggerItem>
              <article className="surface relative overflow-hidden rounded-[var(--radius-card)] p-5 sm:p-7">
                <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0" />
                <div className="relative">
                  <p className="eyebrow">Manchete · {KIND_LABEL[lead.kind] ?? lead.kind}</p>
                  <h3 className="headline mt-3 text-4xl sm:text-6xl">{lead.headline}</h3>
                  <div className="mt-4 flex items-center gap-2">{lead.club_ids.map((id) => <span key={id}>{crest(id, 34)}</span>)}</div>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-muted">{lead.body}</p>
                  {lead.fixture_id && (
                    <Link href={`/g/${gameId}/matches/${lead.fixture_id}`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-accent hover:underline">
                      Ver o jogo <ArrowRight className="size-4" />
                    </Link>
                  )}
                </div>
              </article>
            </StaggerItem>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {rest.map((s) => (
              <StaggerItem key={s.id}>
                <article className="surface h-full rounded-[var(--radius-card)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-faint">{KIND_LABEL[s.kind] ?? s.kind}</p>
                    <div className="flex -space-x-1">{s.club_ids.map((id) => <span key={id}>{crest(id, 22)}</span>)}</div>
                  </div>
                  <h3 className="mt-2 font-display text-2xl font-extrabold uppercase leading-tight">{s.headline}</h3>
                  {s.body && <p className="mt-2 text-sm leading-6 text-muted">{s.body}</p>}
                  {s.fixture_id && <Link href={`/g/${gameId}/matches/${s.fixture_id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-muted hover:text-accent">Ver o jogo <ArrowRight className="size-3.5" /></Link>}
                </article>
              </StaggerItem>
            ))}
          </div>
        </Stagger>

        <div className="space-y-5">
          {awards?.player && (
            <Card glow>
              <CardTitle icon={<Star />}>Jogador da jornada</CardTitle>
              <div className="flex items-center gap-3">
                {crest(awards.player.club_id, 44)}
                <div className="min-w-0 flex-1">
                  <Link href={`/g/${gameId}/players/${awards.player.id}`} className="block truncate font-display text-2xl font-extrabold uppercase hover:text-accent">{awards.player.name}</Link>
                  <p className="text-xs text-muted">{look.get(awards.player.club_id)?.name_snapshot} · {awards.player.goals} golos · {awards.player.assists} assist.</p>
                </div>
                <span className="rounded-xl bg-accent px-2.5 py-1 font-display text-3xl font-extrabold text-accent-ink tabular">{awards.player.rating.toFixed(1)}</span>
              </div>
            </Card>
          )}
          {awards && awards.team.length > 0 && (
            <Card>
              <CardTitle>Equipa da jornada</CardTitle>
              <TeamOfRound team={awards.team} look={look} />
            </Card>
          )}
          {awards?.goal && (
            <Card>
              <CardTitle icon={<Target />}>Golo da jornada</CardTitle>
              <p className="font-display text-xl font-bold uppercase">{awards.goal.scorer} <span className="text-faint">{awards.goal.minute}&apos;</span></p>
              <p className="mt-1 text-sm text-muted">Marcou de uma oportunidade com apenas <b className="text-ink">{Math.round(awards.goal.xg * 100)}%</b> de probabilidade (xG {awards.goal.xg.toFixed(2)}).</p>
              <Link href={`/g/${gameId}/matches/${awards.goal.fixture_id}`} className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-muted hover:text-accent">Ver o jogo <ArrowRight className="size-3.5" /></Link>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
