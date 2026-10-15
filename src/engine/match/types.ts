import type { Formation, PlayerProfile, PositionGroup, Slot, Tactics } from "../common/types";

export interface MatchPlayerInput {
  id: string;
  name: string;
  position_group: PositionGroup;
  position_detail?: string | null;
  slot?: Slot; // starters only
  ovr: number; // 1..99 structural ability
  profile?: Partial<PlayerProfile>;
  fitness: number; // 0..100 at kickoff
  form: number; // -3..3
  morale: number; // 0..100
  sharpness: number; // 0..100
}

export interface MatchTeamInput {
  club_id: string;
  name: string;
  formation: Formation;
  tactics: Tactics;
  starters: MatchPlayerInput[];
  bench: MatchPlayerInput[];
}

export interface MatchInput {
  fixture_id: string;
  home: MatchTeamInput;
  away: MatchTeamInput;
  neutral_venue?: boolean;
}

export type EventType =
  | "kickoff" | "half_time" | "full_time" | "goal" | "own_goal" | "shot_saved" | "shot_off_target"
  | "shot_blocked" | "penalty_awarded" | "penalty_missed" | "corner" | "foul" | "yellow_card"
  | "second_yellow" | "red_card" | "substitution" | "injury" | "offside";

export interface MatchEvent {
  sequence_number: number;
  minute: number;
  second: number;
  side: "home" | "away";
  club_id: string;
  player_id: string | null;
  related_player_id: string | null;
  event_type: EventType;
  payload: Record<string, unknown>;
}

export interface PlayerMatchStats {
  player_id: string;
  club_id: string;
  side: "home" | "away";
  started: boolean;
  minutes: number;
  rating: number | null;
  goals: number;
  own_goals: number;
  assists: number;
  shots: number;
  shots_on_target: number;
  xg: number;
  passes_attempted: number;
  passes_completed: number;
  tackles: number;
  interceptions: number;
  saves: number;
  fouls: number;
  cards_yellow: number;
  cards_red: number;
  clean_sheet: boolean;
  goals_conceded_on_pitch: number;
  stamina_end: number;
  injury: { matches: number; type: string } | null;
}

export interface TeamMatchStats {
  goals: number;
  possession_pct: number;
  shots: number;
  shots_on_target: number;
  xg: number;
  big_chances: number;
  corners: number;
  fouls: number;
  yellow_cards: number;
  red_cards: number;
  offsides: number;
  passes_attempted: number;
  passes_completed: number;
  tackles: number;
  interceptions: number;
  saves: number;
  possessions: number;
}

export interface MatchResult {
  engine_version: string;
  seed: string;
  home_goals: number;
  away_goals: number;
  team_stats: { home: TeamMatchStats; away: TeamMatchStats };
  events: MatchEvent[];
  player_stats: PlayerMatchStats[];
  /** momentum per 5-minute bucket, -1..1 (positive = home pressure). For UI only. */
  momentum: number[];
  duration_seconds: number;
}
