/**
 * "O Apito" — turns a processed matchday into ranked stories, log facts and round awards.
 * Pure and deterministic: no clock, no Math.random; templates are picked with the seeded RNG.
 */
import { createRng, type Rng } from "../common/rng";
import type { PositionGroup } from "../common/types";
import {
  NARRATIVE_VERSION, type AwardPlayer, type Edition, type Fact, type NClub, type NMatch, type RoundAwards, type RoundFacts,
  type Story, type StoryKind,
} from "./types";

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
const pick = (rng: Rng, list: readonly string[]) => list[Math.floor(rng.next() * list.length)];
const upper = (s: string) => s.toLocaleUpperCase("pt-PT");

const DERBY_DRAW = ["Empate no duelo de treinadores entre {home} e {away}", "{home} e {away} não se vencem: {score}"] as const;

export const HEADLINES: Record<StoryKind, readonly string[]> = {
  derby: ["{winner} ganha o duelo de treinadores", "{wmgr} leva a melhor sobre {lmgr}", "Clássico entre amigos: {winner} {score}"],
  upset: ["Surpresa! {winner} derruba {loser}", "{winner} faz tremer a liga", "Ninguém esperava: {winner} vence {loser}"],
  thrashing: ["GOLEADA: {winner} {score} {loser}", "{winner} esmaga {loser}", "Noite de pesadelo para {loser}"],
  hat_trick: ["{player} faz hat-trick", "Hat-trick de {player} decide", "{player} leva a bola para casa"],
  comeback: ["Reviravolta épica de {winner}", "{winner} dá a volta ao resultado", "{winner} não desiste e vira o jogo"],
  late_winner: ["{player} decide ao minuto {minute}", "Golo tardio dá vitória a {winner}", "{winner} ganha nos descontos"],
  new_leader: ["{club} é o novo líder", "Mudança no topo: {club} assume a liderança", "{club} sobe ao primeiro lugar"],
  red_card: ["Expulsão custa caro a {loser}", "Vermelho a {player} complica {loser}"],
  goal_fest: ["Festival de golos: {home} {score} {away}", "Chuva de golos entre {home} e {away}"],
  human_result: ["{club}: {verdict}", "{mgr} e o seu {club}: {verdict}"],
  title_race: ["{club} isolado na frente a {left} jornadas do fim", "Corrida ao título: {gap} pontos separam {club} de {second}"],
};

const BASE: Record<StoryKind, number> = {
  derby: 62, upset: 50, thrashing: 44, hat_trick: 48, comeback: 56, late_winner: 46, new_leader: 52, red_card: 28,
  goal_fest: 38, human_result: 22, title_race: 40,
};

interface Ctx { facts: RoundFacts; club: Map<string, NClub>; rng: Rng }

function scoreLine(m: NMatch) { return `${m.home_goals}–${m.away_goals}`; }
function winnerOf(m: NMatch): { w: string; l: string } | null {
  if (m.home_goals === m.away_goals) return null;
  return m.home_goals > m.away_goals ? { w: m.home_id, l: m.away_id } : { w: m.away_id, l: m.home_id };
}

/** Goals in minute order, with the running score after each one. */
function timeline(m: NMatch) {
  let h = 0, a = 0;
  return [...m.goals].sort((x, y) => x.minute - y.minute).map((g) => {
    if (g.club_id === m.home_id) h++; else a++;
    return { g, h, a };
  });
}

function scorersText(m: NMatch, clubId: string): string {
  const list = m.goals.filter((g) => g.club_id === clubId).sort((x, y) => x.minute - y.minute)
    .map((g) => `${g.scorer ?? "?"}${g.own_goal ? " (p.b.)" : g.penalty ? " (g.p.)" : ""} ${g.minute}'`);
  return list.join(", ");
}

