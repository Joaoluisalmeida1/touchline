/**
 * Deterministic possession-based match engine.
 * Pure: (input, seed) -> result. No DB, no clock, no Math.random.
 * Every stat (goals, assists, xG, shots, cards, ratings) is derived from the same event stream.
 */
import { clamp, createRng, round1, round3, sigmoid } from "../common/rng";
import type { PlayerProfile, PositionGroup, Slot, Tactics } from "../common/types";
import { SLOT_GROUP, SLOT_SIDE, slotSuitability } from "../lineup/formations";
import { ENGINE_CONFIG as C, ENGINE_VERSION } from "./config";
import type {
  EventType, MatchEvent, MatchInput, MatchPlayerInput, MatchResult, MatchTeamInput, PlayerMatchStats, TeamMatchStats,
} from "./types";

type Side = "home" | "away";

const DEFAULT_PROFILE: Record<PositionGroup, PlayerProfile> = {
  GK: { attack: 5, defense: 40, creation: 25, physical: 60, keeper: 100, set_pieces: 10 },
  DEF: { attack: 30, defense: 85, creation: 40, physical: 70, keeper: 0, set_pieces: 35 },
  MID: { attack: 55, defense: 55, creation: 80, physical: 60, keeper: 0, set_pieces: 55 },
  ATT: { attack: 90, defense: 25, creation: 55, physical: 60, keeper: 0, set_pieces: 45 },
};

interface OnPitch {
  input: MatchPlayerInput;
  profile: PlayerProfile;
  slot: Slot;
  stamina: number;
  yellow: number;
  onPitch: boolean;
  wasOnPitch: boolean;
  started: boolean;
  minIn: number;
  minOut: number | null;
  stats: PlayerMatchStats;
}

interface Team {
  side: Side;
  dayForm: number;
  input: MatchTeamInput;
  tactics: Tactics;
  players: OnPitch[]; // everyone who could appear (starters + bench), in input order
  bench: OnPitch[];
  subsUsed: number;
  subWindowsUsed: number;
  attackingSubDone: boolean;
  goals: number;
  stats: TeamMatchStats;
  units: Units;
  possessionSeconds: number;
}

interface Units {
  control: number;
  attack: number;
  defense: number;
  keeper: number;
  n: number;
}

const emptyTeamStats = (): TeamMatchStats => ({
  goals: 0, possession_pct: 0, shots: 0, shots_on_target: 0, xg: 0, big_chances: 0, corners: 0, fouls: 0,
  yellow_cards: 0, red_cards: 0, offsides: 0, passes_attempted: 0, passes_completed: 0, tackles: 0,
  interceptions: 0, saves: 0, possessions: 0,
});

function profileOf(p: MatchPlayerInput): PlayerProfile {
  const d = DEFAULT_PROFILE[p.position_group];
  const src = p.profile ?? {};
  return {
    attack: src.attack ?? d.attack,
    defense: src.defense ?? d.defense,
    creation: src.creation ?? d.creation,
    physical: src.physical ?? d.physical,
    keeper: src.keeper ?? d.keeper,
    set_pieces: src.set_pieces ?? d.set_pieces,
  };
}

function makeStats(p: MatchPlayerInput, clubId: string, side: Side, started: boolean): PlayerMatchStats {
  return {
    player_id: p.id, club_id: clubId, side, started, minutes: 0, rating: null, goals: 0, own_goals: 0, assists: 0,
    shots: 0, shots_on_target: 0, xg: 0, passes_attempted: 0, passes_completed: 0, tackles: 0, interceptions: 0,
    saves: 0, fouls: 0, cards_yellow: 0, cards_red: 0, clean_sheet: false, goals_conceded_on_pitch: 0,
    stamina_end: p.fitness, injury: null,
  };
}

function buildTeam(input: MatchTeamInput, side: Side, dayForm: number): Team {
  const starters: OnPitch[] = input.starters.map((p) => ({
    input: p, profile: profileOf(p), slot: p.slot ?? "CM", stamina: clamp(p.fitness, 20, 100), yellow: 0,
    onPitch: true, wasOnPitch: true, started: true, minIn: 0, minOut: null, stats: makeStats(p, input.club_id, side, true),
  }));
  const bench: OnPitch[] = input.bench.map((p) => ({
    input: p, profile: profileOf(p), slot: p.slot ?? "CM", stamina: clamp(p.fitness, 20, 100), yellow: 0,
    onPitch: false, wasOnPitch: false, started: false, minIn: -1, minOut: null, stats: makeStats(p, input.club_id, side, false),
  }));
  const t: Team = {
    side, dayForm, input, tactics: input.tactics, players: [...starters, ...bench], bench, subsUsed: 0, subWindowsUsed: 0,
    attackingSubDone: false, goals: 0, stats: emptyTeamStats(), units: { control: 0, attack: 0, defense: 0, keeper: 0, n: 0 },
    possessionSeconds: 0,
  };
  t.units = computeUnits(t);
  return t;
}

