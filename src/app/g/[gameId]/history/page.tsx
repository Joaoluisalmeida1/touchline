import Link from "next/link";
import { Crown, Flame, Footprints, Medal, Shield, Swords, Trophy } from "lucide-react";
import { Crest } from "@/components/crest";
import { Badge, Card, CardTitle, Empty, cn } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getClubsLook, getHallOfFame, getRivalries } from "@/server/league-queries";
import { getGame } from "@/server/queries";

export const metadata = { title: "História" };

const FEAT: [string, string][] = [["hat_trick", "Hat-tricks"], ["upset", "Surpresas"], ["comeback", "Reviravoltas"], ["late_winner", "Golos decisivos ≥85'"], ["big_win", "Goleadas"], ["red_card", "Expulsões"]];

export default async function HistoryPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = await getGame(user.id, gameId);
  if (!game) return null;
  const [hof, rivals, clubs] = await Promise.all([getHallOfFame(user.id, gameId), getRivalries(user.id, gameId), getClubsLook(user.id, gameId)]);
  const look = new Map(clubs.map((c) => [c.id, c]));
  const name = (id: string | null) => (id ? look.get(id)?.name_snapshot ?? "—" : "Sem clube");
  const crest = (id: string | null, size = 24) => {
    const c = id ? look.get(id) : undefined;
    return c ? <Crest id={c.id} name={c.name_snapshot} short={c.short_name} color={c.primary_color} color2={c.secondary_color} size={size} /> : null;
  };
  if (!hof.champions.length) return <Empty title="A história ainda está por escrever" icon={<Trophy />}>Os recordes aparecem depois da primeira jornada.</Empty>;
  return (
    <div className="space-y-5">
      <Card>
        <CardTitle icon={<Trophy />}>Campeões</CardTitle>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {hof.champions.map((c) => (
            <li key={c.season} className={cn("flex min-w-0 items-center gap-3 rounded-2xl border p-3", c.completed ? "border-gold/40 bg-gold/[.06]" : "border-line bg-bg/40")}>
              {crest(c.club_id, 40)}
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-faint">Época {c.season}</p>
                <p className="truncate font-display text-xl font-bold uppercase">{name(c.club_id)}</p>
                <p className="text-xs text-muted">{c.points} pontos{look.get(c.club_id)?.manager_name ? ` · ${look.get(c.club_id)?.manager_name}` : ""}</p>
              </div>
              {c.completed ? <Crown className="size-5 text-gold" aria-label="Campeão" /> : <Badge tone="accent" dot>Em curso</Badge>}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle icon={<Swords />}>Rivalidades</CardTitle>
        {rivals.length === 0 ? <p className="text-sm text-muted">Quando dois treinadores se defrontarem, o confronto direto aparece aqui.</p> : (
          <ul className="space-y-2.5">
            {rivals.map((r) => {
              const total = Math.max(1, r.played);
              return (
                <li key={`${r.a}-${r.b}`} className="rounded-2xl border border-line bg-bg/40 p-3">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <div className="flex min-w-0 items-center justify-end gap-2 text-right">
                      <span className="min-w-0"><span className="block truncate font-bold">{name(r.a)}</span><span className="block text-xs text-muted">{look.get(r.a)?.manager_name}</span></span>{crest(r.a, 32)}
                    </div>
                    <span className="font-display text-2xl font-extrabold tabular">{r.a_wins}<span className="mx-1.5 text-base text-faint">{r.draws}E</span>{r.b_wins}</span>
                    <div className="flex min-w-0 items-center gap-2">
                      {crest(r.b, 32)}<span className="min-w-0"><span className="block truncate font-bold">{name(r.b)}</span><span className="block text-xs text-muted">{look.get(r.b)?.manager_name}</span></span>
                    </div>
                  </div>
                  <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-line">
                    <div style={{ width: `${(r.a_wins / total) * 100}%`, background: look.get(r.a)?.primary_color }} />
                    <div className="bg-surface-3" style={{ width: `${(r.draws / total) * 100}%` }} />
                    <div style={{ width: `${(r.b_wins / total) * 100}%`, background: look.get(r.b)?.primary_color }} />
                  </div>
                  <p className="mt-1.5 text-center text-[11px] text-faint">{r.played} jogos · golos {r.a_goals}–{r.b_goals}</p>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle icon={<Medal />}>Melhores marcadores</CardTitle>
          <ol className="space-y-1.5 text-sm">
            {hof.scorers.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2.5">
                <span className={cn("w-5 text-right font-display font-bold", i === 0 ? "text-accent" : "text-faint")}>{i + 1}</span>
                {crest(p.club_id, 20)}
                <Link href={`/g/${gameId}/players/${p.id}`} className="flex-1 truncate font-semibold hover:text-accent">{p.name}</Link>
                <span className="text-xs text-muted tabular">{p.apps} J · {p.assists} A</span>
                <span className="w-8 text-right font-display text-lg font-extrabold tabular">{p.goals}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardTitle icon={<Footprints />}>Mais jogos</CardTitle>
          <ol className="space-y-1.5 text-sm">
            {hof.apps.map((p, i) => (
              <li key={p.id} className="flex items-center gap-2.5">
                <span className="w-5 text-right font-display font-bold text-faint">{i + 1}</span>
                {crest(p.club_id, 20)}
                <Link href={`/g/${gameId}/players/${p.id}`} className="flex-1 truncate font-semibold hover:text-accent">{p.name}</Link>
                <span className="text-xs text-muted tabular">nota {p.avg?.toFixed(2) ?? "—"}</span>
                <span className="w-8 text-right font-display text-lg font-extrabold tabular">{p.apps}</span>
              </li>
            ))}
          </ol>
        </Card>
        <Card>
          <CardTitle icon={<Flame />}>Maiores goleadas</CardTitle>
          <ul className="space-y-1.5 text-sm">
            {hof.biggest.map((f) => (
              <li key={f.id}>
                <Link href={`/g/${gameId}/matches/${f.id}`} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-surface-2">
                  <span className="w-14 text-xs text-faint">E{f.season} J{f.round_number}</span>
                  <span className="flex-1 truncate text-right">{name(f.home_club_id)}</span>
                  <span className="rounded-md bg-surface-3 px-2 font-display font-extrabold tabular">{f.result_home}–{f.result_away}</span>
                  <span className="flex-1 truncate">{name(f.away_club_id)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle icon={<Shield />}>Recordes</CardTitle>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-faint">Maior série sem perder</p>
          <ul className="mb-4 space-y-1.5 text-sm">
            {hof.unbeaten.map((u) => <li key={u.club_id} className="flex items-center gap-2">{crest(u.club_id, 20)}<span className="flex-1 truncate">{name(u.club_id)}</span><span className="font-display text-lg font-extrabold tabular">{u.n}</span></li>)}
          </ul>
          {hof.awards.length > 0 && (
            <>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-faint">Mais vezes jogador da jornada</p>
              <ul className="mb-4 space-y-1.5 text-sm">
                {hof.awards.map((a) => <li key={a.player_id} className="flex items-center gap-2">{crest(a.club_id, 20)}<Link href={`/g/${gameId}/players/${a.player_id}`} className="flex-1 truncate hover:text-accent">{a.name}</Link><span className="font-display text-lg font-extrabold tabular">{a.n}×</span></li>)}
              </ul>
            </>
          )}
          <div className="grid grid-cols-3 gap-2">
            {FEAT.map(([k, l]) => (
              <div key={k} className="min-w-0 rounded-xl border border-line bg-bg/40 p-2 text-center [overflow-wrap:anywhere]">
                <p className="font-display text-2xl font-extrabold tabular">{hof.feats[k] ?? 0}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-faint">{l}</p>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
