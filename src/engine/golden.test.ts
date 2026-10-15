/**
 * Golden-master tests: fixed inputs + seeds must keep producing byte-identical output for a given algorithm version.
 * This is what makes `seed + engine_version + input_hash` a reproducibility guarantee rather than a hope.
 *
 * Each test name carries the version constant(s), so the snapshot is keyed by version:
 *  - output changed, version unchanged  -> snapshot mismatch: either a bug, or you forgot to bump the version.
 *  - intentional change                 -> bump the version (docs/game-balance.md), run `npx vitest run -u src/engine/golden.test.ts`,
 *                                          and commit the new snapshot. Never update a hash under an unchanged version.
 */
import { describe, expect, it } from "vitest";
import { hashInput } from "./common/hash";
import { createRng } from "./common/rng";
import { ECONOMY_VERSION } from "./economy/economy";
import { simulateSeasons } from "./league/simulate";
import { ENGINE_VERSION } from "./match/config";
import { simulateMatch } from "./match/engine";
import { syntheticTeam } from "./match/fixtures";
import { PROGRESSION_VERSION } from "./progression/progression";
import { calibrate, derivePlayer, INITIAL_RATING_VERSION, type EloAnchors, type RatingInputPlayer } from "./rating/initial-rating";

describe("golden master", () => {
  it(`match engine @ ${ENGINE_VERSION}`, () => {
    const cases = [
      { seed: "golden-1", home: 75, away: 75 },
      { seed: "golden-2", home: 82, away: 68 },
      { seed: "golden-3", home: 64, away: 79 },
    ];
    const results = cases.map((c) =>
      simulateMatch({ fixture_id: `fx-${c.seed}`, home: syntheticTeam("H", c.home), away: syntheticTeam("A", c.away) }, c.seed));
    expect(results.map((r) => `${r.home_goals}-${r.away_goals}`)).toMatchSnapshot("scores");
    expect(hashInput(results)).toMatchSnapshot("full output hash");
  });

  it(`initial rating @ ${INITIAL_RATING_VERSION}`, () => {
    const rng = createRng("golden-rating");
    const groups = ["GK", "DEF", "MID", "ATT"] as const;
    const players: RatingInputPlayer[] = Array.from({ length: 400 }, (_, i) => ({
      key: `p${i}`, position_group: groups[i % 4], elo: rng.normal(1600, 160), ear_180: rng.normal(0, 3),
      total_minutes: rng.int(200, 3200), games_played: null, age: i % 5 === 0 ? null : rng.int(17, 35), league_key: `l${i % 3}`,
      market_value_eur: i % 7 === 0 ? null : Math.round(Math.exp(15 + rng.normal(0, 1))),
    }));
    const anchors: EloAnchors = {
      source: "playerelo_global_ranking", fetched_at: "2026-10-15T00:00:00Z",
      points: [1, 10, 100, 1000, 5000, 20000, 50000].map((rank) => ({ rank, elo: 2600 - 140 * Math.log(rank) })),
    };
    const params = calibrate(players, anchors);
    const derived = players.map((p) => derivePlayer(p, params, "golden-snapshot"));
    expect(hashInput({ params, derived })).toMatchSnapshot("full output hash");
  });

  it(`one league season @ ${ENGINE_VERSION} + ${PROGRESSION_VERSION} + ${ECONOMY_VERSION} + ${INITIAL_RATING_VERSION}`, () => {
    const { reports, league } = simulateSeasons("golden-league", 1);
    const summary = { avgGoals: reports[0].avgGoals.toFixed(4), drawRate: reports[0].drawRate.toFixed(4), avgOvr: reports[0].avgOvr.toFixed(4) };
    expect(summary).toMatchSnapshot("season summary");
    expect(hashInput({ reports, players: league.players, cash: Object.fromEntries(league.cash) })).toMatchSnapshot("full output hash");
  });
});