const onPitch = (t: Team): OnPitch[] => t.players.filter((p) => p.onPitch);

/** Effective rating of a player right now (bounded modifiers, no double counting with profiles). */
function eff(p: OnPitch): number {
  const suit = slotSuitability(p.input.position_group, p.slot, p.input.position_detail);
  const staminaF = 1 - Math.max(0, 78 - p.stamina) * 0.0045;
  const formF = 1 + C.formEffect * clamp(p.input.form, -3, 3) / 3;
  const moraleF = 1 + C.moraleEffect * clamp((p.input.morale - 60) / 40, -1, 1);
  const sharpF = 0.97 + 0.03 * clamp(p.input.sharpness, 0, 100) / 100;
  return p.input.ovr * suit * staminaF * formF * moraleF * sharpF;
}

function weightedUnit(players: OnPitch[], lineWeights: Record<PositionGroup, number>, key: keyof PlayerProfile): number {
  let num = 0, den = 0;
  for (const p of players) {
    const lw = lineWeights[SLOT_GROUP[p.slot]];
    if (lw <= 0) continue;
    const w = lw * (0.5 + (p.profile[key] as number) / 100);
    num += w * eff(p);
    den += w;
  }
  return den > 0 ? num / den : 40;
}

function computeUnits(t: Team): Units {
  const ps = onPitch(t);
  const n = ps.length;
  const numbers = 1 - 0.075 * Math.max(0, 11 - n);
  const gk = ps.find((p) => p.slot === "GK");
  const d = t.dayForm;
  return {
    control: (weightedUnit(ps, { GK: 0.1, DEF: 0.35, MID: 1, ATT: 0.35 }, "creation") + d) * numbers,
    attack: (weightedUnit(ps, { GK: 0, DEF: 0.15, MID: 0.55, ATT: 1 }, "attack") + d) * numbers,
    defense: (weightedUnit(ps, { GK: 0.25, DEF: 1, MID: 0.45, ATT: 0.1 }, "defense") + d) * numbers,
    keeper: gk ? eff(gk) + d * 0.5 : 30,
    n,
  };
}

const mentalityLogit = (m: Tactics["mentality"]): number => (m === "attacking" ? 0.22 : m === "defensive" ? -0.24 : 0);

