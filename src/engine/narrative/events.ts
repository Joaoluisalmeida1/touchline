/**
 * events-v1 — the Gabinete: small dilemmas that land on a manager's desk between matchdays.
 * Content is data (EVENTS below); the roller is pure and seeded (`game|season|round|events|club`).
 * Every effect is bounded again in SQL (_apply_effects), so a catalog typo can never break the economy.
 * Same rules for humans and AI: AI clubs get the same events and take the default choice.
 */
import { createRng, type Rng } from "../common/rng";
import { sponsorshipCents } from "../economy/economy";
import { traitOf, type Trait } from "./traits";

export const EVENTS_VERSION = "events-v2";

export type Effect =
  | { type: "morale"; scope: "squad"; delta: number }
  | { type: "morale"; player_id: string; delta: number }
  | { type: "fitness" | "form"; player_id: string; delta: number }
  | { type: "injury" | "unavailable"; player_id: string; matches: number }
  | { type: "cash"; delta_cents: number; reason: string }
  | { type: "confidence" | "fan_mood"; delta: number; reason?: string }
  | { type: "ticket_price"; level: "low" | "normal" | "high" };

export interface Choice { label: string; detail: string; effects: Effect[] }

export interface EventDraft {
  key: string;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  choices: Choice[];
  default_choice: number;
}

export interface EvPlayer {
  id: string;
  name: string;
  ovr: number;
  morale: number;
  form: number;
  fitness: number;
  unavailable: boolean;
  /** league appearances / minutes this season */
  apps: number;
  minutes: number;
}

export interface EvClub {
  id: string;
  name: string;
  reputation: number;
  /** most recent last: "W" | "D" | "L" */
  last_results: ("W" | "D" | "L")[];
  position: number | null;
  clubs: number;
  /** phase 3 context (optional: events that need it simply don't fire without it) */
  ticket_price?: "low" | "normal" | "high";
  fan_mood?: number;
  confidence?: number;
  main_sponsor?: string | null;
  next_opponent_human?: string | null;
  /** event keys already rolled for this club this season (for once-per-season events) */
  season_keys?: string[];
}

interface Ctx { club: EvClub; players: (EvPlayer & { trait: Trait; rank: number })[]; round: number; unit: number; rng: Rng }
interface Def {
  key: string;
  weight: number;
  /** returns null when the event does not apply */
  build(ctx: Ctx): Omit<EventDraft, "key"> | null;
}

const eur = (cents: number) => `€${Math.round(cents / 100).toLocaleString("pt-PT")}`;
const roundCash = (c: number) => Math.max(100_000, Math.round(c / 100_000) * 100_000); // at least €1k, in €1k steps
const available = (c: Ctx) => c.players.filter((p) => !p.unavailable);
const pickOne = <T,>(rng: Rng, xs: T[]) => xs[Math.floor(rng.next() * xs.length)];
const streak = (r: EvClub["last_results"], x: "W" | "L", n: number) => r.length >= n && r.slice(-n).every((v) => v === x);

