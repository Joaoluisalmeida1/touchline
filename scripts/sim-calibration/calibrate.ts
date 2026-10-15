/**
 * Offline calibration suite (NOT part of CI). Default 100 000 matches, stratified.
 *   npm run sim:calibrate -- [N]          → reports/calibration-<engine>.json + .html
 * Reference ranges are approximate public averages for top European leagues (~2.5–3.1 goals, 20–30% draws);
 * they are sanity bands, not targets to overfit.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createRng } from "../../src/engine/common/rng";
import type { Tactics } from "../../src/engine/common/types";
import { ENGINE_VERSION } from "../../src/engine/match/config";
import { simulateMatch } from "../../src/engine/match/engine";
import { syntheticTeam } from "../../src/engine/match/fixtures";

const N = Number(process.argv[2] ?? 100_000);
const rng = createRng("calibration");
const diffs = [0, 2, 4, 6, 8, 10, 15];
const tacticSets: Record<string, Partial<Tactics>> = {
  balanced: {},
  high_press: { pressing: "high", defensive_line: "high" },
  low_block: { pressing: "low", defensive_line: "low", mentality: "defensive" },
  attacking: { mentality: "attacking", tempo: "high" },
  counter: { transitions: "counter", passing_directness: "direct" },
  possession: { transitions: "possession", passing_directness: "short", tempo: "slow" },
};
const tacticKeys = Object.keys(tacticSets);

type Agg = { n: number; hw: number; d: number; aw: number; hg: number; ag: number; zz: number; g3: number; g5: number; oneNil: number };
const mk = (): Agg => ({ n: 0, hw: 0, d: 0, aw: 0, hg: 0, ag: 0, zz: 0, g3: 0, g5: 0, oneNil: 0 });
const add = (a: Agg, h: number, w: number) => {
  a.n++; a.hg += h; a.ag += w;
  if (h > w) a.hw++; else if (h === w) a.d++; else a.aw++;
  if (h + w === 0) a.zz++;
  if (h + w >= 3) a.g3++;
  if (h + w >= 5) a.g5++;
  if ((h === 1 && w === 0) || (h === 0 && w === 1)) a.oneNil++;
};

const overall = mk();
const byDiff = new Map<number, Agg>(diffs.map((d) => [d, mk()]));
const neutral = mk();
const tactics = new Map<string, { n: number; pts: number; gf: number; ga: number; stamina: number }>();
for (const k of tacticKeys) tactics.set(k, { n: 0, pts: 0, gf: 0, ga: 0, stamina: 0 });
const redCard = { n: 0, ptsWith10: 0 };
const fatigue = { n: 0, ptsTired: 0 };
const xgBins = new Map<number, { shots: number; goals: number; xg: number }>();
let shots = 0, sot = 0, xg = 0, cards = 0, reds = 0, corners = 0, fouls = 0, pens = 0;

const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const d = diffs[i % diffs.length];
  const base = 66 + rng.int(0, 14);
  const strongHome = i % 2 === 0;
  const hOvr = strongHome ? base + d : base;
  const aOvr = strongHome ? base : base + d;
  const kind = i % 10;
  let homeTactics: Partial<Tactics> = {};
  let tKey: string | null = null;
  if (kind === 1 || kind === 2) {
    tKey = tacticKeys[Math.floor(i / 10) % tacticKeys.length];
    homeTactics = tacticSets[tKey];
  }
  const tiredAway = kind === 3;
  const neutralVenue = kind === 4;
  const r = simulateMatch({
    fixture_id: `c${i}`,
    neutral_venue: neutralVenue,
    home: syntheticTeam("H", tKey ? base : hOvr, { tactics: homeTactics, spread: 2 }),
    away: syntheticTeam("A", tKey ? base : aOvr, { spread: 2, fitness: tiredAway ? 72 : 100 }),
  }, `cal-${i}`);
  const h = r.home_goals, a = r.away_goals;
  add(overall, h, a);
  if (!tKey && !tiredAway) add(byDiff.get(d)!, strongHome ? h : a, strongHome ? a : h);
  if (neutralVenue && d === 0) add(neutral, h, a);
  if (tKey) {
    const t = tactics.get(tKey)!;
    t.n++; t.gf += h; t.ga += a; t.pts += h > a ? 3 : h === a ? 1 : 0;
    t.stamina += r.player_stats.filter((p) => p.side === "home" && p.started).reduce((s, p) => s + p.stamina_end, 0) / 11;
  }
  if (tiredAway && d === 0) { fatigue.n++; fatigue.ptsTired += a > h ? 3 : a === h ? 1 : 0; }
  const homeRed = r.events.find((e) => (e.event_type === "red_card" || e.event_type === "second_yellow") && e.side === "home" && e.minute < 60);
  if (homeRed && d === 0 && !tKey) { redCard.n++; redCard.ptsWith10 += h > a ? 3 : h === a ? 1 : 0; }
  for (const s of [r.team_stats.home, r.team_stats.away]) {
    shots += s.shots; sot += s.shots_on_target; xg += s.xg; cards += s.yellow_cards; reds += s.red_cards; corners += s.corners; fouls += s.fouls;
  }
  pens += r.events.filter((e) => e.event_type === "penalty_awarded").length;
  for (const e of r.events) {
    const x = e.payload?.xg as number | undefined;
    if (x === undefined) continue;
    const bin = Math.min(9, Math.floor(x * 10));
    const b = xgBins.get(bin) ?? { shots: 0, goals: 0, xg: 0 };
    b.shots++; b.xg += x; if (e.event_type === "goal") b.goals++;
    xgBins.set(bin, b);
  }
  if (i > 0 && i % 20000 === 0) console.log(`${i}/${N} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const pct = (x: number, n: number) => Math.round((1000 * x) / Math.max(1, n)) / 10;
const sum = (a: Agg) => ({
  matches: a.n, goals_per_match: +((a.hg + a.ag) / a.n).toFixed(2), first_side_win_pct: pct(a.hw, a.n), draw_pct: pct(a.d, a.n),
  second_side_win_pct: pct(a.aw, a.n), zero_zero_pct: pct(a.zz, a.n), one_nil_pct: pct(a.oneNil, a.n), three_plus_pct: pct(a.g3, a.n), five_plus_pct: pct(a.g5, a.n),
});
const report = {
  engine_version: ENGINE_VERSION,
  generated_at: new Date().toISOString(),
  matches: N,
  seconds: Math.round((Date.now() - t0) / 1000),
  reference_bands: { goals_per_match: [2.5, 3.1], draw_pct: [20, 30], note: "approximate public averages, top European leagues; sanity bands only" },
  overall: sum(overall),
  per_team: {
    shots: +(shots / N / 2).toFixed(2), shots_on_target: +(sot / N / 2).toFixed(2), xg: +(xg / N / 2).toFixed(3),
    yellow: +(cards / N / 2).toFixed(2), corners: +(corners / N / 2).toFixed(2), fouls: +(fouls / N / 2).toFixed(2),
  },
  per_match: { red_cards: +(reds / N).toFixed(3), penalties: +(pens / N).toFixed(3) },
  by_strength_gap_stronger_side_first: Object.fromEntries([...byDiff].map(([d, a]) => [`+${d}`, sum(a)])),
  neutral_equal_teams: sum(neutral),
  tactics_vs_balanced_equal_strength: Object.fromEntries([...tactics].map(([k, t]) => [k, { n: t.n, ppg: +(t.pts / t.n).toFixed(3), gf: +(t.gf / t.n).toFixed(2), ga: +(t.ga / t.n).toFixed(2), avg_stamina_end: +(t.stamina / t.n).toFixed(1) }])),
  red_card_before_60_ppg: redCard.n ? +(redCard.ptsWith10 / redCard.n).toFixed(3) : null,
  red_card_sample: redCard.n,
  tired_away_ppg_at_fitness_72: fatigue.n ? +(fatigue.ptsTired / fatigue.n).toFixed(3) : null,
  xg_calibration: [...xgBins].sort((a, b) => a[0] - b[0]).map(([bin, b]) => ({ bin: `${bin / 10}-${(bin + 1) / 10}`, shots: b.shots, mean_xg: +(b.xg / b.shots).toFixed(3), conversion: +(b.goals / b.shots).toFixed(3) })),
};

mkdirSync("reports", { recursive: true });
const base = `reports/calibration-${ENGINE_VERSION}`;
writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
const rows = (obj: Record<string, unknown>) => Object.entries(obj).map(([k, v]) => `<tr><th>${k}</th><td><pre>${JSON.stringify(v, null, 1)}</pre></td></tr>`).join("");
writeFileSync(`${base}.html`, `<!doctype html><meta charset="utf-8"><title>Calibration ${ENGINE_VERSION}</title>
<style>body{font:14px system-ui;background:#0a101c;color:#e7eef8;max-width:1000px;margin:auto;padding:24px}th{text-align:left;vertical-align:top;padding:8px;color:#8ea3c2;width:260px}td{padding:8px;border-bottom:1px solid #22304d}pre{margin:0;white-space:pre-wrap}</style>
<h1>Match engine calibration — ${ENGINE_VERSION}</h1><p>${N} simulated matches, ${report.seconds}s. Synthetic teams (fictional).</p><table>${rows(report as unknown as Record<string, unknown>)}</table>`);
console.log(JSON.stringify({ overall: report.overall, by_gap: report.by_strength_gap_stronger_side_first, tactics: report.tactics_vs_balanced_equal_strength, red: report.red_card_before_60_ppg, tired: report.tired_away_ppg_at_fitness_72 }, null, 1));
console.log(`written ${base}.json/.html`);
