/** Quick sanity calibration: npx tsx scripts/sim-calibration/quick.ts [N] [homeOvr] [awayOvr] */
import { simulateMatch } from "../../src/engine/match/engine";
import { syntheticTeam } from "../../src/engine/match/fixtures";

const N = Number(process.argv[2] ?? 2000);
const a = Number(process.argv[3] ?? 75);
const b = Number(process.argv[4] ?? 75);
let hg = 0, ag = 0, hw = 0, d = 0, aw = 0, shots = 0, sot = 0, xg = 0, corners = 0, fouls = 0, yel = 0, red = 0;
let poss = 0, pass = 0, passc = 0, off = 0, zz = 0, inj = 0, subs = 0, pens = 0;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  const r = simulateMatch({ fixture_id: "f" + i, home: syntheticTeam("H", a), away: syntheticTeam("A", b) }, "seed" + i);
  hg += r.home_goals;
  ag += r.away_goals;
  if (r.home_goals > r.away_goals) hw++;
  else if (r.home_goals === r.away_goals) d++;
  else aw++;
  if (r.home_goals + r.away_goals === 0) zz++;
  for (const s of [r.team_stats.home, r.team_stats.away]) {
    shots += s.shots; sot += s.shots_on_target; xg += s.xg; corners += s.corners; fouls += s.fouls;
    yel += s.yellow_cards; red += s.red_cards; pass += s.passes_attempted; passc += s.passes_completed; off += s.offsides;
  }
  poss += r.team_stats.home.possession_pct;
  inj += r.events.filter((e) => e.event_type === "injury").length;
  subs += r.events.filter((e) => e.event_type === "substitution").length;
  pens += r.events.filter((e) => e.event_type === "penalty_awarded").length;
}
const f = (x: number) => (x / N).toFixed(2);
const t = (x: number) => (x / N / 2).toFixed(1);
console.log({
  ms_per_match: ((Date.now() - t0) / N).toFixed(2), goals: f(hg + ag), home: f(hg), away: f(ag), homeWin: f(hw), draw: f(d),
  awayWin: f(aw), zeroZero: f(zz), shotsPerTeam: t(shots), sotPerTeam: t(sot), xgPerTeam: (xg / N / 2).toFixed(2),
  goalsPerXg: ((hg + ag) / xg).toFixed(2), cornersPerTeam: t(corners), foulsPerTeam: t(fouls), yellowPerTeam: (yel / N / 2).toFixed(2),
  redPerMatch: f(red), pensPerMatch: f(pens), homePoss: f(poss), passesPerTeam: (pass / N / 2).toFixed(0), passAcc: (passc / pass).toFixed(3),
  offsidesPerTeam: t(off), injuries: f(inj), subs: f(subs),
});
