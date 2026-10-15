import { Empty } from "@/components/ui";
import { TacticsBoard } from "@/components/tactics-board";
import { requireUser } from "@/server/auth";
import { getGame, getSquad, getTacticsAndLineup } from "@/server/queries";

export const metadata = { title: "Tática" };

export default async function TacticsPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  if (!game.my_club_id) return <Empty title="Ainda não tens clube">Escolhe um clube no Resumo.</Empty>;
  const [squad, { tactics, lineup }] = await Promise.all([getSquad(user.id, gameId, game.my_club_id), getTacticsAndLineup(user.id, game.my_club_id)]);
  const locked = !!game.processing_lease_until && new Date(game.processing_lease_until) > new Date();
  return (
    <TacticsBoard
      gameId={gameId}
      locked={locked}
      squad={squad.map((p) => ({
        id: p.id, name: p.name_snapshot, position_group: p.position_group, position_detail: p.position_detail, current_ovr: p.current_ovr,
        fitness: p.fitness, form: Number(p.form), injured_matches: p.injured_matches, suspension_matches: p.suspension_matches,
      }))}
      initialFormation={(lineup?.formation ?? tactics?.formation ?? "4-3-3")}
      initialStarters={lineup?.starters_json ?? null}
      initialBench={lineup?.bench_json ?? []}
      initialTactics={{
        mentality: tactics?.mentality ?? "balanced", tempo: tactics?.tempo ?? "normal", pressing: tactics?.pressing ?? "medium",
        defensive_line: tactics?.defensive_line ?? "medium", width: tactics?.width ?? "balanced",
        passing_directness: tactics?.passing_directness ?? "mixed", transitions: tactics?.transitions ?? "balanced",
      }}
      warnings={lineup?.warnings_json ?? []}
    />
  );
}
