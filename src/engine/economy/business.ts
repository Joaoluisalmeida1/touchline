/**
 * business-v1 (economy-v2): stadium & tickets, fan mood, sponsors with clauses, staff and the board.
 * Pure and deterministic; all values are synthetic game rules (never real club finances). Money in integer cents.
 * Calibrated so a club at reputation 60, fan mood 50, normal tickets and a typical sponsor set earns about what
 * economy-v1 paid (gate ≈ gateReceiptsCents, sponsors ≈ sponsorshipCents).
 */
import { clamp, createRng } from "../common/rng";
import { euroToCents, sponsorshipCents } from "./economy";

export const BUSINESS_VERSION = "business-v1";

/* ------------------------------------------------------------------ stadium & tickets */

export type TicketPrice = "low" | "normal" | "high";
export const TICKET = {
  priceFactor: { low: 0.75, normal: 1, high: 1.35 } as Record<TicketPrice, number>,
  fillAdj: { low: 0.12, normal: 0, high: -0.14 } as Record<TicketPrice, number>,
  moodPerRound: { low: 1, normal: 0, high: -1 } as Record<TicketPrice, number>,
  vipPerLevelEur: 40_000,
} as const;

export function baseCapacity(reputation: number): number {
  return Math.round((6000 + reputation * reputation * 4) / 500) * 500;
}
export function ticketPriceEur(reputation: number, level: TicketPrice): number {
  return Math.round((10 + reputation * 0.25) * TICKET.priceFactor[level]);
}

export interface Stadium { capacity: number; ticket_price: TicketPrice; fan_mood: number; vip_level: number }

export function matchdayGate(home: Stadium & { reputation: number }, awayReputation: number): { attendance: number; cents: number } {
  const fill = clamp(0.55 + (home.fan_mood / 100) * 0.35 + TICKET.fillAdj[home.ticket_price] + (awayReputation >= 70 ? 0.05 : 0), 0.2, 1);
  const attendance = Math.round(home.capacity * fill);
  const cents = euroToCents(attendance * ticketPriceEur(home.reputation, home.ticket_price) + home.vip_level * TICKET.vipPerLevelEur);
  return { attendance, cents };
}

/** Fan mood after a round: result, ticket policy and a slow pull back to 50. */
export function nextFanMood(mood: number, result: "W" | "D" | "L" | null, price: TicketPrice): number {
  let m = mood + (result === "W" ? 3 : result === "L" ? -3 : 0) + TICKET.moodPerRound[price];
  m += (50 - m) * 0.02;
  return Math.round(clamp(m, 0, 100));
}

export const UPGRADES = {
  capacity: { label: "Bancada (+2 000 lugares)", costEur: 3_000_000, rounds: 6, max: 5 },
  vip: { label: "Camarotes (+€40k por jogo em casa)", costEur: 2_000_000, rounds: 8, max: 3 },
} as const;
export type UpgradeKind = keyof typeof UPGRADES;
export interface Upgrade { kind: UpgradeKind; ready_at: number }
/** absolute round counter used for build times across seasons */
export const absRound = (season: number, round: number) => season * 100 + round;

export function stadiumFrom(base: number, upgrades: Upgrade[], now: number): { capacity: number; vip_level: number; building: Upgrade[] } {
  const done = upgrades.filter((u) => u.ready_at <= now);
  return {
    capacity: base + 2000 * done.filter((u) => u.kind === "capacity").length,
    vip_level: done.filter((u) => u.kind === "vip").length,
    building: upgrades.filter((u) => u.ready_at > now),
  };
}

/* ------------------------------------------------------------------ sponsors */

export type Slot = "main" | "sleeve" | "stadium" | "kit";
export const SLOTS: Record<Slot, { label: string; share: number }> = {
  main: { label: "Patrocinador principal", share: 0.55 },
  stadium: { label: "Nome do estádio", share: 0.2 },
  sleeve: { label: "Manga", share: 0.15 },
  kit: { label: "Técnico (equipamento)", share: 0.1 },
};
export type DealKind = "fixed" | "balanced" | "performance";
export const DEAL_KIND: Record<DealKind, { label: string; base: number; win: number; clause: number }> = {
  fixed: { label: "Fixo", base: 1.0, win: 0, clause: 0 },
  balanced: { label: "Equilibrado", base: 0.8, win: 0.5, clause: 0 },
  performance: { label: "Por objetivos", base: 0.55, win: 0.9, clause: 8 },
};

/** Fictional brands only (no betting). Content as data. */
const BRANDS: Record<Slot, string[]> = {
  main: ["Lusovolt Energia", "Marévia Seguros", "Tecnoporto", "Banco Ribeirinho", "Aurora Telecom", "Serrana Águas", "Vinhal Logística", "Cimentos do Vale"],
  stadium: ["Arena Solmar", "Parque Nortegás", "Estádio Brisalta", "Campo Verdemar", "Arena Pinhalnovo", "Estádio Lumiar Cloud"],
  sleeve: ["Pastelaria Doce Bairro", "Farol Imobiliária", "Rota Viagens", "Moinho Café", "Quinta do Ribeiro", "Clínica Andorinha"],
  kit: ["Kalvo Sport", "Ondina Athletics", "Trevo Wear", "Malha Norte", "Vento Sul Sports"],
};

