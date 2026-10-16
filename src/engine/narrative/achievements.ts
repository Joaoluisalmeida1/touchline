/**
 * achievements-v1 — manager achievements per league, evaluated after every round from facts the game already stores.
 * Pure: a snapshot of one manager's history in a league → the set of achievement keys earned so far.
 * Unlocking is idempotent (unique per game/user/key), so re-evaluating is always safe.
 */

export const ACHIEVEMENTS_VERSION = "achievements-v1";

export interface AResult { season: number; round: number; gf: number; ga: number; opp_human: boolean }
export interface AchievementCtx {
  results: AResult[];            // chronological, completed league matches of the manager's club in this league
  position: number | null;       // current league position
  round: number;
  champion_seasons: number;
  objectives_met: number;
  facts: Partial<Record<"comeback" | "late_winner" | "hat_trick" | "player_of_round" | "team_of_round" | "cup_winner", number>>;
  /** academy prospects promoted to the first team (phase 4b; optional for older callers) */
  academy_promoted?: number;
  buys: number[];                // transfer fees paid (cents)
  sale_multiples: number[];      // sale price / price paid, for players bought then sold
  swaps: number;
  human_deals: number;
  fan_mood: number | null;
  confidence: number | null;
  upgrades_done: number;
  press_answered: number;
  events_answered: number;
  cash_cents: number;
  initial_cash_cents: number;
}

export type Tier = "bronze" | "silver" | "gold";
export interface AchievementDef { key: string; title: string; description: string; tier: Tier; check: (c: AchievementCtx) => boolean }

const streak = (rs: AResult[], ok: (r: AResult) => boolean) => {
  let best = 0, cur = 0;
  for (const r of rs) { cur = ok(r) ? cur + 1 : 0; best = Math.max(best, cur); }
  return best;
};
const win = (r: AResult) => r.gf > r.ga;
const M = 100_000_000; // €1M in cents

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: "first_win", title: "Primeira vitória", description: "Ganha o primeiro jogo na liga.", tier: "bronze", check: (c) => c.results.some(win) },
  { key: "unbeaten_5", title: "Invicto", description: "5 jogos seguidos sem perder.", tier: "bronze", check: (c) => streak(c.results, (r) => r.gf >= r.ga) >= 5 },
  { key: "unbeaten_10", title: "Invencível", description: "10 jogos seguidos sem perder.", tier: "silver", check: (c) => streak(c.results, (r) => r.gf >= r.ga) >= 10 },
  { key: "wins_3", title: "Em série", description: "3 vitórias seguidas.", tier: "bronze", check: (c) => streak(c.results, win) >= 3 },
  { key: "wins_5", title: "Rolo compressor", description: "5 vitórias seguidas.", tier: "silver", check: (c) => streak(c.results, win) >= 5 },
  { key: "clean_3", title: "Muralha", description: "3 jogos seguidos sem sofrer golos.", tier: "silver", check: (c) => streak(c.results, (r) => r.ga === 0) >= 3 },
  { key: "thrashing", title: "Goleada", description: "Ganha por 4 ou mais golos de diferença.", tier: "bronze", check: (c) => c.results.some((r) => r.gf - r.ga >= 4) },
  { key: "goals_5", title: "Festival", description: "Marca 5 golos num jogo.", tier: "silver", check: (c) => c.results.some((r) => r.gf >= 5) },
  { key: "comeback", title: "Nunca desistir", description: "Vira um jogo que estava a perder.", tier: "silver", check: (c) => (c.facts.comeback ?? 0) > 0 },
  { key: "late_winner", title: "Ao cair do pano", description: "Ganha com um golo a partir dos 85'.", tier: "bronze", check: (c) => (c.facts.late_winner ?? 0) > 0 },
  { key: "hat_trick", title: "Hat-trick da casa", description: "Um jogador teu faz hat-trick.", tier: "bronze", check: (c) => (c.facts.hat_trick ?? 0) > 0 },
  { key: "showcase", title: "Montra", description: "10 presenças de jogadores teus na equipa da jornada.", tier: "silver", check: (c) => (c.facts.team_of_round ?? 0) >= 10 },
  { key: "derby_win", title: "Dérbi ganho", description: "Vence outro treinador humano.", tier: "bronze", check: (c) => c.results.some((r) => r.opp_human && win(r)) },
  { key: "derby_king", title: "Dono do dérbi", description: "5 vitórias contra treinadores humanos.", tier: "gold", check: (c) => c.results.filter((r) => r.opp_human && win(r)).length >= 5 },
  { key: "leader", title: "No topo", description: "Lidera a liga a partir da jornada 3.", tier: "silver", check: (c) => c.position === 1 && c.round >= 3 },
  { key: "champion", title: "Campeão", description: "Ganha a liga.", tier: "gold", check: (c) => c.champion_seasons > 0 },
  { key: "double_champion", title: "Dinastia", description: "Ganha a liga duas vezes.", tier: "gold", check: (c) => c.champion_seasons >= 2 },
  { key: "objective_met", title: "Missão cumprida", description: "Cumpre o objetivo da direção numa época.", tier: "silver", check: (c) => c.objectives_met > 0 },
  { key: "big_signing", title: "Contratação de peso", description: "Paga €20M ou mais por um jogador.", tier: "silver", check: (c) => c.buys.some((b) => b >= 20 * M) },
  { key: "shrewd_seller", title: "Negócio da China", description: "Vende um jogador pelo dobro do que pagaste.", tier: "gold", check: (c) => c.sale_multiples.some((m) => m >= 2) },
  { key: "swap", title: "Troca por troca", description: "Fecha uma troca de jogadores.", tier: "bronze", check: (c) => c.swaps > 0 },
  { key: "friends_deal", title: "Negócio entre amigos", description: "Faz uma transferência com outro treinador humano.", tier: "bronze", check: (c) => c.human_deals > 0 },
  { key: "ecstatic_fans", title: "Adeptos em êxtase", description: "Humor dos adeptos a 80 ou mais.", tier: "silver", check: (c) => (c.fan_mood ?? 0) >= 80 },
  { key: "board_love", title: "Direção rendida", description: "Confiança da direção a 85 ou mais.", tier: "silver", check: (c) => (c.confidence ?? 0) >= 85 },
  { key: "builder", title: "Obra feita", description: "Conclui uma obra no estádio.", tier: "bronze", check: (c) => c.upgrades_done > 0 },
  { key: "press_regular", title: "Figura mediática", description: "Responde a 5 conferências de imprensa.", tier: "bronze", check: (c) => c.press_answered >= 5 },
  { key: "office_hours", title: "Gestor de gabinete", description: "Decide 10 assuntos no Gabinete.", tier: "bronze", check: (c) => c.events_answered >= 10 },
  { key: "cup_winner", title: "Taça no museu", description: "Ganha a Taça da Liga dos Amigos.", tier: "gold", check: (c) => (c.facts.cup_winner ?? 0) > 0 },
  { key: "academy_graduate", title: "Prata da casa", description: "Promove um jovem da academia à equipa principal.", tier: "bronze", check: (c) => (c.academy_promoted ?? 0) > 0 },
  { key: "rich", title: "Cofre cheio", description: "Duplica o saldo inicial do clube.", tier: "gold", check: (c) => c.initial_cash_cents > 0 && c.cash_cents >= 2 * c.initial_cash_cents },
];

export const ACHIEVEMENT_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

export function earnedAchievements(ctx: AchievementCtx): string[] {
  return ACHIEVEMENTS.filter((a) => a.check(ctx)).map((a) => a.key);
}
