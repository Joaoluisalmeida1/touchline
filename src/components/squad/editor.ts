/** Pure lineup-editor logic (no React). Shared by the pitch, bench, list and presets; unit-tested. */
import type { Formation, LineupInstructions, Slot, Tactics } from "@/engine/common/types";
import { isFormation } from "@/engine/common/types";
import { autoPickLineup, resolveLineup, type AutoPickMode, type SquadPlayer } from "@/engine/lineup/autopick";
import { FORMATION_SLOTS, SLOT_GROUP, slotFit } from "@/engine/lineup/formations";
import { DEFAULT_ROLE, resolveRole } from "@/engine/lineup/roles";
import { previewTeamStrength } from "@/engine/match/engine";
import type { MatchPlayerInput } from "@/engine/match/types";
import { isAvailableP, type EditorState, type PresetPayload, type SquadP } from "./types";

export const MAX_BENCH = 9;

export const toSquadPlayer = (p: SquadP): SquadPlayer => ({
  id: p.id, position_group: p.group, current_ovr: p.ovr, fitness: p.fitness, injured_matches: p.injured,
  suspension_matches: p.suspended, preferred_slot: p.preferred_slot, familiarity: p.familiarity, apps: p.stats.apps,
});

export const fitOf = (p: SquadP, slot: Slot) => slotFit({ position_group: p.group, preferred_slot: p.preferred_slot, familiarity: p.familiarity }, slot);
export const effOf = (p: SquadP, slot: Slot) => Math.round(p.ovr * fitOf(p, slot));

/** Build an editor state from a saved/preset lineup; invalid or missing parts are corrected like the server does. */
export function fromLineup(
  squad: SquadP[], saved: { formation: string; starters: { player_id: string; slot: Slot; role?: string | null }[]; bench: string[] } | null,
  tactics: Tactics, ins: LineupInstructions, fallback: Formation = "4-3-3",
): EditorState {
  const r = resolveLineup(squad.map(toSquadPlayer), saved, isFormation(saved?.formation) ? (saved!.formation as Formation) : fallback);
  const slots = FORMATION_SLOTS[r.formation];
  const xi: (string | null)[] = slots.map(() => null);
  const roles: string[] = slots.map((s) => DEFAULT_ROLE[s]);
  const used = new Set<number>();
  for (const s of r.starters) {
    const i = slots.findIndex((slot, k) => slot === s.slot && !used.has(k));
    if (i < 0) continue;
    used.add(i);
    xi[i] = s.player_id;
    roles[i] = resolveRole(s.slot, s.role).id;
  }
  const inSquad = new Set(squad.map((p) => p.id));
  const keep = (id?: string | null) => (id && inSquad.has(id) ? id : null);
  return {
    formation: r.formation, xi, roles, bench: r.bench.slice(0, MAX_BENCH), tactics,
    ins: { captain: keep(ins.captain), penalty_taker: keep(ins.penalty_taker), freekick_taker: keep(ins.freekick_taker), corner_taker: keep(ins.corner_taker) },
  };
}

export function autoPick(squad: SquadP[], st: EditorState, mode: AutoPickMode): EditorState {
  const r = autoPickLineup(squad.map(toSquadPlayer), st.formation, mode);
  const slots = FORMATION_SLOTS[st.formation];
  const xi: (string | null)[] = slots.map(() => null);
  const used = new Set<number>();
  for (const s of r.starters) {
    const i = slots.findIndex((slot, k) => slot === s.slot && !used.has(k));
    if (i >= 0) { used.add(i); xi[i] = s.player_id; }
  }
  return cleanInstructions({ ...st, xi, bench: r.bench.slice(0, MAX_BENCH) });
}

/** Change formation keeping the same XI, re-seated by best fit; roles kept when the slot type stays at that index. */
export function changeFormation(squad: SquadP[], st: EditorState, f: Formation): EditorState {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const oldSlots = FORMATION_SLOTS[st.formation];
  const slots = FORMATION_SLOTS[f];
  const pool = st.xi.filter((x): x is string => !!x);
  const xi: (string | null)[] = slots.map(() => null);
  // GK first, then the slots with the fewest good candidates
  const order = slots.map((_, i) => i).sort((a, b) => (slots[a] === "GK" ? -1 : slots[b] === "GK" ? 1 : a - b));
  for (const i of order) {
    let best = -1, score = -1;
    pool.forEach((id, k) => {
      const p = byId.get(id);
      if (!p) return;
      const s = fitOf(p, slots[i]) * p.ovr;
      if (s > score) { score = s; best = k; }
    });
    if (best >= 0) xi[i] = pool.splice(best, 1)[0];
  }
  const roles = slots.map((s, i) => (oldSlots[i] === s ? resolveRole(s, st.roles[i]).id : DEFAULT_ROLE[s]));
  // leftovers (only possible if the old XI had fewer than 11) go to the bench if there is room
  const bench = [...st.bench];
  for (const id of pool) if (bench.length < MAX_BENCH && !bench.includes(id)) bench.push(id);
  return cleanInstructions({ ...st, formation: f, xi, roles, bench });
}