export interface SponsorOffer {
  slot: Slot; brand: string; kind: DealKind; base_cents: number; win_bonus_cents: number;
  clause: { top: number; bonus_cents: number } | null; seasons: number;
}

/** 3 offers per slot (one of each kind), scaled by reputation; the performance clause targets the board objective. */
export function sponsorOffers(args: { gameId: string; season: number; clubId: string; reputation: number; target: number; slots: Slot[] }): SponsorOffer[] {
  const rng = createRng(`${args.gameId}|s${args.season}|sponsors|${args.clubId}|${BUSINESS_VERSION}`);
  const perRound = sponsorshipCents(args.reputation);
  const out: SponsorOffer[] = [];
  for (const slot of args.slots) {
    const names = [...BRANDS[slot]];
    for (const kind of ["fixed", "balanced", "performance"] as DealKind[]) {
      const brand = names.splice(Math.floor(rng.next() * names.length), 1)[0];
      const k = DEAL_KIND[kind];
      const share = perRound * SLOTS[slot].share * (0.92 + rng.next() * 0.16);
      const r1k = (c: number) => Math.round(c / 100_000) * 100_000;
      out.push({
        slot, brand, kind, base_cents: r1k(share * k.base), win_bonus_cents: r1k(share * k.win),
        clause: k.clause ? { top: args.target, bonus_cents: r1k(share * k.clause) } : null,
        seasons: kind === "fixed" ? 1 + Math.floor(rng.next() * 3) : kind === "balanced" ? 2 : 1,
      });
    }
  }
  return out;
}

/** AI / default choice: the safe deal. */
export function safeOffer(offers: SponsorOffer[], slot: Slot): SponsorOffer | undefined {
  return offers.find((o) => o.slot === slot && o.kind === "fixed");
}

/* ------------------------------------------------------------------ staff */

export type StaffRole = "assistant" | "fitness" | "medical" | "scout" | "youth";
export const STAFF: Record<StaffRole, { label: string; effect: (lvl: number) => string }> = {
  assistant: { label: "Treinador adjunto", effect: (l) => `+${Math.round(staffAssistantXp(l) * 100 - 100)}% evolução` },
  fitness: { label: "Preparador físico", effect: (l) => `+${staffFitness(l).toFixed(1)} condição/jornada, −${Math.round((1 - staffInjuryFactor(l)) * 100)}% lesões no treino` },
  medical: { label: "Departamento médico", effect: (l) => `−${Math.round((1 - staffMedical(l)) * 100)}% duração das lesões` },
  scout: { label: "Olheiro", effect: (l) => (l >= 4 ? "Relatório completo do adversário" : l >= 2 ? "Relatório com sistema e ausências" : "Relatório básico") },
  youth: { label: "Coordenador da formação", effect: () => "Academia (chega na fase 4)" },
};
export const STAFF_WAGE_EUR = [0, 4_000, 8_000, 15_000, 28_000, 50_000]; // per round, by level

export const staffAssistantXp = (lvl: number) => 1 + 0.0375 * (lvl - 1);
export const staffFitness = (lvl: number) => 0.75 * (lvl - 1);
export const staffInjuryFactor = (lvl: number) => 1 - 0.075 * (lvl - 1);
export const staffMedical = (lvl: number) => 1 - 0.0625 * (lvl - 1);

const FIRST = ["Rui", "Paulo", "Nuno", "Hugo", "Sérgio", "Tiago", "Bruno", "Vítor", "Carlos", "Filipe", "Duarte", "Marco", "Ivo", "Jorge", "Aurélio", "Leonel", "Telmo", "Abel", "Rita", "Marta", "Inês", "Sónia"];
const LAST = ["Moreira", "Calado", "Brandão", "Fragoso", "Azevedo", "Seixas", "Valente", "Quaresma", "Pestana", "Barroso", "Teles", "Coutinho", "Gouveia", "Lacerda", "Meireles", "Nogueira", "Paiva", "Sardinha"];

export interface StaffCandidate { role: StaffRole; name: string; level: number; wage_cents: number }