export const EVENTS: Def[] = [
  {
    key: "wants_minutes", weight: 10,
    build(c) {
      const p = available(c).filter((x) => x.trait === "ambitious" || x.trait === "temperamental").filter((x) => x.rank <= 18 && x.rank > 11 && c.round > 2);
      if (!p.length) return null;
      const x = pickOne(c.rng, p);
      return {
        title: `${x.name} quer jogar mais`,
        body: `${x.name} bateu à porta do gabinete: acha que merece mais minutos e não esconde a frustração.`,
        payload: { player_id: x.id },
        choices: [
          { label: "Prometer oportunidades", detail: "Fica motivado agora — mas espera jogar.", effects: [{ type: "morale", player_id: x.id, delta: 10 }] },
          { label: "Tem de merecer no treino", detail: "Mensagem clara ao grupo; ele não gosta.", effects: [{ type: "morale", player_id: x.id, delta: -6 }, { type: "morale", scope: "squad", delta: 1 }] },
          { label: "Ignorar", detail: "Não dizer nada.", effects: [{ type: "morale", player_id: x.id, delta: -10 }] },
        ],
        default_choice: 2,
      };
    },
  },
  {
    key: "night_out", weight: 8,
    build(c) {
      const p = available(c).filter((x) => x.trait === "party");
      if (!p.length) return null;
      const x = pickOne(c.rng, p);
      const fine = roundCash(c.unit * 0.02);
      return {
        title: `${x.name} apanhado na noite`,
        body: `Fotografias de ${x.name} numa discoteca às 4h da manhã circulam nas redes sociais, a dois dias do jogo.`,
        payload: { player_id: x.id },
        choices: [
          { label: `Multar (${eur(fine)})`, detail: "O dinheiro entra no clube; ele fica amuado.", effects: [{ type: "cash", delta_cents: fine, reason: "Multa disciplinar" }, { type: "morale", player_id: x.id, delta: -8 }] },
          { label: "Afastar uma jornada", detail: "Exemplo para o balneário.", effects: [{ type: "unavailable", player_id: x.id, matches: 1 }, { type: "morale", scope: "squad", delta: 2 }, { type: "morale", player_id: x.id, delta: -5 }] },
          { label: "Fechar os olhos", detail: "Ele chega cansado ao jogo.", effects: [{ type: "fitness", player_id: x.id, delta: -15 }, { type: "form", player_id: x.id, delta: -0.5 }] },
        ],
        default_choice: 2,
      };
    },
  },
  {
    key: "training_knock", weight: 9,
    build(c) {
      const p = available(c).filter((x) => x.rank <= 11);
      if (!p.length) return null;
      const x = pickOne(c.rng, p);
      return {
        title: `${x.name} com queixas`,
        body: `O departamento médico avisa: ${x.name} sentiu um toque no treino. Pode jogar, mas não a 100%.`,
        payload: { player_id: x.id },
        choices: [
          { label: "Poupar esta jornada", detail: "Falha o jogo e recupera.", effects: [{ type: "unavailable", player_id: x.id, matches: 1 }, { type: "fitness", player_id: x.id, delta: 15 }] },
          { label: "Jogar com dores", detail: "Disponível, mas com a condição em baixo.", effects: [{ type: "fitness", player_id: x.id, delta: -20 }] },
        ],
        default_choice: 0,
      };
    },
  },
  {
    key: "local_sponsor", weight: 6,
    build(c) {
      const amount = roundCash(c.unit * 0.25);
      return {
        title: "Proposta de um patrocinador local",
        body: `Uma empresa da região quer o nome no equipamento de treino e uma sessão de autógrafos com o plantel.`,
        payload: {},
        choices: [
          { label: `Aceitar (${eur(amount)})`, detail: "A sessão rouba algum descanso ao plantel.", effects: [{ type: "cash", delta_cents: amount, reason: "Patrocínio local" }, { type: "morale", scope: "squad", delta: -1 }] },
          { label: "Recusar", detail: "Foco total no jogo.", effects: [] },
        ],
        default_choice: 1,
      };
    },
  },
  {
    key: "fan_protest", weight: 12,
    build(c) {
      if (!streak(c.club.last_results, "L", 2)) return null;
      const cost = roundCash(c.unit * 0.05);
      return {
        title: "Adeptos à porta do centro de treinos",
        body: `Depois de ${c.club.last_results.slice(-3).filter((r) => r === "L").length} derrotas recentes, um grupo de adeptos pede explicações.`,
        payload: {},
        choices: [
          { label: "Receber os adeptos", detail: `Jantar e conversa (${eur(cost)}). O balneário sente o apoio.`, effects: [{ type: "cash", delta_cents: -cost, reason: "Encontro com adeptos" }, { type: "morale", scope: "squad", delta: 3 }] },
          { label: "Treinar à porta fechada", detail: "Protege o grupo, mas o ambiente pesa.", effects: [{ type: "morale", scope: "squad", delta: -1 }] },
          { label: "Ignorar", detail: "Os jogadores ouvem os assobios.", effects: [{ type: "morale", scope: "squad", delta: -3 }] },
        ],
        default_choice: 2,
      };
    },
  },
  {
    key: "winning_streak", weight: 10,
    build(c) {
      if (!streak(c.club.last_results, "W", 3)) return null;
      return {
        title: "O plantel pede um dia de folga",
        body: "Três vitórias seguidas. O capitão pergunta se a equipa pode ter um dia livre.",
        payload: {},
        choices: [
          { label: "Dar folga", detail: "Moral em alta.", effects: [{ type: "morale", scope: "squad", delta: 4 }] },
          { label: "Manter o ritmo", detail: "Não há tempo a perder — alguns resmungam.", effects: [{ type: "morale", scope: "squad", delta: -1 }, ...available(c).filter((p) => p.rank <= 11).slice(0, 3).map((p): Effect => ({ type: "form", player_id: p.id, delta: 0.3 }))] },
        ],
        default_choice: 0,
      };
    },
  },
  {
    key: "leader_speech", weight: 9,
    build(c) {
      const last = c.club.last_results.at(-1);
      const p = available(c).filter((x) => x.trait === "leader" && x.rank <= 14);
      if (last !== "L" || !p.length) return null;
      const x = pickOne(c.rng, p);
      return {
        title: `${x.name} quer falar ao grupo`,
        body: `Depois da derrota, ${x.name} pede para ser ele a falar no balneário antes do treino.`,
        payload: { player_id: x.id },
        choices: [
          { label: "Deixar falar", detail: "O grupo ouve um dos seus.", effects: [{ type: "morale", scope: "squad", delta: 3 }, { type: "morale", player_id: x.id, delta: 4 }] },
          { label: "Falo eu", detail: "O treinador é que manda.", effects: [{ type: "morale", scope: "squad", delta: 1 }, { type: "morale", player_id: x.id, delta: -4 }] },
        ],
        default_choice: 0,
      };
    },
  },
  {
    key: "dressing_room_clash", weight: 7,
    build(c) {
      const hot = available(c).filter((x) => x.trait === "temperamental");
      const other = available(c).filter((x) => x.trait !== "temperamental" && x.rank <= 18);
      if (!hot.length || !other.length) return null;
      const a = pickOne(c.rng, hot), b = pickOne(c.rng, other);
      const cost = roundCash(c.unit * 0.02);
      return {
        title: `Discussão entre ${a.name} e ${b.name}`,
        body: `${a.name} e ${b.name} envolveram-se numa discussão acesa no treino. Os colegas tiveram de os separar.`,
        payload: { player_ids: [a.id, b.id] },
        choices: [
          { label: "Castigar os dois", detail: "Disciplina acima de tudo.", effects: [{ type: "morale", player_id: a.id, delta: -6 }, { type: "morale", player_id: b.id, delta: -4 }, { type: "morale", scope: "squad", delta: 1 }] },
          { label: `Jantar de equipa (${eur(cost)})`, detail: "Fazer as pazes à mesa.", effects: [{ type: "cash", delta_cents: -cost, reason: "Jantar de equipa" }, { type: "morale", scope: "squad", delta: 2 }] },
          { label: "Deixar passar", detail: "O ambiente fica tenso.", effects: [{ type: "morale", scope: "squad", delta: -2 }, { type: "morale", player_id: a.id, delta: -3 }] },
        ],
        default_choice: 2,
      };
    },
  },
  {
    key: "charity_match", weight: 5,
    build(c) {
      const amount = roundCash(c.unit * 0.08);
      const three = available(c).filter((p) => p.rank > 11 && p.rank <= 20).slice(0, 3);
      if (three.length < 2) return null;
      return {
        title: "Convite para um jogo solidário",
        body: `Uma associação local convida o clube para um jogo de beneficência a meio da semana. O clube recebe ${eur(amount)} em receitas e imagem.`,
        payload: { player_ids: three.map((p) => p.id) },
        choices: [
          { label: "Enviar suplentes", detail: `${three.map((p) => p.name).join(", ")} jogam e cansam-se.`, effects: [{ type: "cash", delta_cents: amount, reason: "Jogo solidário" }, ...three.map((p): Effect => ({ type: "fitness", player_id: p.id, delta: -10 })), ...three.map((p): Effect => ({ type: "morale", player_id: p.id, delta: 3 }))] },
          { label: "Recusar", detail: "Fica mal na imprensa local.", effects: [{ type: "morale", scope: "squad", delta: -1 }] },
        ],
        default_choice: 1,
      };
    },
  },
  {
    key: "interview_request", weight: 7,
    build(c) {
      const p = available(c).filter((x) => x.form >= 0.8 && x.rank <= 11);
      if (!p.length) return null;
      const x = pickOne(c.rng, p);
      const shy = x.trait === "quiet";
      return {
        title: `Televisão quer entrevistar ${x.name}`,
        body: `${x.name} está em grande forma e um canal desportivo pede uma entrevista exclusiva.`,
        payload: { player_id: x.id },
        choices: [
          { label: "Autorizar", detail: shy ? "Ele é reservado — não gosta da ideia." : "Ele adora o destaque.", effects: [{ type: "morale", player_id: x.id, delta: shy ? -4 : 6 }] },
          { label: "Proteger o jogador", detail: "Sem distrações.", effects: [{ type: "morale", player_id: x.id, delta: shy ? 3 : -3 }] },
        ],
        default_choice: 1,
      };
    },
  },
  {
    key: "agent_call", weight: 6,
    build(c) {
      const p = available(c).filter((x) => x.trait === "ambitious" && x.rank <= 8);
      if (!p.length || c.round < 4) return null;
      const x = pickOne(c.rng, p);
      return {
        title: `Empresário de ${x.name} ao telefone`,
        body: `O empresário de ${x.name} diz que há clubes interessados e que o jogador "quer sentir-se valorizado".`,
        payload: { player_id: x.id },
        choices: [
          { label: "É peça fundamental", detail: "Elogio público; ele fica.", effects: [{ type: "morale", player_id: x.id, delta: 8 }] },
          { label: "Ninguém é insubstituível", detail: "O grupo aprecia, ele não.", effects: [{ type: "morale", player_id: x.id, delta: -8 }, { type: "morale", scope: "squad", delta: 1 }] },
          { label: "Não atender", detail: "O silêncio diz muito.", effects: [{ type: "morale", player_id: x.id, delta: -5 }] },
        ],
        default_choice: 2,
      };
    },
  },
  {
    key: "loyal_milestone", weight: 5,
    build(c) {
      const p = available(c).filter((x) => x.trait === "loyal" && x.apps >= 10);
      if (!p.length) return null;
      const x = pickOne(c.rng, p);
      const cost = roundCash(c.unit * 0.02);
      return {
        title: `Homenagem a ${x.name}?`,
        body: `${x.name} chegou aos ${x.apps} jogos esta época e é um dos favoritos dos adeptos.`,
        payload: { player_id: x.id },
        choices: [
          { label: `Homenagem antes do jogo (${eur(cost)})`, detail: "Momento bonito no estádio.", effects: [{ type: "cash", delta_cents: -cost, reason: "Homenagem" }, { type: "morale", player_id: x.id, delta: 8 }, { type: "morale", scope: "squad", delta: 1 }] },
          { label: "Fica para o fim da época", detail: "Sem custo.", effects: [] },
        ],
        default_choice: 1,
      };
    },
  },
  {
    key: "pitch_damage", weight: 4,
    build(c) {
      const cost = roundCash(c.unit * 0.1);
      return {
        title: "Relvado do centro de treinos danificado",
        body: "A chuva estragou o relvado principal. O responsável pede autorização para obras urgentes.",
        payload: {},
        choices: [
          { label: `Reparar já (${eur(cost)})`, detail: "Treinos normais.", effects: [{ type: "cash", delta_cents: -cost, reason: "Obras no relvado" }] },
          { label: "Treinar no sintético", detail: "Mais queixas físicas.", effects: [{ type: "morale", scope: "squad", delta: -1 }, ...available(c).filter((p) => p.rank <= 11).slice(0, 4).map((p): Effect => ({ type: "fitness", player_id: p.id, delta: -6 }))] },
        ],
        default_choice: 1,
      };
    },
  },
  {
    key: "youth_shines", weight: 5,
    build(c) {
      const p = available(c).filter((x) => x.rank > 18 && x.minutes < 200);
      if (!p.length) return null;
      const x = pickOne(c.rng, p);
      return {
        title: `${x.name} brilha no treino`,
        body: `Os adjuntos dizem que ${x.name} foi o melhor da semana e merece uma oportunidade.`,
        payload: { player_id: x.id },
        choices: [
          { label: "Elogiar em público", detail: "Ganha confiança.", effects: [{ type: "morale", player_id: x.id, delta: 8 }, { type: "form", player_id: x.id, delta: 0.5 }] },
          { label: "Manter os pés no chão", detail: "Sem pressas.", effects: [{ type: "morale", player_id: x.id, delta: 2 }] },
        ],
        default_choice: 1,
      };
    },
  },
];