export type Zone = { kind: "slot"; index: number } | { kind: "bench"; index?: number } | { kind: "reserves" };
export type Where = { kind: "slot"; index: number } | { kind: "bench"; index: number } | { kind: "reserves" };

export function locate(st: EditorState, id: string): Where {
  const i = st.xi.indexOf(id);
  if (i >= 0) return { kind: "slot", index: i };
  const b = st.bench.indexOf(id);
  if (b >= 0) return { kind: "bench", index: b };
  return { kind: "reserves" };
}

export interface MoveResult { state: EditorState; error?: string }

/** Move a player to a zone. Swaps when the target is occupied. Never produces duplicates. */
export function movePlayer(squad: SquadP[], st: EditorState, id: string, to: Zone): MoveResult {
  const p = squad.find((x) => x.id === id);
  if (!p) return { state: st, error: "Jogador desconhecido." };
  const from = locate(st, id);
  const xi = [...st.xi];
  const bench = [...st.bench];
  if (to.kind === "slot") {
    if (!isAvailableP(p)) return { state: st, error: `${p.name} está ${p.injured ? "lesionado" : "suspenso"}.` };
    if (from.kind === "slot" && from.index === to.index) return { state: st };
    const occupant = xi[to.index];
    if (from.kind === "slot") {
      xi[from.index] = occupant;
      xi[to.index] = id;
    } else if (from.kind === "bench") {
      if (occupant) bench[from.index] = occupant; else bench.splice(from.index, 1);
      xi[to.index] = id;
    } else {
      xi[to.index] = id;
      // the displaced starter goes to the bench if there is room, else back to the reserves
      if (occupant && bench.length < MAX_BENCH) bench.push(occupant);
    }
    return { state: cleanInstructions({ ...st, xi, bench }) };
  }
  if (to.kind === "bench") {
    if (from.kind === "bench") {
      const target = to.index ?? bench.length - 1;
      bench.splice(from.index, 1);
      bench.splice(Math.min(target, bench.length), 0, id);
      return { state: { ...st, bench } };
    }
    if (bench.length >= MAX_BENCH && (to.index === undefined || !bench[to.index])) {
      return { state: st, error: `O banco já tem ${MAX_BENCH} jogadores. Arrasta para cima de um suplente para trocar.` };
    }
    if (from.kind === "slot") {
      if (to.index !== undefined && bench[to.index]) {
        // swap starter ↔ that substitute
        const sub = bench[to.index];
        const subP = squad.find((x) => x.id === sub);
        if (subP && !isAvailableP(subP)) return { state: st, error: `${subP.name} não está disponível.` };
        bench[to.index] = id;
        xi[from.index] = sub;
      } else {
        xi[from.index] = null;
        bench.push(id);
      }
    } else if (to.index !== undefined && bench[to.index]) {
      bench[to.index] = id; // reserve replaces that substitute (who goes back to the reserves)
    } else bench.push(id);
    return { state: cleanInstructions({ ...st, xi, bench }) };
  }
  // reserves
  if (from.kind === "slot") xi[from.index] = null;
  if (from.kind === "bench") bench.splice(from.index, 1);
  return { state: cleanInstructions({ ...st, xi, bench }) };
}

/** Drop instructions that no longer point at the matchday squad (captain must start). */
export function cleanInstructions(st: EditorState): EditorState {
  const xi = new Set(st.xi.filter(Boolean) as string[]);
  const squad = new Set([...xi, ...st.bench]);
  const ins: LineupInstructions = { ...st.ins };
  if (ins.captain && !xi.has(ins.captain)) ins.captain = null;
  for (const k of ["penalty_taker", "freekick_taker", "corner_taker"] as const) if (ins[k] && !squad.has(ins[k]!)) ins[k] = null;
  return { ...st, ins };
}

