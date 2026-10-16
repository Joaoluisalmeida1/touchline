/** Inputs/outputs of the narrative generator (pure, deterministic: same facts + seed => same newspaper). */
import type { PositionGroup } from "../common/types";

export const NARRATIVE_VERSION = "narrative-v1";

export interface NClub {
  id: string;
  name: string;
  short: string;
  strength: number;
  /** display name of the human manager, null for AI */
  manager: string | null;
}

export interface NGoal {
  minute: number;
  club_id: string;
  scorer_id: string | null;
  scorer: string | null;
  assist: string | null;
  xg: number | null;
  own_goal: boolean;
  penalty: boolean;
}

export interface NMatch {
  fixture_id: string;
  home_id: string;
  away_id: string;
  home_goals: number;
  away_goals: number;
  home_xg: number;
  away_xg: number;
  goals: NGoal[];
  reds: { club_id: string; player: string | null; minute: number }[];
}

export interface NPlayerLine {
  id: string;
  name: string;
  club_id: string;
  group: PositionGroup;
  rating: number | null;
  goals: number;
  assists: number;
  minutes: number;
}

export interface NTableRow { club_id: string; points: number }

/** All-time head-to-head between two human-managed clubs, including this round. */
export interface NHeadToHead { a: string; b: string; a_wins: number; b_wins: number; draws: number }

export interface RoundFacts {
  game_id: string;
  season: number;
  round: number;
  total_rounds: number;
  clubs: NClub[];
  matches: NMatch[];
  players: NPlayerLine[];
  /** sorted standings (best first) before and after this round; empty "before" on round 1 */
  table_before: NTableRow[];
  table_after: NTableRow[];
  head_to_head: NHeadToHead[];
}

export type StoryKind =
  | "derby" | "upset" | "thrashing" | "hat_trick" | "comeback" | "late_winner" | "new_leader" | "red_card"
  | "goal_fest" | "human_result" | "title_race";

export interface Story {
  kind: StoryKind;
  rank: number;
  score: number;
  headline: string;
  body: string;
  fixture_id: string | null;
  club_ids: string[];
  player_ids: string[];
}

/** A fact appended to the game's event log (read later by history, achievements, rumours…). */
export interface Fact {
  kind: string;
  /** unique per (game, season, round, kind) */
  key: string;
  club_id: string | null;
  player_id: string | null;
  payload: Record<string, unknown>;
}

export interface AwardPlayer { id: string; name: string; club_id: string; group: PositionGroup; rating: number; goals: number; assists: number }

export interface RoundAwards {
  team: AwardPlayer[];
  player: AwardPlayer | null;
  goal: { fixture_id: string; minute: number; scorer: string; club_id: string; xg: number } | null;
}

export interface Edition {
  version: string;
  stories: Story[];
  facts: Fact[];
  awards: RoundAwards;
}