function matchBody(ctx: Ctx, m: NMatch): string {
  const h = ctx.club.get(m.home_id)!, a = ctx.club.get(m.away_id)!;
  const parts = [`${h.name} ${scoreLine(m)} ${a.name}.`];
  const hs = scorersText(m, m.home_id), as = scorersText(m, m.away_id);
  if (hs) parts.push(`Golos de ${h.short}: ${hs}.`);
  if (as) parts.push(`Golos de ${a.short}: ${as}.`);
  parts.push(`xG ${m.home_xg.toFixed(2)} – ${m.away_xg.toFixed(2)}.`);
  const best = ctx.facts.players.filter((p) => (p.club_id === m.home_id || p.club_id === m.away_id) && p.rating !== null)
    .sort((x, y) => (y.rating! - x.rating!) || x.id.localeCompare(y.id))[0];
  if (best) parts.push(`Melhor em campo: ${best.name} (${best.rating!.toFixed(1)}).`);
  return parts.join(" ");
}

function story(ctx: Ctx, kind: StoryKind, vars: Record<string, string | number>, extra: Partial<Story> & { score?: number; templates?: readonly string[] }): Story {
  const headline = fill(pick(ctx.rng, extra.templates ?? HEADLINES[kind]), vars);
  const humans = (extra.club_ids ?? []).filter((id) => ctx.club.get(id)?.manager).length;
  return {
    kind, rank: 0, score: (extra.score ?? BASE[kind]) + humans * 15, headline: kind === "thrashing" ? upper(headline) : headline,
    body: extra.body ?? "", fixture_id: extra.fixture_id ?? null, club_ids: extra.club_ids ?? [], player_ids: extra.player_ids ?? [],
  };
}

