/** Post-match analysis drawn from the stored event stream: xG race (cumulative xG by minute) and the best chances. */
const SHOT_TYPES = new Set(["goal", "shot_saved", "shot_blocked", "shot_off_target", "penalty_missed"]);

export interface AnEvent { minute: number; type: string; side: "home" | "away"; player: string | null; xg: number | null }

const OUTCOME: Record<string, string> = { goal: "Golo", shot_saved: "Defendido", shot_blocked: "Bloqueado", shot_off_target: "Ao lado", penalty_missed: "Penálti falhado" };

export function MatchAnalysis({ events, home, away }: { events: AnEvent[]; home: { short: string; color: string }; away: { short: string; color: string } }) {
  const shots = events.filter((e) => SHOT_TYPES.has(e.type) && typeof e.xg === "number").sort((a, b) => a.minute - b.minute);
  if (!shots.length) return <p className="text-sm text-muted">Sem remates registados.</p>;
  const end = Math.max(90, ...events.map((e) => e.minute));
  const w = 640, h = 180, padL = 30, padR = 12, padT = 12, padB = 24;
  const totals = { home: 0, away: 0 };
  const series = { home: [[0, 0]] as [number, number][], away: [[0, 0]] as [number, number][] };
  const goalDots: { x: number; v: number; s: AnEvent }[] = [];
  for (const s of shots) {
    totals[s.side] += s.xg!;
    series[s.side].push([s.minute, totals[s.side]]);
    if (s.type === "goal") goalDots.push({ x: s.minute, v: totals[s.side], s });
  }
  series.home.push([end, totals.home]);
  series.away.push([end, totals.away]);
  const max = Math.max(1, Math.ceil(Math.max(totals.home, totals.away) * 2) / 2);
  const X = (m: number) => padL + (m / end) * (w - padL - padR);
  const Y = (v: number) => h - padB - (v / max) * (h - padT - padB);
  const path = (pts: [number, number][]) => pts.map(([m, v], i) => (i === 0 ? `M${X(m)} ${Y(v)}` : `H${X(m)} V${Y(v)}`)).join(" ");
  const ticks = Array.from({ length: Math.floor(max / 0.5) + 1 }, (_, i) => i * 0.5);
  const best = [...shots].sort((a, b) => b.xg! - a.xg!).slice(0, 6);
  const colorOf = (c: string) => (/^#0{3,6}$/.test(c) ? "#9aa3ad" : c);
  return (
    <div className="space-y-4">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-48 w-full" role="img" aria-label={`xG acumulado: ${home.short} ${totals.home.toFixed(2)}, ${away.short} ${totals.away.toFixed(2)}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} stroke="#232931" strokeDasharray="3 5" />
            <text x={4} y={Y(t) + 4} fontSize="10" fontWeight="700" fill="#5d6772">{t.toFixed(1)}</text>
          </g>
        ))}
        {[0, 45, 90].map((m) => <text key={m} x={X(m)} y={h - 6} fontSize="10" textAnchor="middle" fill="#5d6772">{m}&apos;</text>)}
        <line x1={X(45)} x2={X(45)} y1={padT} y2={h - padB} stroke="#343c47" strokeDasharray="2 3" />
        <path d={path(series.home)} fill="none" stroke={colorOf(home.color)} strokeWidth="2.5" />
        <path d={path(series.away)} fill="none" stroke={colorOf(away.color)} strokeWidth="2.5" />
        {goalDots.map(({ x, v, s }, i) => (
          <circle key={i} cx={X(x)} cy={Y(v)} r="5" fill="#d4ff3a" stroke="#07090b" strokeWidth="2">
            <title>{`${s.minute}' golo de ${s.player ?? "?"} (xG ${s.xg!.toFixed(2)})`}</title>
          </circle>
        ))}
        <text x={X(end) - 4} y={Y(totals.home) - 6} textAnchor="end" fontSize="11" fontWeight="700" fill={colorOf(home.color)}>{home.short} {totals.home.toFixed(2)}</text>
        <text x={X(end) - 4} y={Y(totals.away) + 14} textAnchor="end" fontSize="11" fontWeight="700" fill={colorOf(away.color)}>{away.short} {totals.away.toFixed(2)}</text>
      </svg>
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-faint">Melhores oportunidades</p>
        <ul className="space-y-1 text-sm">
          {best.map((s, i) => (
            <li key={i} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-surface-2">
              <span className="w-8 font-display font-bold text-faint tabular">{s.minute}&apos;</span>
              <span className="size-2 rounded-full" style={{ background: colorOf(s.side === "home" ? home.color : away.color) }} aria-hidden />
              <span className="flex-1 truncate font-medium">{s.player ?? "—"}</span>
              <span className={s.type === "goal" ? "text-xs font-bold text-accent" : "text-xs text-muted"}>{OUTCOME[s.type]}</span>
              <span className="w-12 text-right font-display font-bold tabular">{s.xg!.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