export function simulateMatch(input: MatchInput, seed: string): MatchResult {
  const rng = createRng(`${ENGINE_VERSION}|${seed}`);
  const home = buildTeam(input.home, "home", clamp(rng.normal(0, C.matchDayNoiseSd), -6, 6));
  const away = buildTeam(input.away, "away", clamp(rng.normal(0, C.matchDayNoiseSd), -6, 6));
  const teams: Record<Side, Team> = { home, away };
  const other = (s: Side): Side => (s === "home" ? "away" : "home");
  const events: MatchEvent[] = [];
  const momentum: number[] = new Array(20).fill(0);
  let seq = 0;
  let clock = 0; // seconds since kickoff (both halves continuous, 2700 = HT)

  const minuteOf = (sec: number): number => Math.floor(sec / 60);
  const emit = (side: Side, type: EventType, player: OnPitch | null, related: OnPitch | null, payload: Record<string, unknown> = {}, at = clock) => {
    events.push({
      sequence_number: ++seq, minute: Math.min(130, minuteOf(at)), second: Math.floor(at % 60), side,
      club_id: teams[side].input.club_id, player_id: player?.input.id ?? null, related_player_id: related?.input.id ?? null,
      event_type: type, payload,
    });
  };
  const bumpMomentum = (side: Side, v: number) => {
    const b = Math.min(momentum.length - 1, Math.floor(minuteOf(clock) / 5));
    momentum[b] = clamp(momentum[b] + (side === "home" ? v : -v), -1, 1);
  };

  emit("home", "kickoff", null, null, { home: input.home.name, away: input.away.name });

  const firstHalfEnd = 45 * 60 + rng.int(1, 4) * 60;
  const secondHalfStoppageBase = rng.int(2, 5);
  let half = 1;
  let possessionSide: Side = "home";
  let transitionFor: Side | null = null;
  let extraSecondHalf = 0;
  let lastStaminaTick = 0;

  const pickWeighted = (list: OnPitch[], w: (p: OnPitch) => number): OnPitch => rng.pickWeighted(list, w);

  const shooterWeight = (p: OnPitch, header: boolean): number => {
    const g = SLOT_GROUP[p.slot];
    let base = g === "ATT" ? 3.2 : p.slot === "AM" ? 2.2 : g === "MID" ? (p.slot === "DM" ? 0.5 : 1.1) : g === "DEF" ? (p.slot === "CB" ? (header ? 1.4 : 0.22) : 0.5) : 0;
    if (header && g === "ATT") base *= 1.1;
    return base * Math.pow(p.profile.attack / 60, header ? 0.6 : 1.4) * (eff(p) / 70);
  };
  const creatorWeight = (p: OnPitch, wide: boolean): number => {
    const g = SLOT_GROUP[p.slot];
    let base = g === "MID" ? 1.6 : g === "ATT" ? 1.2 : g === "DEF" ? 0.55 : 0.03;
    if (wide && SLOT_SIDE[p.slot] !== "C") base *= 2.2;
    return base * (p.profile.creation / 60) * (eff(p) / 70);
  };
  const defenderWeight = (p: OnPitch): number => {
    const g = SLOT_GROUP[p.slot];
    const base = g === "DEF" ? 1.5 : g === "MID" ? 1.1 : g === "ATT" ? 0.35 : 0.05;
    return base * (p.profile.defense / 60);
  };

  // ---------- passing volume ----------
  const recordPasses = (att: Team, def: Team, seconds: number, endedByTurnover: boolean) => {
    const style = att.tactics.passing_directness;
    const perPass = style === "short" ? 4.6 : style === "direct" ? 7.0 : 5.6;
    const n = Math.max(1, Math.round(seconds / perPass));
    const ps = onPitch(att);
    const ctrlDiff = (att.units.control - def.units.control) / C.ratingScale;
    let pComp = 0.9 + 0.03 * ctrlDiff + (style === "short" ? 0.045 : style === "direct" ? -0.07 : 0)
      + (def.tactics.pressing === "high" ? -0.025 : def.tactics.pressing === "low" ? 0.02 : 0);
    pComp = clamp(pComp, 0.62, 0.96);
    for (let i = 0; i < n; i++) {
      const p = pickWeighted(ps, (q) => (SLOT_GROUP[q.slot] === "MID" ? 1.4 : SLOT_GROUP[q.slot] === "DEF" ? 1.05 : SLOT_GROUP[q.slot] === "ATT" ? 0.6 : 0.3) * (q.profile.creation / 60));
      p.stats.passes_attempted++;
      const last = i === n - 1;
      if (last && endedByTurnover) continue; // the possession-losing pass
      // intermediate misplaced passes are treated as loose balls recovered by the same side
      if (rng.chance(last ? pComp : Math.min(0.97, pComp + 0.06))) p.stats.passes_completed++;
    }
  };

  // ---------- cards / injuries / subs ----------
  const sendOff = (t: Team, p: OnPitch) => {
    p.onPitch = false;
    p.minOut = minuteOf(clock);
    t.units = computeUnits(t);
    // if the keeper is sent off, sacrifice an outfield player for the bench GK when possible
    if (p.slot === "GK" && t.subsUsed < C.maxSubs) {
      const gk = t.bench.find((b) => !b.wasOnPitch && b.input.position_group === "GK");
      const victim = onPitch(t).filter((q) => SLOT_GROUP[q.slot] === "ATT" || SLOT_GROUP[q.slot] === "MID")
        .sort((a, b) => eff(a) - eff(b))[0];
      if (gk && victim) doSub(t, victim, gk, "GK", "keeper_sent_off");
    } else if (p.slot === "GK") {
      const stand = onPitch(t).sort((a, b) => eff(a) - eff(b))[0];
      if (stand) stand.slot = "GK";
      t.units = computeUnits(t);
    }
  };

  const doSub = (t: Team, out: OnPitch, inn: OnPitch, slot: Slot, reason: string) => {
    out.onPitch = false;
    out.minOut = minuteOf(clock);
    inn.onPitch = true;
    inn.wasOnPitch = true;
    inn.minIn = minuteOf(clock);
    inn.slot = slot;
    t.subsUsed++;
    emit(t.side, "substitution", inn, out, { reason, slot });
    t.units = computeUnits(t);
  };

  const bestBenchFor = (t: Team, slot: Slot): OnPitch | undefined => {
    const cands = t.bench.filter((b) => !b.wasOnPitch && (slot === "GK" ? b.input.position_group === "GK" : b.input.position_group !== "GK"));
    return cands.sort((a, b) =>
      b.input.ovr * slotSuitability(b.input.position_group, slot) - a.input.ovr * slotSuitability(a.input.position_group, slot)
      || (a.input.id < b.input.id ? -1 : 1))[0];
  };

  const maybeSubs = (t: Team) => {
    const minute = minuteOf(clock);
    if (t.subsUsed >= C.maxSubs) return;
    const windows = [58, 68, 78];
    const w = windows[t.subWindowsUsed];
    if (w === undefined || minute < w) return;
    t.subWindowsUsed++;
    let made = 0;
    const diff = t.goals - teams[other(t.side)].goals;
    // contextual attacking change when trailing late
    if (!t.attackingSubDone && diff < 0 && minute >= 65) {
      const out = onPitch(t).filter((p) => p.slot === "DM" || p.slot === "CB").sort((a, b) => eff(a) - eff(b))[0];
      const inn = t.bench.filter((b) => !b.wasOnPitch && b.input.position_group === "ATT").sort((a, b) => b.input.ovr - a.input.ovr)[0];
      if (out && inn && onPitch(t).filter((p) => SLOT_GROUP[p.slot] === "DEF").length > 3) {
        doSub(t, out, inn, "ST", "tactical_attacking");
        t.attackingSubDone = true;
        made++;
      }
    }
    const perWindow = [2, 2, 1][t.subWindowsUsed - 1] ?? 1;
    const tired = onPitch(t).filter((p) => p.slot !== "GK" && p.stamina < C.subStaminaThreshold).sort((a, b) => a.stamina - b.stamina);
    for (const p of tired) {
      if (made >= perWindow || t.subsUsed >= C.maxSubs) break;
      const inn = bestBenchFor(t, p.slot);
      if (!inn) break;
      doSub(t, p, inn, p.slot, "fatigue");
      made++;
    }
  };

  const injuryCheck = (t: Team, dtSeconds: number) => {
    for (const p of onPitch(t)) {
      const fatigueF = 1 + Math.max(0, 70 - p.stamina) / 30;
      if (!rng.chance((C.injuryPer90 * dtSeconds / 5400) * fatigueF)) continue;
      const r = rng.next();
      const injury = r < 0.65 ? { matches: rng.int(1, 2), type: "minor" } : r < 0.93 ? { matches: rng.int(3, 6), type: "moderate" } : { matches: rng.int(8, 20), type: "severe" };
      p.stats.injury = injury;
      emit(t.side, "injury", p, null, injury);
      const inn = bestBenchFor(t, p.slot);
      if (inn && t.subsUsed < C.maxSubs) doSub(t, p, inn, p.slot, "injury");
      else {
        p.onPitch = false;
        p.minOut = minuteOf(clock);
        t.units = computeUnits(t);
      }
    }
  };

  const drainStamina = (t: Team, dtSeconds: number) => {
    const base = C.staminaDrainPer90[t.tactics.pressing] * C.tempoDrainMult[t.tactics.tempo];
    for (const p of onPitch(t)) {
      const phys = 1.15 - p.profile.physical / 200; // physical 100 => 0.65x drain
      const gk = p.slot === "GK" ? 0.25 : 1;
      p.stamina = Math.max(0, p.stamina - base * phys * gk * dtSeconds / 5400);
    }
    t.units = computeUnits(t);
  };

  // ---------- foul ----------
  const foul = (def: Team, att: Team, inFinalThird: boolean): "penalty" | "freekick" | "none" => {
    // booked players are more careful
    const fouler = pickWeighted(onPitch(def), (p) => defenderWeight(p) * (p.yellow > 0 ? 0.4 : 1));
    const victim = pickWeighted(onPitch(att), (p) => (SLOT_GROUP[p.slot] === "ATT" ? 1.5 : 1));
    fouler.stats.fouls++;
    def.stats.fouls++;
    emit(def.side, "foul", fouler, victim, { in_final_third: inFinalThird });
    if (rng.chance(C.directRedPerFoul)) {
      fouler.stats.cards_red++;
      def.stats.red_cards++;
      emit(def.side, "red_card", fouler, null, { reason: "serious_foul" });
      sendOff(def, fouler);
    } else if (rng.chance(C.yellowPerFoul * (def.tactics.pressing === "high" ? 1.1 : 1) * (fouler.yellow > 0 ? 0.55 : 1))) {
      fouler.yellow++;
      fouler.stats.cards_yellow++;
      def.stats.yellow_cards++;
      if (fouler.yellow >= 2) {
        fouler.stats.cards_red++;
        def.stats.red_cards++;
        emit(def.side, "second_yellow", fouler, null, {});
        sendOff(def, fouler);
      } else emit(def.side, "yellow_card", fouler, null, {});
    }
    return inFinalThird ? "freekick" : "none";
  };

  // ---------- shot resolution ----------
  type ShotKind = "open_box" | "outside_box" | "header" | "one_on_one" | "corner_header" | "free_kick" | "penalty";
  const XG_BASE: Record<ShotKind, number> = {
    open_box: 0.13, outside_box: 0.035, header: 0.08, one_on_one: 0.33, corner_header: 0.055, free_kick: 0.06, penalty: 0.76,
  };
  const ASSIST_P: Record<ShotKind, number> = {
    open_box: 0.8, outside_box: 0.45, header: 0.95, one_on_one: 0.88, corner_header: 0.92, free_kick: 0, penalty: 0,
  };

  const shoot = (att: Team, def: Team, kind: ShotKind, presetShooter?: OnPitch) => {
    const ps = onPitch(att).filter((p) => p.slot !== "GK" || kind === "penalty");
    if (ps.length === 0) return;
    const header = kind === "header" || kind === "corner_header";
    const shooter = presetShooter ?? (kind === "penalty" || kind === "free_kick"
      ? ps.slice().sort((a, b) => b.profile.set_pieces + eff(b) - (a.profile.set_pieces + eff(a)))[0]
      : pickWeighted(ps, (p) => shooterWeight(p, header)));
    const keeper = onPitch(def).find((p) => p.slot === "GK");

    // own goal on crosses
    if ((kind === "header" || kind === "corner_header") && rng.chance(C.ownGoalPerCross)) {
      const og = pickWeighted(onPitch(def).filter((p) => p.slot !== "GK").length ? onPitch(def).filter((p) => p.slot !== "GK") : onPitch(def), defenderWeight);
      og.stats.own_goals++;
      att.goals++;
      att.stats.goals++;
      emit(att.side, "own_goal", og, null, { kind });
      bumpMomentum(att.side, 0.6);
      return;
    }

    let xg = XG_BASE[kind];
    if (kind !== "penalty") {
      xg *= Math.exp(rng.normal(0, 0.45));
      xg *= Math.exp(C.xgQualityPerPoint * clamp(eff(shooter) - def.units.defense, -15, 15) * 0.5);
    }
    xg = clamp(xg, 0.01, kind === "penalty" ? 0.8 : 0.85);
    const keeperEff = keeper ? eff(keeper) * (0.6 + keeper.profile.keeper / 250) : 25;
    const finishMult = Math.exp(C.finishingPerPoint * (eff(shooter) - 70) - C.keeperPerPoint * (keeperEff - 70));
    const pGoal = clamp(xg * finishMult, 0.005, 0.97);
    const big = xg >= 0.3;

    shooter.stats.shots++;
    shooter.stats.xg += xg;
    att.stats.shots++;
    att.stats.xg += xg;
    if (big) att.stats.big_chances++;
    bumpMomentum(att.side, 0.12 + xg);

    const isGoal = rng.chance(pGoal);
    const wide = kind === "header" || kind === "corner_header";
    const payload = { kind, xg: round3(xg), big_chance: big };
    if (isGoal) {
      shooter.stats.goals++;
      shooter.stats.shots_on_target++;
      att.stats.shots_on_target++;
      att.goals++;
      att.stats.goals++;
      let assister: OnPitch | null = null;
      if (rng.chance(ASSIST_P[kind])) {
        const mates = onPitch(att).filter((p) => p !== shooter);
        if (mates.length) {
          assister = kind === "corner_header"
            ? mates.slice().sort((a, b) => b.profile.set_pieces - a.profile.set_pieces)[0]
            : pickWeighted(mates, (p) => creatorWeight(p, wide));
          assister.stats.assists++;
        }
      }
      emit(att.side, "goal", shooter, assister, payload);
      bumpMomentum(att.side, 0.5);
      return;
    }
    if (kind === "penalty") {
      const saved = rng.chance(0.75);
      if (saved && keeper) {
        keeper.stats.saves++;
        def.stats.saves++;
        shooter.stats.shots_on_target++;
        att.stats.shots_on_target++;
      }
      emit(att.side, "penalty_missed", shooter, saved ? keeper ?? null : null, { ...payload, outcome: saved ? "saved" : "off_target" });
      return;
    }
    const r = rng.next();
    if (r < C.onTargetGivenNoGoal) {
      shooter.stats.shots_on_target++;
      att.stats.shots_on_target++;
      if (keeper) {
        keeper.stats.saves++;
        def.stats.saves++;
      }
      emit(att.side, "shot_saved", shooter, keeper ?? null, payload);
      if (rng.chance(C.cornerAfterSaveOrBlock)) corner(att, def);
    } else if (r < C.onTargetGivenNoGoal + C.blockedShare && !header) {
      const blocker = pickWeighted(onPitch(def), defenderWeight);
      emit(att.side, "shot_blocked", shooter, blocker, payload);
      if (rng.chance(C.cornerAfterSaveOrBlock)) corner(att, def);
    } else {
      emit(att.side, "shot_off_target", shooter, null, payload);
    }
  };

  const corner = (att: Team, def: Team) => {
    att.stats.corners++;
    const taker = onPitch(att).slice().sort((a, b) => b.profile.set_pieces - a.profile.set_pieces)[0];
    emit(att.side, "corner", taker ?? null, null, {});
    clock += 25;
    if (rng.chance(C.cornerShotProb)) shoot(att, def, "corner_header");
  };

  // ---------- one possession ----------
  const playPossession = (attSide: Side) => {
    const att = teams[attSide];
    const def = teams[other(attSide)];
    const start = clock;
    const isTransition = transitionFor === attSide;
    transitionFor = null;
    att.stats.possessions++;

    const minute = minuteOf(clock);
    const diff = att.goals - def.goals;
    // score context: trailing teams push, leaders manage
    let context = 0;
    if (minute >= 60 && diff < 0) context += 0.12 + 0.25 * (minute - 60) / 30;
    if (minute >= 70 && diff > 0) context -= 0.12;

    const tempoMult = att.tactics.tempo === "high" ? 0.86 : att.tactics.tempo === "slow" ? 1.18 : 1;
    const styleMult = att.tactics.passing_directness === "short" ? 1.18 : att.tactics.passing_directness === "direct" ? 0.82 : 1;
    const transMult = att.tactics.transitions === "possession" ? 1.1 : att.tactics.transitions === "counter" ? 0.88 : 1;
    let seconds = C.possessionSeconds * tempoMult * styleMult * transMult * Math.exp(rng.normal(0, 0.4));
    if (isTransition) seconds *= 0.55;
    const homeAdv = input.neutral_venue ? 0 : attSide === "home" ? C.homeAdvantageLogit : -C.homeAdvantageLogit * 0.35;

    const finish = (endedByTurnover: boolean, defWinner?: OnPitch) => {
      seconds = clamp(seconds, 6, 120);
      clock = Math.max(clock, start + seconds);
      att.possessionSeconds += clock - start;
      recordPasses(att, def, clock - start, endedByTurnover);
      if (defWinner) {
        if (rng.chance(0.55)) { defWinner.stats.tackles++; def.stats.tackles++; }
        else { defWinner.stats.interceptions++; def.stats.interceptions++; }
      }
    };

    // 1) build-up vs press
    if (!isTransition) {
      let pPress = C.pressTurnoverBase[def.tactics.pressing];
      pPress *= Math.exp(-(att.units.control - def.units.control) / (C.ratingScale * 1.5));
      if (att.tactics.passing_directness === "direct") pPress *= 0.6;
      if (att.tactics.passing_directness === "short") pPress *= 1.15;
      if (rng.chance(pPress)) {
        const winner = pickWeighted(onPitch(def).filter((p) => SLOT_GROUP[p.slot] !== "DEF" && p.slot !== "GK").length
          ? onPitch(def).filter((p) => SLOT_GROUP[p.slot] !== "DEF" && p.slot !== "GK") : onPitch(def), defenderWeight);
        seconds *= 0.4;
        finish(true, winner);
        transitionFor = def.side; // high regain => dangerous transition
        bumpMomentum(def.side, 0.15);
        return;
      }
    }

    // fouls can happen anywhere
    if (rng.chance(C.foulPerPossession * (def.tactics.pressing === "high" ? 1.2 : def.tactics.pressing === "low" ? 0.85 : 1) * 0.6)) {
      foul(def, att, false);
    }

    // 2) progression into the final third
    let progLogit = C.progressionBase + (att.units.control - def.units.control) / C.ratingScale + homeAdv * 0.5;
    if (def.tactics.pressing === "low") progLogit += 0.18;
    if (def.tactics.defensive_line === "low") progLogit += 0.12;
    if (def.tactics.defensive_line === "high") progLogit -= 0.1;
    if (att.tactics.passing_directness === "direct") progLogit += 0.1;
    if (att.tactics.mentality === "attacking") progLogit += 0.08;
    if (att.tactics.mentality === "defensive") progLogit -= 0.1;
    if (isTransition) progLogit += 1.2;
    progLogit += context * 0.5;
    if (!rng.chance(sigmoid(progLogit))) {
      const winner = pickWeighted(onPitch(def), defenderWeight);
      finish(true, winner);
      if (def.tactics.transitions === "counter" && rng.chance(0.22)) transitionFor = def.side;
      return;
    }

    // 3) final third
    if (rng.chance(C.offsidePerFinalThird * (def.tactics.defensive_line === "high" ? 1.8 : def.tactics.defensive_line === "low" ? 0.5 : 1))) {
      const off = pickWeighted(onPitch(att).filter((p) => SLOT_GROUP[p.slot] === "ATT").length ? onPitch(att).filter((p) => SLOT_GROUP[p.slot] === "ATT") : onPitch(att), () => 1);
      att.stats.offsides++;
      finish(true);
      emit(att.side, "offside", off, null, {});
      return;
    }
    if (rng.chance(C.penaltyPerFinalThird * (isTransition ? 1.3 : 1))) {
      const fouler = pickWeighted(onPitch(def).filter((p) => p.slot !== "GK"), defenderWeight);
      fouler.stats.fouls++;
      def.stats.fouls++;
      finish(false);
      emit(att.side, "penalty_awarded", null, fouler, {});
      if (rng.chance(0.25)) {
        fouler.yellow++;
        fouler.stats.cards_yellow++;
        def.stats.yellow_cards++;
        if (fouler.yellow >= 2) {
          fouler.stats.cards_red++;
          def.stats.red_cards++;
          emit(def.side, "second_yellow", fouler, null, {});
          sendOff(def, fouler);
        } else emit(def.side, "yellow_card", fouler, null, {});
      }
      clock += 60;
      shoot(att, def, "penalty");
      return;
    }
    if (rng.chance(C.foulPerPossession * 0.45)) {
      foul(def, att, true);
      finish(false);
      if (rng.chance(C.freeKickShotProb)) shoot(att, def, "free_kick");
      else if (rng.chance(0.22)) shoot(att, def, "header");
      return;
    }

    let chanceLogit = C.chanceBase + (att.units.attack - def.units.defense) / C.ratingScale + homeAdv
      + mentalityLogit(att.tactics.mentality) - mentalityLogit(def.tactics.mentality) * 0.75 + context;
    if (isTransition) chanceLogit += C.transitionChanceBonus * (def.tactics.defensive_line === "high" ? 1.3 : 1);
    if (def.tactics.defensive_line === "low") chanceLogit -= 0.12; // compact block
    if (def.tactics.pressing === "high" && isTransition) chanceLogit += 0.12; // space behind the press
    if (att.tactics.width === "wide" && def.tactics.width === "narrow") chanceLogit += 0.08;
    if (att.tactics.width === "narrow" && def.tactics.width === "wide") chanceLogit += 0.05;
    if (minute >= 70 && diff > 0) chanceLogit -= 0.1;

    if (!rng.chance(sigmoid(chanceLogit))) {
      finish(true, pickWeighted(onPitch(def), defenderWeight));
      if (rng.chance(C.cornerAfterFailedAttack)) corner(att, def);
      return;
    }

    finish(false);
    // choose chance type
    const wideBias = att.tactics.width === "wide" ? 1.5 : att.tactics.width === "narrow" ? 0.6 : 1;
    const oneOnOneBias = (isTransition ? 2.3 : 1) * (def.tactics.defensive_line === "high" ? 1.6 : def.tactics.defensive_line === "low" ? 0.6 : 1);
    const outsideBias = def.tactics.defensive_line === "low" ? 1.35 : 1;
    const kinds: { k: ShotKind; w: number }[] = [
      { k: "open_box", w: 0.45 },
      { k: "outside_box", w: 0.3 * outsideBias },
      { k: "header", w: 0.13 * wideBias },
      { k: "one_on_one", w: 0.06 * oneOnOneBias },
    ];
    const kind = rng.pickWeighted(kinds, (x) => x.w).k;
    shoot(att, def, kind);
  };

  // ---------- main loop ----------
  const endOfMatch = () => 90 * 60 + (secondHalfStoppageBase + extraSecondHalf) * 60;
  while (true) {
    if (half === 1 && clock >= firstHalfEnd) {
      emit("home", "half_time", null, null, { home: home.goals, away: away.goals }, clock);
      half = 2;
      clock = 45 * 60;
      possessionSide = "away";
      transitionFor = null;
      // half-time recovery
      for (const t of [home, away]) for (const p of onPitch(t)) p.stamina = Math.min(100, p.stamina + 4);
    }
    if (half === 2 && clock >= endOfMatch()) break;

    const before = clock;
    playPossession(possessionSide);
    if (clock <= before) clock = before + 5;
    const dt = clock - lastStaminaTick;
    if (dt >= 180) {
      for (const t of [home, away]) {
        drainStamina(t, dt);
        injuryCheck(t, dt);
      }
      lastStaminaTick = clock;
    }
    if (half === 2) {
      maybeSubs(home);
      maybeSubs(away);
    }
    // possession alternates; a transition keeps the regaining side on the ball
    possessionSide = transitionFor ?? other(possessionSide);
    extraSecondHalf = Math.min(4, Math.floor(events.filter((e) => e.minute >= 45 && ["goal", "own_goal", "substitution", "injury", "red_card", "second_yellow"].includes(e.event_type)).length / 4));
  }
  const endClock = clock;
  emit("home", "full_time", null, null, { home: home.goals, away: away.goals }, endClock);

  // ---------- finalize player stats ----------
  const fullMinutes = Math.round(endClock / 60);
  const allStats: PlayerMatchStats[] = [];
  for (const t of [home, away]) {
    const opp = teams[other(t.side)];
    const goalsAgainst = events.filter((e) => (e.event_type === "goal" || e.event_type === "own_goal") && e.side === opp.side);
    for (const p of t.players) {
      if (!p.wasOnPitch) {
        p.stats.stamina_end = Math.round(p.stamina);
        allStats.push(p.stats);
        continue;
      }
      const from = p.minIn;
      const to = p.minOut ?? fullMinutes;
      p.stats.minutes = clamp(to - from, 0, 130);
      p.stats.goals_conceded_on_pitch = goalsAgainst.filter((e) => e.minute >= from && e.minute <= to).length;
      p.stats.clean_sheet = p.stats.minutes >= 60 && p.stats.goals_conceded_on_pitch === 0;
      p.stats.stamina_end = Math.round(p.stamina);
      p.stats.xg = round3(p.stats.xg);
      p.stats.rating = rate(p, t.goals, opp.goals);
      allStats.push(p.stats);
    }
    const totalPoss = home.possessionSeconds + away.possessionSeconds;
    t.stats.possession_pct = totalPoss > 0 ? Math.round((100 * t.possessionSeconds) / totalPoss) : 50;
    t.stats.xg = round3(t.stats.xg);
    t.stats.passes_attempted = t.players.reduce((s, p) => s + p.stats.passes_attempted, 0);
    t.stats.passes_completed = t.players.reduce((s, p) => s + p.stats.passes_completed, 0);
  }
  // make possession sum to exactly 100
  away.stats.possession_pct = 100 - home.stats.possession_pct;

  return {
    engine_version: ENGINE_VERSION,
    seed,
    home_goals: home.goals,
    away_goals: away.goals,
    team_stats: { home: home.stats, away: away.stats },
    events,
    player_stats: allStats,
    momentum: momentum.map((m) => Math.round(m * 100) / 100),
    duration_seconds: endClock,
  };
}