function matchStories(ctx: Ctx, m: NMatch): { stories: Story[]; facts: Fact[] } {
  const stories: Story[] = [];
  const facts: Fact[] = [];
  const h = ctx.club.get(m.home_id)!, a = ctx.club.get(m.away_id)!;
  const wl = winnerOf(m);
  const W = wl ? ctx.club.get(wl.w)! : null, L = wl ? ctx.club.get(wl.l)! : null;
  const margin = Math.abs(m.home_goals - m.away_goals);
  const total = m.home_goals + m.away_goals;
  const body = matchBody(ctx, m);
  const base = { fixture_id: m.fixture_id, club_ids: [m.home_id, m.away_id], body };
  const v = { home: h.name, away: a.name, score: scoreLine(m), winner: W?.name ?? "", loser: L?.name ?? "" };

  facts.push({ kind: "match_result", key: m.fixture_id, club_id: null, player_id: null,
    payload: { fixture_id: m.fixture_id, home_id: m.home_id, away_id: m.away_id, home_goals: m.home_goals, away_goals: m.away_goals } });

  if (h.manager && a.manager) {
    stories.push(story(ctx, "derby", { ...v, wmgr: W?.manager ?? "", lmgr: L?.manager ?? "" }, {
      ...base, score: W ? BASE.derby + margin * 4 : BASE.derby - 6, templates: W ? HEADLINES.derby : DERBY_DRAW,
    }));
    facts.push({ kind: "derby", key: m.fixture_id, club_id: W?.id ?? null, player_id: null, payload: { fixture_id: m.fixture_id, draw: !W } });
  }
  if (W && L && L.strength - W.strength >= 4) {
    const gap = L.strength - W.strength;
    stories.push(story(ctx, "upset", v, { ...base, score: BASE.upset + gap * 3 }));
    facts.push({ kind: "upset", key: m.fixture_id, club_id: W.id, player_id: null, payload: { fixture_id: m.fixture_id, gap: Math.round(gap * 10) / 10 } });
  }
  if (W && margin >= 4) {
    stories.push(story(ctx, "thrashing", v, { ...base, score: BASE.thrashing + margin * 5 }));
    facts.push({ kind: "big_win", key: m.fixture_id, club_id: W.id, player_id: null, payload: { fixture_id: m.fixture_id, margin } });
  } else if (total >= 6) {
    stories.push(story(ctx, "goal_fest", v, { ...base, score: BASE.goal_fest + total * 2 }));
  }
  // hat-tricks (own goals excluded)
  const byScorer = new Map<string, { name: string; club: string; n: number }>();
  for (const g of m.goals) {
    if (g.own_goal || !g.scorer_id) continue;
    const cur = byScorer.get(g.scorer_id) ?? { name: g.scorer ?? "?", club: g.club_id, n: 0 };
    cur.n++;
    byScorer.set(g.scorer_id, cur);
  }
  for (const [pid, s] of [...byScorer.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
    if (s.n < 3) continue;
    stories.push(story(ctx, "hat_trick", { ...v, player: s.name }, { ...base, score: BASE.hat_trick + s.n * 5, player_ids: [pid] }));
    facts.push({ kind: "hat_trick", key: `${m.fixture_id}:${pid}`, club_id: s.club, player_id: pid, payload: { fixture_id: m.fixture_id, goals: s.n } });
  }
  if (W) {
    const tl = timeline(m);
    const winnerHome = W.id === m.home_id;
    const worstDeficit = Math.max(0, ...tl.map((t) => (winnerHome ? t.a - t.h : t.h - t.a)));
    if (worstDeficit >= 1) {
      stories.push(story(ctx, "comeback", v, { ...base, score: BASE.comeback + worstDeficit * 10 }));
      facts.push({ kind: "comeback", key: m.fixture_id, club_id: W.id, player_id: null, payload: { fixture_id: m.fixture_id, deficit: worstDeficit } });
    }
    // the goal that put the winner ahead for good
    let decider: (typeof tl)[number] | undefined;
    for (const t of tl) {
      const ahead = winnerHome ? t.h > t.a : t.a > t.h;
      if (ahead && !decider) decider = t;
      if (!ahead) decider = undefined;
    }
    if (decider && decider.g.minute >= 85 && margin === 1) {
      stories.push(story(ctx, "late_winner", { ...v, player: decider.g.scorer ?? "?", minute: decider.g.minute },
        { ...base, player_ids: decider.g.scorer_id ? [decider.g.scorer_id] : [] }));
      facts.push({ kind: "late_winner", key: m.fixture_id, club_id: W.id, player_id: decider.g.scorer_id, payload: { fixture_id: m.fixture_id, minute: decider.g.minute } });
    }
    const red = m.reds.find((r) => r.club_id === L!.id);
    if (red) stories.push(story(ctx, "red_card", { ...v, player: red.player ?? "?" }, base));
  }
  for (const r of m.reds) {
    facts.push({ kind: "red_card", key: `${m.fixture_id}:${r.minute}:${r.player ?? ""}`, club_id: r.club_id, player_id: null, payload: { fixture_id: m.fixture_id, minute: r.minute } });
  }
  // every human club gets at least a short result line
  for (const side of [h, a]) {
    if (!side.manager || stories.some((s) => s.club_ids.includes(side.id) && s.kind !== "human_result")) continue;
    const gf = side.id === m.home_id ? m.home_goals : m.away_goals, ga = side.id === m.home_id ? m.away_goals : m.home_goals;
    const opp = side.id === m.home_id ? a : h;
    const verdict = gf > ga ? pick(ctx.rng, [`vitória por ${gf}–${ga} frente ao ${opp.name}`, `três pontos contra o ${opp.name}`])
      : gf < ga ? pick(ctx.rng, [`derrota por ${gf}–${ga} com o ${opp.name}`, `tropeção frente ao ${opp.name}`])
      : pick(ctx.rng, [`empate a ${gf} com o ${opp.name}`, `divisão de pontos com o ${opp.name}`]);
    stories.push(story(ctx, "human_result", { club: side.name, mgr: side.manager, verdict }, { ...base, club_ids: [side.id], score: BASE.human_result + (gf > ga ? 8 : 0) }));
  }
  return { stories, facts };
}

function tableStories(ctx: Ctx): { stories: Story[]; facts: Fact[] } {
  const { table_before: before, table_after: after, round, total_rounds } = ctx.facts;
  const stories: Story[] = [];
  const facts: Fact[] = [];
  const leader = after[0];
  if (!leader) return { stories, facts };
  const club = ctx.club.get(leader.club_id)!;
  if (before[0] && before[0].club_id !== leader.club_id && round > 1) {
    stories.push(story(ctx, "new_leader", { club: club.name }, {
      club_ids: [leader.club_id], body: `${club.name} soma ${leader.points} pontos após ${round} jornadas.`,
    }));
    facts.push({ kind: "new_leader", key: leader.club_id, club_id: leader.club_id, player_id: null, payload: { points: leader.points } });
  }
  const second = after[1];
  const left = total_rounds - round;
  if (second && left > 0 && round >= Math.ceil(total_rounds / 2)) {
    const gap = leader.points - second.points;
    const s2 = ctx.club.get(second.club_id)!;
    stories.push(story(ctx, "title_race", { club: club.name, second: s2.name, gap, left }, {
      club_ids: [leader.club_id, second.club_id], score: BASE.title_race + Math.max(0, 6 - gap) * 3,
      body: `${club.name} lidera com ${leader.points} pontos, ${gap} à frente do ${s2.name}. Faltam ${left} jornadas.`,
    }));
  }
  return { stories, facts };
}

const TEAM_SHAPE: [PositionGroup, number][] = [["GK", 1], ["DEF", 4], ["MID", 3], ["ATT", 3]];

export function roundAwards(facts: RoundFacts): RoundAwards {
  const rated = facts.players.filter((p) => p.rating !== null && p.minutes >= 45)
    .map((p): AwardPlayer => ({ id: p.id, name: p.name, club_id: p.club_id, group: p.group, rating: p.rating!, goals: p.goals, assists: p.assists }))
    .sort((a, b) => (b.rating - a.rating) || (b.goals - a.goals) || (b.assists - a.assists) || a.id.localeCompare(b.id));
  const team: AwardPlayer[] = [];
  for (const [g, n] of TEAM_SHAPE) team.push(...rated.filter((p) => p.group === g).slice(0, n));
  const goals = facts.matches.flatMap((m) => m.goals.filter((g) => !g.own_goal && g.scorer && g.xg !== null && !g.penalty)
    .map((g) => ({ fixture_id: m.fixture_id, minute: g.minute, scorer: g.scorer!, club_id: g.club_id, xg: g.xg! })))
    .sort((a, b) => (a.xg - b.xg) || a.fixture_id.localeCompare(b.fixture_id) || a.minute - b.minute);
  return { team, player: rated[0] ?? null, goal: goals[0] ?? null };
}

export function buildEdition(facts: RoundFacts): Edition {
  const rng = createRng(`${facts.game_id}|s${facts.season}|r${facts.round}|news|${NARRATIVE_VERSION}`);
  const ctx: Ctx = { facts, club: new Map(facts.clubs.map((c) => [c.id, c])), rng };
  const stories: Story[] = [];
  const log: Fact[] = [];
  const matches = [...facts.matches].sort((x, y) => x.fixture_id.localeCompare(y.fixture_id));
  for (const m of matches) {
    const r = matchStories(ctx, m);
    stories.push(...r.stories);
    log.push(...r.facts);
  }
  const t = tableStories(ctx);
  stories.push(...t.stories);
  log.push(...t.facts);

  // one story per fixture on the page: keep the most dramatic angle, mention the rest in its body
  const best = new Map<string, Story>();
  const loose: Story[] = [];
  for (const s of stories) {
    if (!s.fixture_id) { loose.push(s); continue; }
    if (s.kind === "human_result") { loose.push(s); continue; }
    const cur = best.get(s.fixture_id);
    if (!cur || s.score > cur.score) best.set(s.fixture_id, s);
  }
  const covered = new Set([...best.values()].flatMap((s) => s.club_ids));
  const page = [...best.values(), ...loose.filter((s) => s.kind !== "human_result" || !covered.has(s.club_ids[0]))]
    .sort((a, b) => (b.score - a.score) || (a.fixture_id ?? a.kind).localeCompare(b.fixture_id ?? b.kind));
  page.forEach((s, i) => { s.rank = i + 1; });

  const awards = roundAwards(facts);
  if (awards.player) {
    log.push({ kind: "player_of_round", key: awards.player.id, club_id: awards.player.club_id, player_id: awards.player.id, payload: { rating: awards.player.rating } });
  }
  for (const p of awards.team) {
    log.push({ kind: "team_of_round", key: p.id, club_id: p.club_id, player_id: p.id, payload: { rating: p.rating } });
  }
  return { version: NARRATIVE_VERSION, stories: page, facts: log, awards };
}