EVENTS.push(
  {
    key: "ticket_protest", weight: 9,
    build(c) {
      if (c.club.ticket_price !== "high" || (c.club.fan_mood ?? 50) >= 55) return null;
      return {
        title: "Claque protesta contra o preço dos bilhetes",
        body: "Faixas na bancada e um comunicado da claque: os bilhetes estão caros demais para o que a equipa tem mostrado.",
        payload: {},
        choices: [
          { label: "Baixar para preço normal", detail: "Menos receita por jogo, adeptos mais calmos.", effects: [{ type: "ticket_price", level: "normal" }, { type: "fan_mood", delta: 5 }] },
          { label: "Manter o preço", detail: "Receita protegida; ambiente pesado.", effects: [{ type: "fan_mood", delta: -10 }] },
        ],
        default_choice: 1,
      };
    },
  },
  {
    key: "investor", weight: 3,
    build(c) {
      if ((c.club.season_keys ?? []).includes("investor") || c.round < 3) return null;
      const amount = roundCash(c.unit * 6);
      return {
        title: "Investidor quer entrar no clube",
        body: `Um fundo propõe uma injeção de ${eur(amount)}. Em troca, a direção passa a exigir mais — e não esquece se falhares.`,
        payload: {},
        choices: [
          { label: `Aceitar (${eur(amount)})`, detail: "Dinheiro já; a confiança da direção baixa até mostrares resultados.", effects: [{ type: "cash", delta_cents: amount, reason: "Investidor" }, { type: "confidence", delta: -8, reason: "Investidor exige resultados" }] },
          { label: "Recusar", detail: "A direção aprecia a prudência.", effects: [{ type: "confidence", delta: 3, reason: "Recusou investidor" }] },
        ],
        default_choice: 1,
      };
    },
  },
  {
    key: "sponsor_campaign", weight: 6,
    build(c) {
      const p = available(c).filter((x) => x.rank <= 5);
      if (!c.club.main_sponsor || !p.length) return null;
      const x = pickOne(c.rng, p);
      const fee = roundCash(c.unit * 0.12);
      return {
        title: `${c.club.main_sponsor} quer ${x.name} numa campanha`,
        body: `O patrocinador principal quer filmar um anúncio com ${x.name} esta semana.`,
        payload: { player_id: x.id },
        choices: [
          { label: `Aceitar (${eur(fee)})`, detail: "Ele gosta da atenção, mas chega cansado.", effects: [{ type: "cash", delta_cents: fee, reason: "Campanha do patrocinador" }, { type: "fitness", player_id: x.id, delta: -10 }, { type: "morale", player_id: x.id, delta: 4 }] },
          { label: "Recusar", detail: "O patrocinador fica desagradado — a direção também.", effects: [{ type: "confidence", delta: -2, reason: "Patrocinador desagradado" }] },
        ],
        default_choice: 0,
      };
    },
  },
  {
    key: "derby_demand", weight: 8,
    build(c) {
      if (!c.club.next_opponent_human) return null;
      return {
        title: "O presidente quer ganhar o dérbi",
        body: `O próximo jogo é contra ${c.club.next_opponent_human}. O presidente liga-te: "Este não podemos perder."`,
        payload: {},
        choices: [
          { label: "Prometer a vitória", detail: "A direção e o balneário embalam.", effects: [{ type: "confidence", delta: 4, reason: "Prometeu ganhar o dérbi" }, { type: "morale", scope: "squad", delta: 2 }] },
          { label: "Pedir calma", detail: "Sem promessas.", effects: [{ type: "confidence", delta: -2, reason: "Não se comprometeu no dérbi" }] },
        ],
        default_choice: 1,
      };
    },
  },
);

