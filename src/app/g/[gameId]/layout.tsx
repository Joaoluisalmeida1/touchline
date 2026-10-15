import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui";
import { GameNav } from "@/components/game-nav";
import { requireUser } from "@/server/auth";
import { getGame } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function GameLayout({ children, params }: { children: React.ReactNode; params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser(`/g/${gameId}`);
  if (!/^[0-9a-f-]{36}$/.test(gameId)) notFound();
  const game = await getGame(user.id, gameId);
  if (!game) notFound(); // non-members get the same response as unknown ids
  return (
    <>
      <SiteHeader user={user} />
      <div className="border-b border-line/70 bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black tracking-tight">{game.name}</h1>
            {game.is_synthetic && <Badge tone="warn">Dados fictícios</Badge>}
            <Badge tone={game.status === "active" ? "accent" : "default"}>
              {game.status === "setup" ? "Em preparação" : `Época ${game.current_season} · J${game.current_matchday}/${game.total_rounds ?? "?"}`}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{game.league_name}</p>
          <GameNav gameId={gameId} isOwner={game.is_owner} />
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
