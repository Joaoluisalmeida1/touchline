import { notFound } from "next/navigation";
import Link from "next/link";
import { Card, CardTitle, ClubDot, POS_LABEL } from "@/components/ui";
import { MatchReplay } from "@/components/match-replay";
import { requireUser } from "@/server/auth";
import { getMatch } from "@/server/queries";

export const metadata = { title: "Jogo" };

const STAT_ROWS: [string, string, (v: number) => string][] = [
  ["possession_pct", "Posse de bola", (v) => `${v}%`], ["xg", "Golos esperados (xG)", (v) => v.toFixed(2)], ["shots", "Remates", String],
  ["shots_on_target", "Remates enquadrados", String], ["big_chances", "Grandes oportunidades", String], ["corners", "Cantos", String],
  ["passes_completed", "Passes certos", String], ["fouls", "Faltas", String], ["yellow_cards", "Amarelos", String], ["red_cards", "Vermelhos", String],
  ["offsides", "Foras de jogo", String], ["saves", "Defesas", String],
];

export default async function MatchPage({ params }: { params: Promise<{ gameId: string; fixtureId: string }> }) {
  const { gameId, fixtureId } = await params;
  const user = await requireUser();
  const m = await getMatch(user.id, gameId, fixtureId);
  if (!m) notFound();
  const f = m.fixture;
  if (f.status !== "completed") return <Card>Este jogo ainda não foi disputado.</Card>;
  const ts = (f.stats_json ?? {}) as { home: Record<string, number>; away: Record<string, number> };
  const side = (clubId: string): "home" | "away" => (clubId === f.home_club_id ? "home" : "away");
  const events = m.events.map((e) => ({
    seq: e.sequence_number, minute: e.minute, type: e.event_type, side: e.club_id ? side(e.club_id) : ("home" as const),
    player: e.player_name, related: e.related_name, payload: e.payload_json,
  }));
  const momentum = (m.fixture.result_json?.momentum ?? []) as number[];
  return (
    <div className="space-y-6">
      <Card className="text-center">
        <p className="text-xs uppercase tracking-widest text-muted">Jornada {f.round_number}</p>
        <MatchReplay
          home={{ name: f.home_name, color: f.home_color }} away={{ name: f.away_name, color: f.away_color }}
          finalScore={[f.result_home, f.result_away]} events={events} momentum={momentum}
        />
        <p className="mt-3 text-[11px] text-faint">Motor {f.simulation_version} · seed reprodutível · hash {String(f.input_hash).slice(0, 10)}…</p>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Estatísticas</CardTitle>
          <ul className="space-y-2.5 text-sm">
            {STAT_ROWS.map(([k, label, fmt]) => {
              const h = Number(ts.home?.[k] ?? 0), a = Number(ts.away?.[k] ?? 0);
              const total = h + a || 1;
              return (
                <li key={k}>
                  <div className="flex justify-between tabular"><span className="font-semibold">{fmt(h)}</span><span className="text-muted">{label}</span><span className="font-semibold">{fmt(a)}</span></div>
                  <div className="mt-1 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-line">
                    <div style={{ width: `${(h / total) * 100}%`, background: f.home_color }} /><div style={{ width: `${(a / total) * 100}%`, background: f.away_color }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardTitle>Notas dos jogadores</CardTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            {(["home", "away"] as const).map((s) => (
              <div key={s}>
                <p className="mb-1 flex items-center gap-2 text-sm font-bold"><ClubDot color={s === "home" ? f.home_color : f.away_color} />{s === "home" ? f.home_name : f.away_name}</p>
                <ul className="space-y-0.5 text-xs">
                  {m.stats.filter((p) => side(p.club_id) === s).map((p) => (
                    <li key={p.game_player_id} className="flex items-center gap-1">
                      <span className="w-7 text-faint">{POS_LABEL[p.position_group]}</span>
                      <Link href={`/g/${gameId}/players/${p.game_player_id}`} className="flex-1 truncate hover:text-info">{p.name_snapshot}{!p.started && <span className="text-faint"> (s)</span>}</Link>
                      <span className="text-faint tabular">{p.minutes}&apos;</span>
                      {p.goals > 0 && <span title="golos">⚽{p.goals > 1 ? p.goals : ""}</span>}
                      {p.assists > 0 && <span title="assistências" className="text-info">A{p.assists > 1 ? p.assists : ""}</span>}
                      <span className={`w-8 text-right font-bold tabular ${Number(p.rating) >= 7.5 ? "text-accent" : Number(p.rating) < 6 ? "text-danger" : ""}`}>{p.rating ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
