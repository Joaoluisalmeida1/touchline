import { notFound } from "next/navigation";
import Link from "next/link";
import { BarChart3, Star } from "lucide-react";
import { Crest } from "@/components/crest";
import { Bar } from "@/components/fx/motion";
import { MatchReplay } from "@/components/match-replay";
import { Card, CardTitle, Empty, PosPill, cn } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getMatch } from "@/server/queries";

export const metadata = { title: "Jogo" };

const STAT_ROWS: [string, string, (v: number) => string][] = [
  ["possession_pct", "Posse de bola", (v) => `${v}%`], ["xg", "Golos esperados (xG)", (v) => v.toFixed(2)], ["shots", "Remates", String],
  ["shots_on_target", "Remates enquadrados", String], ["big_chances", "Grandes oportunidades", String], ["corners", "Cantos", String],
  ["passes_completed", "Passes certos", String], ["fouls", "Faltas", String], ["yellow_cards", "Amarelos", String], ["red_cards", "Vermelhos", String],
  ["offsides", "Foras de jogo", String], ["saves", "Defesas", String],
];

const ratingTone = (r: number) => (r >= 8 ? "bg-accent text-accent-ink" : r >= 7 ? "bg-emerald-400/90 text-emerald-950" : r >= 6.3 ? "bg-surface-3 text-ink ring-1 ring-line-strong" : r >= 5.8 ? "bg-warn/90 text-amber-950" : "bg-danger text-white");

export default async function MatchPage({ params }: { params: Promise<{ gameId: string; fixtureId: string }> }) {
  const { gameId, fixtureId } = await params;
  const user = await requireUser();
  const m = await getMatch(user.id, gameId, fixtureId);
  if (!m) notFound();
  const f = m.fixture;
  if (f.status !== "completed") return <Empty title="Este jogo ainda não foi disputado." />;
  const ts = (f.stats_json ?? {}) as { home: Record<string, number>; away: Record<string, number> };
  const side = (clubId: string): "home" | "away" => (clubId === f.home_club_id ? "home" : "away");
  const events = m.events.map((e) => ({
    seq: e.sequence_number, minute: e.minute, type: e.event_type, side: e.club_id ? side(e.club_id) : ("home" as const),
    player: e.player_name, related: e.related_name, payload: e.payload_json,
  }));
  const momentum = (m.fixture.result_json?.momentum ?? []) as number[];
  const short = (name: string, s?: string | null) => s || name.slice(0, 3).toUpperCase();
  const motm = [...m.stats].filter((p) => p.rating !== null).sort((a, b) => Number(b.rating) - Number(a.rating))[0];
  return (
    <div className="space-y-5">
      <MatchReplay round={f.round_number}
        home={{ id: f.home_club_id, name: f.home_name, short: short(f.home_name, f.home_short), color: f.home_color, color2: f.home_color2 ?? "#ffffff" }}
        away={{ id: f.away_club_id, name: f.away_name, short: short(f.away_name, f.away_short), color: f.away_color, color2: f.away_color2 ?? "#ffffff" }}
        finalScore={[f.result_home, f.result_away]} events={events} momentum={momentum}
      />
      <p className="text-center text-[11px] text-faint">Motor {f.simulation_version} · seed reprodutível · hash {String(f.input_hash).slice(0, 10)}…</p>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle icon={<BarChart3 />}>Estatísticas</CardTitle>
          <div className="mb-3 flex items-center justify-between">
            <Crest id={f.home_club_id} name={f.home_name} short={f.home_short} color={f.home_color} color2={f.home_color2} size={26} />
            <Crest id={f.away_club_id} name={f.away_name} short={f.away_short} color={f.away_color} color2={f.away_color2} size={26} />
          </div>
          <ul className="space-y-3.5 text-sm">
            {STAT_ROWS.map(([k, label, fmt], i) => {
              const h = Number(ts.home?.[k] ?? 0), a = Number(ts.away?.[k] ?? 0);
              const total = h + a || 1;
              return (
                <li key={k}>
                  <div className="flex items-baseline justify-between tabular">
                    <span className={cn("font-display text-lg font-bold", h > a && "text-ink", h < a && "text-muted")}>{fmt(h)}</span>
                    <span className="text-xs font-semibold text-muted">{label}</span>
                    <span className={cn("font-display text-lg font-bold", a > h && "text-ink", a < h && "text-muted")}>{fmt(a)}</span>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-1">
                    <div className="flex h-1.5 justify-end overflow-hidden rounded-full bg-line"><Bar pct={(h / total) * 100} delay={i * 0.03} className="h-full rounded-full" style={{ background: f.home_color }} /></div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line"><Bar pct={(a / total) * 100} delay={i * 0.03} className="h-full rounded-full" style={{ background: f.away_color }} /></div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <CardTitle icon={<Star />}>Notas dos jogadores</CardTitle>
          {motm && (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/[.07] p-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-ink"><Star className="size-5 fill-current" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-accent">Homem do jogo</p>
                <Link href={`/g/${gameId}/players/${motm.game_player_id}`} className="block truncate font-display text-xl font-bold uppercase hover:text-accent">{motm.name_snapshot}</Link>
              </div>
              <span className={cn("rounded-lg px-2 py-0.5 font-display text-2xl font-extrabold tabular", ratingTone(Number(motm.rating)))}>{motm.rating}</span>
            </div>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            {(["home", "away"] as const).map((s) => (
              <div key={s}>
                <p className="mb-2 flex items-center gap-2 text-sm font-bold">
                  <Crest id={s === "home" ? f.home_club_id : f.away_club_id} name={s === "home" ? f.home_name : f.away_name} short={s === "home" ? f.home_short : f.away_short}
                    color={s === "home" ? f.home_color : f.away_color} color2={s === "home" ? f.home_color2 : f.away_color2} size={20} />
                  <span className="truncate">{s === "home" ? f.home_name : f.away_name}</span>
                </p>
                <ul className="space-y-0.5 text-xs">
                  {m.stats.filter((p) => side(p.club_id) === s).map((p) => (
                    <li key={p.game_player_id} className={cn("flex items-center gap-1.5 rounded-lg px-1.5 py-1 hover:bg-surface-2", !p.started && "opacity-75")}>
                      <PosPill group={p.position_group} className="min-w-7 text-[10px]" />
                      <Link href={`/g/${gameId}/players/${p.game_player_id}`} className="flex-1 truncate font-medium hover:text-accent">{p.name_snapshot}{!p.started && <span className="text-faint"> (s)</span>}</Link>
                      <span className="text-faint tabular">{p.minutes}&apos;</span>
                      {p.goals > 0 && <span title="golos" className="font-bold">⚽{p.goals > 1 ? p.goals : ""}</span>}
                      {p.assists > 0 && <span title="assistências" className="font-bold text-info">A{p.assists > 1 ? p.assists : ""}</span>}
                      <span className={cn("w-9 rounded-md py-px text-center font-display text-sm font-bold tabular", p.rating ? ratingTone(Number(p.rating)) : "text-faint")}>{p.rating ?? "—"}</span>
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
