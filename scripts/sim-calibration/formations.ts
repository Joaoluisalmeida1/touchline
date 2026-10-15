/**
 * Formation & role balance check (offline, not CI).
 *   npx tsx scripts/sim-calibration/formations.ts [matchesPerPair]
 * Equal-strength synthetic teams. Reports points-per-game of every formation in a full round robin,
 * and the PPG change of each non-default role vs the neutral role in the same slot.
 */
import { FORMATIONS, type Formation, type Slot } from "../../src/engine/common/types";
import { FORMATION_SLOTS } from "../../src/engine/lineup/formations";
import { DEFAULT_ROLE, ROLES } from "../../src/engine/lineup/roles";
import { simulateMatch } from "../../src/engine/match/engine";
import { syntheticTeam } from "../../src/engine/match/fixtures";
import type { MatchTeamInput } from "../../src/engine/match/types";

const PER_PAIR = Number(process.argv[2] ?? 120);
const OVR = 72;

type Agg = { n: number; pts: number; gf: number; ga: number };
const mk = (): Agg => ({ n: 0, pts: 0, gf: 0, ga: 0 });
const add = (a: Agg, gf: number, ga: number) => { a.n++; a.gf += gf; a.ga += ga; a.pts += gf > ga ? 3 : gf === ga ? 1 : 0; };

const t0 = Date.now();
const byF = new Map<Formation, Agg>(FORMATIONS.map((f) => [f, mk()]));
let seq = 0;
for (let i = 0; i < FORMATIONS.length; i++) {
  for (let j = i + 1; j < FORMATIONS.length; j++) {
    const a = FORMATIONS[i], b = FORMATIONS[j];
    for (let k = 0; k < PER_PAIR; k++) {
      const aHome = k % 2 === 0;
      const ta = syntheticTeam("A", OVR, { formation: a });
      const tb = syntheticTeam("B", OVR, { formation: b });
      const r = simulateMatch({ fixture_id: `f${seq}`, home: aHome ? ta : tb, away: aHome ? tb : ta }, `form-${seq++}`);
      const ga = aHome ? r.home_goals : r.away_goals, gb = aHome ? r.away_goals : r.home_goals;
      add(byF.get(a)!, ga, gb);
      add(byF.get(b)!, gb, ga);
    }
  }
}
console.log(`\nFormation round robin (${PER_PAIR} matches/pair, ${seq} matches, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
const rows = [...byF.entries()].map(([f, a]) => ({ formation: f, ppg: +(a.pts / a.n).toFixed(3), gf: +(a.gf / a.n).toFixed(2), ga: +(a.ga / a.n).toFixed(2) }))
  .sort((x, y) => y.ppg - x.ppg);
console.table(rows);

// ---------------- roles ----------------
const ROLE_N = Number(process.argv[3] ?? 3000);
function withRole(team: MatchTeamInput, slot: Slot, role: string): MatchTeamInput {
  let done = false;
  return { ...team, starters: team.starters.map((p) => (!done && p.slot === slot ? ((done = true), { ...p, role }) : p)) };
}
const formationFor = (slot: Slot): Formation =>
  (FORMATIONS.find((f) => FORMATION_SLOTS[f].includes(slot)) ?? "4-3-3");
const roleRows: { role: string; slot: Slot; ppg_delta: number; gf: number; ga: number }[] = [];
for (const r of ROLES) {
  const slot = r.slots[0];
  if (DEFAULT_ROLE[slot] === r.id) continue;
  const f = formationFor(slot);
  const base = mk(), test = mk();
  for (let k = 0; k < ROLE_N; k++) {
    const home = k % 2 === 0;
    const opp = syntheticTeam("O", OVR, { formation: "4-3-3" });
    for (const [agg, team] of [[base, syntheticTeam("T", OVR, { formation: f })], [test, withRole(syntheticTeam("T", OVR, { formation: f }), slot, r.id)]] as const) {
      const res = simulateMatch({ fixture_id: `r${k}`, home: home ? team : opp, away: home ? opp : team }, `role-${r.id}-${k}`);
      const gf = home ? res.home_goals : res.away_goals, ga = home ? res.away_goals : res.home_goals;
      add(agg, gf, ga);
    }
  }
  roleRows.push({ role: r.id, slot, ppg_delta: +((test.pts - base.pts) / ROLE_N).toFixed(3), gf: +((test.gf - base.gf) / ROLE_N).toFixed(3), ga: +((test.ga - base.ga) / ROLE_N).toFixed(3) });
}
console.log(`\nRole effect vs neutral role (${ROLE_N} paired matches each; same seeds → paired comparison)`);
console.table(roleRows);
