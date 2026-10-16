/**
 * press-v1 — pre-match press conference questions (pt-PT). Pure and seeded per (game, season, round, club).
 * The manager answers each question with free text + a tone; the tone alone drives effects (in SQL, answer_press),
 * the text is quoted by O Apito.
 */
import { createRng } from "../common/rng";

export const PRESS_VERSION = "press-v1";

export interface PressContext {
  gameId: string;
  season: number;
  round: number;
  total_rounds: number;
  club: { id: string; name: string; position: number | null; last_results: ("W" | "D" | "L")[] };
  opponent: { id: string; name: string; position: number | null; manager: string | null; home: boolean };
  /** all-time record against this opponent in this league, from the club's point of view */
  record?: { w: number; d: number; l: number } | null;
}

export interface PressQuestion { key: string; text: string }

export const TONES = {
  confident: { label: "Confiante", hint: "+moral; ligeiro reforço no controlo do jogo." },
  calm: { label: "Calmo", hint: "+moral; imune às provocações do adversário." },
  provocative: { label: "Provocador", hint: "+moral; contra um treinador humano, desestabiliza-o (se ele não responder com calma)." },
  evasive: { label: "Evasivo", hint: "Sem efeitos. Não te comprometes." },
} as const;
export type Tone = keyof typeof TONES;

const pick = (r: () => number, xs: readonly string[]) => xs[Math.floor(r() * xs.length)];

export function pressQuestions(ctx: PressContext): PressQuestion[] {
  const rng = createRng(`${ctx.gameId}|s${ctx.season}|r${ctx.round}|press|${ctx.club.id}|${PRESS_VERSION}`);
  const r = () => rng.next();
  const opp = ctx.opponent.name;
  const qs: PressQuestion[] = [];
  const last = ctx.club.last_results.slice(-3);
  const wins = last.filter((x) => x === "W").length, losses = last.filter((x) => x === "L").length;

  // 1 — the opponent
  if (ctx.opponent.manager) {
    qs.push({ key: "rival", text: pick(r, [
      `Do outro lado está ${ctx.opponent.manager}. Que mensagem deixa ao seu rival antes do jogo com o ${opp}?`,
      `${ctx.opponent.manager} disse esta semana que o ${opp} é favorito. Concorda?`,
      `É mais do que um jogo quando se defronta ${ctx.opponent.manager}?`,
    ]) });
  } else {
    qs.push({ key: "opponent", text: pick(r, [
      `O que espera do ${opp}${ctx.opponent.home ? " em casa" : " fora"}?`,
      `Qual é a maior ameaça do ${opp}?`,
      `O ${opp} chega ${ctx.opponent.position && ctx.round > 1 ? `em ${ctx.opponent.position}.º lugar` : "a este jogo"}. Como se prepara a equipa?`,
    ]) });
  }
  // 2 — form
  if (wins >= 2) qs.push({ key: "form", text: pick(r, ["A equipa vem de boas vitórias. Este é o melhor momento da época?", "Com esta série, a equipa sente-se imbatível?"]) });
  else if (losses >= 2) qs.push({ key: "form", text: pick(r, ["Os resultados não têm aparecido. Sente o lugar em risco?", "O que mudou para a equipa perder tantos pontos?"]) });
  else qs.push({ key: "form", text: pick(r, ["Como avalia o momento da equipa?", "Está satisfeito com o rendimento das últimas semanas?"]) });
  // 3 — table / record / objective
  if (ctx.record && ctx.record.w + ctx.record.d + ctx.record.l > 0) {
    const { w, d, l } = ctx.record;
    qs.push({ key: "record", text: `Historial nesta liga: ${w} vitórias, ${d} empates e ${l} derrotas com o ${opp}. Pesa alguma coisa?` });
  } else if (ctx.club.position === 1 && ctx.round > 1) {
    qs.push({ key: "table", text: pick(r, ["Líder da liga. O título já é obrigação?", "Como se gere a pressão de estar no primeiro lugar?"]) });
  } else if (ctx.club.position && ctx.round > ctx.total_rounds / 2) {
    qs.push({ key: "table", text: `${ctx.club.position}.º lugar a ${ctx.total_rounds - ctx.round + 1} jornadas do fim. Qual é o objetivo realista?` });
  } else {
    qs.push({ key: "objective", text: pick(r, ["Qual é o objetivo do clube para esta época?", "Os adeptos podem sonhar com quê este ano?"]) });
  }
  return qs;
}
