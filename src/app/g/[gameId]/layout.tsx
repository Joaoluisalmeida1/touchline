import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui";
import { GameNav, MobileDock } from "@/components/game-nav";
import { ClubBadge } from "@/components/squad/avatar";
import { requireUser } from "@/server/auth";
import { getClubColors, getGame } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function GameLayout({ children, params }: { children: React.ReactNode; params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser(`/g/${gameId}`);
  if (!/^[0-9a-f-]{36}$/.test(gameId)) notFound();
  const game = await getGame(user.id, gameId);
  if (!game) notFound(); // non-members get the same response as unknown ids
  const club = game.my_club_id ? await getClubColors(user.id, game.my_club_id) : null;
  const total = Number(game.total_rounds ?? 0);
  const pct = total ? Math.round((game.current_matchday / total) * 100) : 0;
  return (
    <>
      <SiteHeader user={user} />
      <div className="relative overflow-hidden border-b border-line/80">
        <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0" />
        {club && (
          <div aria-hidden className="pointer-events-none absolute -left-24 -top-32 size-[420px] rounded-full opacity-25 blur-3xl"
            style={{ background: `radial-gradient(circle, ${club.primary_color}, transparent 65%)` }} />
        )}
        <div className="relative mx-auto max-w-6xl px-4 pt-5 md:pt-7">
          <div className="flex items-center gap-3 sm:gap-4">
            {club && (
              <ClubBadge seed={game.my_club_id} name={club.name_snapshot} short={club.short_name ?? club.name_snapshot.slice(0, 3)}
                primary={club.primary_color} secondary={club.secondary_color ?? "#ffffff"} size={52} className="hidden drop-shadow-[0_8px_20px_rgb(0_0_0/.6)] sm:block" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-muted">{game.league_name}</p>
                {game.is_synthetic && <Badge tone="warn">Dados fictícios</Badge>}
              </div>
              <h1 className="headline mt-1 truncate text-3xl sm:text-[42px]">{game.name}</h1>
            </div>
            <div className="hidden shrink-0 text-right sm:block">
              {game.status === "setup" ? <Badge tone="info" dot>Em preparação</Badge> : (
                <>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-faint">Época {game.current_season}</p>
                  <p className="font-display text-3xl font-extrabold leading-none tabular">
                    J{game.current_matchday}<span className="text-lg text-faint">/{total || "?"}</span>
                  </p>
                  <div className="mt-1.5 h-1 w-28 overflow-hidden rounded-full bg-line">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2 sm:hidden">
            {game.status === "setup" ? <Badge tone="info" dot>Em preparação</Badge> : <Badge tone="accent">Época {game.current_season} · J{game.current_matchday}/{total || "?"}</Badge>}
            {club && <span className="truncate text-xs text-muted">{club.name_snapshot}</span>}
          </div>
          <GameNav gameId={gameId} isOwner={game.is_owner} />
          <div className="h-4 md:hidden" />
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-6 md:pb-10">{children}</main>
      <MobileDock gameId={gameId} isOwner={game.is_owner} />
    </>
  );
}
