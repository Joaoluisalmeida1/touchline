import Link from "next/link";
import { Card, ClubDot, Empty, cn } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getFixtures, getGame } from "@/server/queries";

export const metadata = { title: "Jogos" };

export default async function FixturesPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const fixtures = await getFixtures(user.id, gameId);
  if (!fixtures.length) return <Empty title="Calendário ainda não gerado">O criador gera o calendário ao iniciar a liga.</Empty>;
  const rounds = new Map<number, typeof fixtures>();
  for (const f of fixtures) rounds.set(f.round_number, [...(rounds.get(f.round_number) ?? []), f]);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[...rounds.entries()].map(([round, list]) => (
        <Card key={round} id={`r${round}`} className={cn(round === game.current_matchday + 1 && "border-accent/50")}>
          <div className="mb-2 flex items-center justify-between text-sm">
            <h2 className="font-bold">Jornada {round}</h2>
            <span className="text-xs text-muted">{list[0].kickoff_at ? new Date(list[0].kickoff_at).toLocaleString("pt-PT", { timeZone: game.timezone, dateStyle: "short", timeStyle: "short" }) : ""}</span>
          </div>
          <ul className="space-y-1 text-sm">
            {list.map((f) => {
              const mine = game.my_club_id && [f.home_club_id, f.away_club_id].includes(game.my_club_id);
              const row = (
                <div className={cn("grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg px-2 py-1.5", mine && "bg-accent/10", f.status === "completed" && "hover:bg-surface-2")}>
                  <span className="flex items-center justify-end gap-2 truncate text-right">{f.home_name}<ClubDot color={f.home_color} /></span>
                  <span className="min-w-12 rounded bg-bg px-2 py-0.5 text-center font-bold tabular">{f.status === "completed" ? `${f.result_home}–${f.result_away}` : "vs"}</span>
                  <span className="flex items-center gap-2 truncate"><ClubDot color={f.away_color} />{f.away_name}</span>
                </div>
              );
              return <li key={f.id}>{f.status === "completed" ? <Link href={`/g/${gameId}/matches/${f.id}`}>{row}</Link> : row}</li>;
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
