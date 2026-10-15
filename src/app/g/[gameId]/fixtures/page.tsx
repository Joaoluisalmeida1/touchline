import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { Crest } from "@/components/crest";
import { Stagger, StaggerItem } from "@/components/fx/motion";
import { Badge, Card, Empty, cn } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getFixtures, getGame } from "@/server/queries";

export const metadata = { title: "Jogos" };

export default async function FixturesPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const fixtures = await getFixtures(user.id, gameId);
  if (!fixtures.length) return <Empty title="Calendário ainda não gerado" icon={<CalendarDays />}>O criador gera o calendário ao iniciar a liga.</Empty>;
  const rounds = new Map<number, typeof fixtures>();
  for (const f of fixtures) rounds.set(f.round_number, [...(rounds.get(f.round_number) ?? []), f]);
  const current = game.current_matchday + 1;
  const mineResult = (f: (typeof fixtures)[number]) => {
    if (f.status !== "completed" || !game.my_club_id) return null;
    const home = f.home_club_id === game.my_club_id;
    if (!home && f.away_club_id !== game.my_club_id) return null;
    const d = (home ? 1 : -1) * (f.result_home - f.result_away);
    return d > 0 ? "W" : d < 0 ? "L" : "D";
  };
  return (
    <div className="space-y-5">
      <nav aria-label="Jornadas" className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1">
        {[...rounds.keys()].map((r) => {
          const done = rounds.get(r)!.every((f) => f.status === "completed");
          return (
            <a key={r} href={`#r${r}`}
              className={cn("flex h-10 min-w-10 shrink-0 items-center justify-center rounded-xl px-2.5 font-display text-base font-bold tabular ring-1 transition",
                r === current ? "bg-accent text-accent-ink ring-accent" : done ? "bg-surface-2 text-ink ring-line hover:ring-line-strong" : "bg-bg/40 text-faint ring-line hover:text-muted")}>
              J{r}
            </a>
          );
        })}
      </nav>
      <Stagger className="grid gap-4 md:grid-cols-2" gap={0.03}>
        {[...rounds.entries()].map(([round, list]) => {
          const isNext = round === current;
          const done = list.every((f) => f.status === "completed");
          return (
            <StaggerItem key={round}>
              <Card id={`r${round}`} glow={isNext} className="scroll-mt-24 p-0 sm:p-0">
                <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
                  <h2 className="flex items-center gap-2 font-display text-xl font-extrabold uppercase tracking-tight">
                    Jornada {round}
                    {isNext && <Badge tone="accent" dot>Próxima</Badge>}
                    {done && !isNext && <Badge>Concluída</Badge>}
                  </h2>
                  <span className="text-xs font-medium capitalize text-muted">{list[0].kickoff_at ? new Date(list[0].kickoff_at).toLocaleString("pt-PT", { timeZone: game.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</span>
                </div>
                <ul className="p-1.5">
                  {list.map((f) => {
                    const mine = game.my_club_id && [f.home_club_id, f.away_club_id].includes(game.my_club_id);
                    const res = mineResult(f);
                    const played = f.status === "completed";
                    const hw = played && f.result_home > f.result_away, aw = played && f.result_away > f.result_home;
                    const row = (
                      <div className={cn("relative grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition",
                        mine && "bg-accent/[.07] ring-1 ring-accent/20", played && "hover:bg-surface-2")}>
                        <span className={cn("flex min-w-0 items-center justify-end gap-2 text-right", hw ? "font-bold text-ink" : "text-muted", !played && "text-ink")}>
                          <span className="truncate">{f.home_name}</span>
                          <Crest id={f.home_club_id} name={f.home_name} short={f.home_short} color={f.home_color} color2={f.home_color2} size={22} />
                        </span>
                        <span className={cn("min-w-[58px] rounded-lg px-2 py-0.5 text-center font-display text-lg font-extrabold tabular ring-1",
                          !played ? "text-faint ring-line" : res === "W" ? "bg-accent text-accent-ink ring-accent" : res === "L" ? "bg-danger/15 text-danger ring-danger/30" : "bg-surface-3 ring-line-strong")}>
                          {played ? `${f.result_home}–${f.result_away}` : "vs"}
                        </span>
                        <span className={cn("flex min-w-0 items-center gap-2", aw ? "font-bold text-ink" : "text-muted", !played && "text-ink")}>
                          <Crest id={f.away_club_id} name={f.away_name} short={f.away_short} color={f.away_color} color2={f.away_color2} size={22} />
                          <span className="truncate">{f.away_name}</span>
                        </span>
                      </div>
                    );
                    return <li key={f.id}>{played ? <Link href={`/g/${gameId}/matches/${f.id}`} aria-label={`${f.home_name} ${f.result_home}–${f.result_away} ${f.away_name}`}>{row}</Link> : row}</li>;
                  })}
                </ul>
              </Card>
            </StaggerItem>
          );
        })}
      </Stagger>
    </div>
  );
}