export function toSavePayload(st: EditorState) {
  const slots = FORMATION_SLOTS[st.formation];
  return {
    formation: st.formation,
    starters: st.xi.map((id, i) => ({ player_id: id!, slot: slots[i], role: st.roles[i] })),
    bench: st.bench,
    instructions: st.ins,
    tactics: st.tactics,
  };
}

export function toPreset(st: EditorState): PresetPayload {
  const s = toSavePayload(st);
  return { formation: s.formation, starters: s.starters.filter((x) => !!x.player_id), bench: s.bench, tactics: s.tactics, instructions: s.instructions };
}

export function fromPreset(squad: SquadP[], p: PresetPayload): EditorState {
  return fromLineup(squad, { formation: p.formation, starters: p.starters, bench: p.bench }, p.tactics, p.instructions ?? {}, p.formation);
}

const matchInput = (p: SquadP, slot?: Slot, role?: string): MatchPlayerInput => ({
  id: p.id, name: p.name, position_group: p.group, slot, role, ovr: p.ovr, fitness: p.fitness, form: p.form, morale: p.morale,
  sharpness: p.sharpness, preferred_slot: p.preferred_slot, familiarity: p.familiarity,
  profile: p.profile.individual ? { attack: p.profile.attack, defense: p.profile.defense, creation: p.profile.creation, physical: p.profile.physical, keeper: p.profile.keeper, set_pieces: p.profile.set_pieces } : undefined,
});

/** Same strength model the match engine uses (no day form / randomness). */
export function strength(squad: SquadP[], st: EditorState) {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const slots = FORMATION_SLOTS[st.formation];
  const starters = st.xi.map((id, i) => (id && byId.get(id) ? matchInput(byId.get(id)!, slots[i], st.roles[i]) : null)).filter(Boolean) as MatchPlayerInput[];
  if (starters.length === 0) return null;
  const s = previewTeamStrength({
    club_id: "me", name: "me", formation: st.formation, tactics: st.tactics, starters, bench: [],
    instructions: st.ins.captain ? { captain: st.ins.captain } : undefined,
  });
  return { ...s, overall: Math.round(((s.control + s.attack + s.defense) / 3) * 10) / 10 };
}

export interface Warning { level: "error" | "warn" | "info"; text: string }

export function lineupWarnings(squad: SquadP[], st: EditorState): Warning[] {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const slots = FORMATION_SLOTS[st.formation];
  const out: Warning[] = [];
  const empty = st.xi.filter((x) => !x).length;
  if (empty) out.push({ level: "error", text: `Faltam ${empty} titular${empty > 1 ? "es" : ""} no onze.` });
  st.xi.forEach((id, i) => {
    const p = id ? byId.get(id) : undefined;
    if (!p) return;
    if (!isAvailableP(p)) out.push({ level: "error", text: `${p.name} não está disponível.` });
    if (slots[i] === "GK" && p.group !== "GK") out.push({ level: "error", text: `${p.name} não é guarda-redes.` });
    else if (fitOf(p, slots[i]) < 0.9) out.push({ level: "warn", text: `${p.name} está fora de posição (${Math.round(fitOf(p, slots[i]) * 100)}% de rendimento).` });
    if (p.fitness < 70) out.push({ level: "warn", text: `${p.name} está cansado (condição ${p.fitness}%).` });
  });
  const benchPlayers = st.bench.map((id) => byId.get(id)).filter(Boolean) as SquadP[];
  if (!benchPlayers.some((p) => p.group === "GK")) out.push({ level: "warn", text: "Nenhum guarda-redes no banco." });
  if (st.bench.length < 5) out.push({ level: "info", text: `Só ${st.bench.length} suplentes (podes ter ${MAX_BENCH}).` });
  if (!st.ins.captain) out.push({ level: "info", text: "Sem capitão definido (pequeno bónus de liderança perdido)." });
  for (const g of ["DEF", "MID", "ATT"] as const) {
    const need = slots.filter((s) => SLOT_GROUP[s] === g).length;
    const have = squad.filter((p) => p.group === g && isAvailableP(p)).length;
    if (have < need) out.push({ level: "warn", text: `Só tens ${have} ${g === "DEF" ? "defesas" : g === "MID" ? "médios" : "avançados"} disponíveis para ${need} posições.` });
  }
  return out;
}

export const sameState = (a: EditorState, b: EditorState) => JSON.stringify(a) === JSON.stringify(b);