/** Match rating 1..10 derived only from recorded actions. */
function rate(p: OnPitch, teamGoals: number, oppGoals: number): number {
  const s = p.stats;
  const g = SLOT_GROUP[p.slot] === "GK" ? "GK" : p.input.position_group;
  let r = 6.0;
  r += s.goals * (g === "ATT" ? 0.9 : g === "MID" ? 1.0 : 1.2);
  r += s.assists * 0.6;
  r += (s.shots_on_target - s.goals) * 0.08 + s.xg * 0.35;
  r -= Math.max(0, s.shots - s.shots_on_target - 2) * 0.05;
  if (s.passes_attempted > 0) r += clamp((s.passes_completed - 0.8 * s.passes_attempted) * 0.02, -0.4, 0.4);
  r += s.tackles * 0.1 + s.interceptions * 0.08;
  r += s.saves * 0.25;
  const conceded = s.goals_conceded_on_pitch;
  r -= conceded * (g === "GK" ? 0.35 : g === "DEF" ? 0.2 : g === "MID" ? 0.05 : 0);
  if (s.clean_sheet) r += g === "GK" ? 0.6 : g === "DEF" ? 0.4 : 0;
  r -= s.cards_yellow * 0.25 + s.cards_red * 1.5 + s.fouls * 0.05 + s.own_goals * 1.0;
  r += teamGoals > oppGoals ? 0.25 : teamGoals < oppGoals ? -0.2 : 0;
  // short cameos regress to 6.0
  const w = clamp(s.minutes / 45, 0.25, 1);
  r = 6 + (r - 6) * w;
  return round1(clamp(r, 3, 10));
}
