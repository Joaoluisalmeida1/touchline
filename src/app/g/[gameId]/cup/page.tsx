import { Trophy } from "lucide-react";
import { Crest } from "@/components/crest";
import { Badge, Card, Empty, cn } from "@/components/ui";
import { roundName } from "@/engine/cup/cup";
import { requireUser } from "@/server/auth";
import { getCup, type CupTieRow } from "@/server/career-queries";
import { getPool } from "@/server/db";
import { getClubsLook } from "@/server/league-queries";
import { getGame } from "@/server/queries";
import { ensureCup } from "@/server/services/cup";

export const metadata = { title: "Taça" };

export default async function CupPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  if (game.status === "active") await ensureCup(getPool(), gameId).catch((e) => console.error(JSON.stringify({ level: "error", msg: "cup.ensure_failed", error: (e as Error).message })));
  const [{ ties, meta, winners }, clubs] = await Promise.all([getCup(user.id, gameId, game.current_season), getClubsLook(user.id, gameId)]);
  if (!meta) return <Empty title="Ainda sem taça" icon={<Trophy />}>A Taça da Liga dos Amigos é sorteada quando a liga começa.</Empty>;
  const look = new Map(clubs.map((c) => [c.id, c]));
  const champion = winners.find((w) => w.season === game.current_season);
  const rounds = Array.from({ length: meta.rounds }, (_, i) => i + 1);
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">Época {game.current_season} · eliminatórias a uma mão, empate decide-se nos penáltis</p>
          <h2 className="headline text-4xl sm:text-5xl">Taça da Liga dos Amigos</h2>
        </div>
        {champion && look.get(champion.club_id) && (
          <div className="flex items-center gap-3 rounded-2xl border border-[#ffcc4d]/40 bg-[#ffcc4d]/10 px-4 py-2">
            <Trophy className="size-6 text-[#ffcc4d]" />
            <div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">Vencedor</p><p className="font-display text-xl font-bold uppercase">{look.get(champion.club_id)!.name_snapshot}</p></div>
          </div>
        )}
      </header>
      <div className="no-scrollbar -mx-4 overflow-x-auto px-4 pb-2">
        <div className="flex min-w-max gap-4">
          {rounds.map((k) => {
            const list = ties.filter((t) => t.round === k);
            return (
              <section key={k} className="w-64 shrink-0 space-y-3">
                <div className="flex items-baseline justify-between">
                  <h3 className="font-display text-lg font-bold uppercase">{roundName(k, meta.rounds)}</h3>
                  <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-faint">após a J{meta.schedule[k - 1]}</span>
                </div>
                {list.length === 0 ? (
                  <Card className="p-3 sm:p-3"><p className="text-xs text-muted">Por definir.</p></Card>
                ) : (
                  <div className="flex flex-col justify-around gap-3" style={{ minHeight: `${(ties.filter((t) => t.round === 1).length || 1) * 5.5}rem` }}>
                    {list.map((t) => <TieCard key={t.id} t={t} look={look} me={game.my_club_id} />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>
      {winners.length > 0 && (
        <Card>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Palmarés</p>
          <ul className="flex flex-wrap gap-2 text-sm">{winners.map((w) => <li key={w.season}><Badge tone="accent">E{w.season} · {look.get(w.club_id)?.name_snapshot ?? "?"}</Badge></li>)}</ul>
        </Card>
      )}
    </div>
  );
}

function TieCard({ t, look, me }: { t: CupTieRow; look: Map<string, { id: string; name_snapshot: string; short_name: string; primary_color: string; secondary_color: string }>; me: string | null }) {
  const side = (id: string | null, goals: number | null, pens: number | null) => {
    const c = id ? look.get(id) : null;
    const won = !!id && t.winner_club_id === id && t.status !== "scheduled";
    return (
      <div className={cn("flex items-center gap-2 px-3 py-2", won ? "text-ink" : t.status === "played" ? "text-muted" : "text-ink", id === me && "bg-accent/8")}>
        {c ? <Crest id={c.id} name={c.name_snapshot} short={c.short_name} color={c.primary_color} color2={c.secondary_color} size={20} /> : <span className="size-5" />}
        <span className={cn("flex-1 truncate text-sm", won && "font-bold")}>{c?.name_snapshot ?? (t.status === "bye" ? "Isento" : "—")}</span>
        {t.status === "played" && <span className="font-display text-lg font-bold tabular">{goals}{pens !== null && <span className="ml-1 text-xs text-faint">({pens})</span>}</span>}
      </div>
    );
  };
  const goals = (t.result_json?.events ?? []).filter((e) => e.type === "goal" || e.type === "own_goal");
  return (
    <div className={cn("overflow-hidden rounded-2xl border bg-surface/70", (t.home_club_id === me || t.away_club_id === me) ? "border-accent/40" : "border-line")}>
      {side(t.home_club_id, t.home_goals, t.pens_home)}
      <div className="h-px bg-line" />
      {side(t.away_club_id, t.away_goals, t.pens_away)}
      {goals.length > 0 && (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">{goals.map((g) => `${g.player ?? "?"} ${g.minute}'`).join(" · ")}</p>
      )}
      {t.status === "bye" && <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">Passa à ronda seguinte (isento).</p>}
    </div>
  );
}