export const EVENT_RATE = { first: 0.55, second: 0.2 } as const;

/**
 * Roll 0–2 events for one club. `players` is the squad; rank (1 = strongest) is computed here from OVR so the
 * catalog can talk about starters (rank ≤ 11) and fringe players.
 */
export function rollEvents(args: { gameId: string; season: number; round: number; club: EvClub; players: EvPlayer[] }): EventDraft[] {
  const rng = createRng(`${args.gameId}|s${args.season}|r${args.round}|events|${args.club.id}|${EVENTS_VERSION}`);
  const ranked = [...args.players].sort((a, b) => b.ovr - a.ovr || a.id.localeCompare(b.id)).map((p, i) => ({ ...p, trait: traitOf(p.id), rank: i + 1 }));
  const ctx: Ctx = { club: args.club, players: ranked, round: args.round, unit: sponsorshipCents(args.club.reputation), rng };
  const out: EventDraft[] = [];
  const used = new Set<string>();
  for (const p of [EVENT_RATE.first, EVENT_RATE.second]) {
    if (!rng.chance(p)) break;
    const pool = EVENTS.filter((d) => !used.has(d.key)).map((d) => ({ d, e: d.build(ctx) })).filter((x) => x.e);
    if (!pool.length) break;
    const { d, e } = rng.pickWeighted(pool, (x) => x.d.weight);
    used.add(d.key);
    out.push({ key: d.key, ...e! });
  }
  return out;
}