/** Fictional staff. Pool: 3 candidates per role per season; the starting staff level follows reputation. */
export function staffPool(args: { gameId: string; season: number; clubId: string; reputation: number }): StaffCandidate[] {
  const rng = createRng(`${args.gameId}|s${args.season}|staff|${args.clubId}|${BUSINESS_VERSION}`);
  const out: StaffCandidate[] = [];
  const mid = clamp(Math.round(1 + args.reputation / 25), 1, 5);
  const used = new Set<string>();
  for (const role of Object.keys(STAFF) as StaffRole[]) {
    for (const d of [-1, 0, 1]) {
      const level = clamp(mid + d + (rng.chance(0.2) ? 1 : 0), 1, 5);
      let name = "";
      do name = `${FIRST[Math.floor(rng.next() * FIRST.length)]} ${LAST[Math.floor(rng.next() * LAST.length)]}`; while (used.has(name));
      used.add(name);
      out.push({ role, name, level, wage_cents: euroToCents(STAFF_WAGE_EUR[level] * (0.9 + rng.next() * 0.2)) });
    }
  }
  return out;
}

export function startingStaff(args: { gameId: string; clubId: string; reputation: number }): StaffCandidate[] {
  const rng = createRng(`${args.gameId}|staff0|${args.clubId}|${BUSINESS_VERSION}`);
  const lvl = clamp(Math.round(args.reputation / 25), 1, 4);
  return (Object.keys(STAFF) as StaffRole[]).map((role) => ({
    role, level: lvl, wage_cents: euroToCents(STAFF_WAGE_EUR[lvl]),
    name: `${FIRST[Math.floor(rng.next() * FIRST.length)]} ${LAST[Math.floor(rng.next() * LAST.length)]}`,
  }));
}

/* ------------------------------------------------------------------ board */

export interface Objective { kind: "top" | "avoid"; target: number; label: string }

/** Objective from the club's strength rank in the league (1 = strongest). */
export function boardObjective(rank: number, clubs: number): Objective {
  const target = Math.min(clubs, rank + 1);
  if (rank <= 1) return { kind: "top", target: 1, label: "Ser campeão" };
  if (target <= Math.ceil(clubs / 2)) return { kind: "top", target, label: `Terminar no top ${target}` };
  if (rank <= clubs - 3) return { kind: "top", target: Math.min(clubs - 3, target + 1), label: `Terminar acima do ${Math.min(clubs - 3, target + 1) + 1}.º lugar` };
  return { kind: "avoid", target: clubs - 3, label: "Evitar os últimos 3 lugares" };
}
export const objectiveMet = (o: Objective, position: number) => position <= o.target;

/** Expected points of a match from the strength difference (own − opponent) and home advantage. */
export function expectedPoints(diff: number, home: boolean): number {
  return clamp(1.35 + 0.12 * (diff + (home ? 1.5 : -1.5)), 0.3, 2.6);
}

export interface ConfidenceInput {
  confidence: number; points: number | null; expected: number | null; cash_cents: number;
  wages_cents: number; wage_budget_cents: number; transfer_spent_cents: number; transfer_budget_cents: number;
}
/** One round of board confidence: results vs expectation, debt, wage bill vs budget, transfer overspend. */
export function nextConfidence(i: ConfidenceInput): { confidence: number; reasons: { delta: number; reason: string }[] } {
  const reasons: { delta: number; reason: string }[] = [];
  if (i.points !== null && i.expected !== null) {
    const d = Math.round(clamp((i.points - i.expected) * 2.5, -6, 6));
    if (d) reasons.push({ delta: d, reason: d > 0 ? "Resultado acima do esperado" : "Resultado abaixo do esperado" });
  }
  if (i.cash_cents < 0) reasons.push({ delta: -2, reason: "Saldo negativo" });
  if (i.wages_cents > i.wage_budget_cents * 1.0001) reasons.push({ delta: -1, reason: "Salários acima do orçamento" });
  if (i.transfer_spent_cents > i.transfer_budget_cents && i.transfer_budget_cents >= 0) reasons.push({ delta: -2, reason: "Gastos em transferências acima do orçamento" });
  const conf = Math.round(clamp(i.confidence + reasons.reduce((s, r) => s + r.delta, 0) + (60 - i.confidence) * 0.02, 0, 100));
  return { confidence: conf, reasons };
}

export const BOARD = { warning: 35, ultimatum: 20, praise: 80, ultimatumCut: 0.25, praiseBoost: 0.1, maxShift: 20 } as const;

/** Season budgets: a share of cash for transfers, the current wage bill (+5%) per round for wages. */
export function seasonBudgets(cashCents: number, wageBillCents: number, confidence: number): { transfer: number; wage: number } {
  const share = 0.25 + 0.2 * (confidence / 100);
  return { transfer: Math.max(0, Math.round((cashCents * share) / 100_000) * 100_000), wage: Math.round((wageBillCents * 1.05) / 10_000) * 10_000 };
}

export function effectiveBudgets(base: { transfer: number; wage: number }, shiftPct: number, rounds: number): { transfer: number; wage: number } {
  const moved = Math.round((base.transfer * clamp(shiftPct, -BOARD.maxShift, BOARD.maxShift)) / 100);
  return { transfer: base.transfer + moved, wage: Math.max(0, base.wage - Math.round(moved / Math.max(1, rounds))) };
}
