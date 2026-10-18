import { notFound } from "next/navigation";
import { GameShell } from "@/components/shell/game-shell";
import { requireUser } from "@/server/auth";
import { getClubColors, getGame, getMySquadLight } from "@/server/queries";
import { getTodayItems } from "@/server/today-queries";

export const dynamic = "force-dynamic";

export default async function GameLayout({ children, params }: { children: React.ReactNode; params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser(`/g/${gameId}`);
  if (!/^[0-9a-f-]{36}$/.test(gameId)) notFound();
  const game = await getGame(user.id, gameId);
  if (!game) notFound(); // non-members get the same response as unknown ids
  const clubId: string | null = game.my_club_id ?? null;
  const [club, today, players] = await Promise.all([
    clubId ? getClubColors(user.id, clubId) : null,
    clubId ? getTodayItems(user.id, gameId, clubId).catch((e) => { console.error(JSON.stringify({ level: "error", msg: "today.failed", error: (e as Error).message })); return []; }) : [],
    clubId ? getMySquadLight(user.id, clubId) : [],
  ]);
  return (
    <GameShell
      game={{
        id: gameId, name: game.name, league: game.league_name, status: game.status, season: game.current_season, round: game.current_matchday,
        totalRounds: Number(game.total_rounds ?? 0), deadline: game.next_deadline_at ? new Date(game.next_deadline_at).toISOString() : null,
        synthetic: !!game.is_synthetic, isOwner: !!game.is_owner,
      }}
      club={club && clubId ? {
        id: clubId, name: club.name_snapshot, short: club.short_name ?? club.name_snapshot.slice(0, 3),
        primary: club.primary_color ?? "#64748b", secondary: club.secondary_color ?? "#ffffff", skin: club.crest_skin ?? null,
      } : null}
      today={today}
      players={players}
    >
      {children}
    </GameShell>
  );
}
