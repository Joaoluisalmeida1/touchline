import type { Slot } from "../common/types";

/**
 * Player roles: small, bounded trade-offs per player. Unit mods are rating points added to the team units
 * (control/attack/defense) while the player is on the pitch in that slot. Multipliers bias who shoots/creates,
 * chance types and stamina drain. Every non-standard role has a cost somewhere.
 * Changing any value alters outcomes and MUST bump ENGINE_VERSION.
 */
export interface RoleMods {
  control?: number;
  attack?: number;
  defense?: number;
  shot?: number; // shooter weight multiplier
  create?: number; // creator weight multiplier
  header?: number; // additive weight on "header" chance type (base 0.13)
  oneOnOne?: number; // additive weight on "one_on_one" (base 0.06)
  outside?: number; // additive weight on "outside_box" (base 0.30)
  drain?: number; // stamina drain multiplier
  offside?: number; // offside probability multiplier contribution
}

export interface RoleDef {
  id: string;
  label: string;
  description: string;
  slots: Slot[];
  mods: RoleMods;
}

const FULLBACKS: Slot[] = ["LB", "RB"];
const WINGBACKS: Slot[] = ["LWB", "RWB"];
const WIDE_MIDS: Slot[] = ["LM", "RM"];
const WINGERS: Slot[] = ["LW", "RW"];

export const ROLES: RoleDef[] = [
  // goalkeepers
  { id: "gk", label: "Guarda-redes", description: "Fica na baliza e joga pelo seguro.", slots: ["GK"], mods: {} },
  { id: "gk_sweeper", label: "Guarda-redes líbero", description: "Sai da área e participa na construção. Mais posse, mais risco.", slots: ["GK"], mods: { control: 0.35, defense: -0.2 } },
  // centre-backs
  { id: "cb", label: "Defesa central", description: "Equilibrado entre defender e sair a jogar.", slots: ["CB"], mods: {} },
  { id: "cb_ballplaying", label: "Central construtor", description: "Inicia a construção com passes verticais.", slots: ["CB"], mods: { control: 0.45, defense: -0.3, create: 1.3 } },
  { id: "cb_stopper", label: "Central marcador", description: "Agressivo nos duelos, simples com bola.", slots: ["CB"], mods: { defense: 0.45, control: -0.35, header: 0.01 } },
  // full-backs
  { id: "fb_defensive", label: "Lateral defensivo", description: "Fica atrás e fecha o corredor.", slots: FULLBACKS, mods: { defense: 0.4, attack: -0.3, create: 0.8 } },
  { id: "fb", label: "Lateral", description: "Apoia o ataque quando há espaço.", slots: FULLBACKS, mods: {} },
  { id: "fb_attacking", label: "Lateral ofensivo", description: "Sobe constantemente e cruza. Deixa as costas expostas.", slots: FULLBACKS, mods: { attack: 0.4, defense: -0.45, create: 1.3, header: 0.015, drain: 1.08 } },
  // wing-backs
  { id: "wb_defensive", label: "Ala defensivo", description: "Prioriza a linha defensiva.", slots: WINGBACKS, mods: { defense: 0.45, attack: -0.35 } },
  { id: "wb", label: "Ala", description: "Dá largura a todo o corredor.", slots: WINGBACKS, mods: {} },
  { id: "wb_attacking", label: "Ala ofensivo", description: "Joga quase como extremo. Desgasta muito.", slots: WINGBACKS, mods: { attack: 0.45, defense: -0.5, create: 1.3, header: 0.015, drain: 1.1 } },
  // defensive midfield
  { id: "dm_anchor", label: "Trinco", description: "Protege a defesa e corta linhas de passe.", slots: ["DM"], mods: { defense: 0.5, control: -0.3 } },
  { id: "dm", label: "Médio defensivo", description: "Equilíbrio entre recuperar e distribuir.", slots: ["DM"], mods: {} },
  { id: "dm_playmaker", label: "Organizador recuado", description: "Dita o ritmo a partir de trás.", slots: ["DM"], mods: { control: 0.5, defense: -0.35, create: 1.25 } },
  // central midfield
  { id: "cm_defensive", label: "Médio de cobertura", description: "Fica atrás da linha da bola.", slots: ["CM"], mods: { defense: 0.4, attack: -0.35, shot: 0.7 } },
  { id: "cm", label: "Box-to-box", description: "Defende e chega à área.", slots: ["CM"], mods: {} },
  { id: "cm_playmaker", label: "Organizador", description: "Pede a bola e distribui.", slots: ["CM"], mods: { control: 0.45, attack: -0.2, create: 1.3 } },
  { id: "cm_attacking", label: "Médio ofensivo", description: "Pisa a área e remata.", slots: ["CM"], mods: { attack: 0.4, defense: -0.4, shot: 1.4 } },
  // attacking midfield
  { id: "am", label: "Médio ofensivo", description: "Liga o meio-campo ao ataque.", slots: ["AM"], mods: {} },
  { id: "am_creator", label: "Criativo", description: "Procura o último passe.", slots: ["AM"], mods: { control: 0.3, create: 1.4, shot: 0.8 } },
  { id: "am_shadow", label: "Segundo avançado", description: "Ataca a área como avançado.", slots: ["AM"], mods: { attack: 0.45, control: -0.3, shot: 1.5, oneOnOne: 0.01 } },
  // wide midfield
  { id: "wm_defensive", label: "Ala de apoio", description: "Ajuda o lateral e fecha por dentro.", slots: WIDE_MIDS, mods: { defense: 0.4, attack: -0.35 } },
  { id: "wm", label: "Médio ala", description: "Dá largura e trabalha nos dois sentidos.", slots: WIDE_MIDS, mods: {} },
  { id: "wm_winger", label: "Extremo", description: "Fica aberto e cruza.", slots: WIDE_MIDS, mods: { attack: 0.3, defense: -0.3, header: 0.02, create: 1.15 } },
  { id: "wm_inverted", label: "Interior", description: "Flete para dentro para rematar ou combinar.", slots: WIDE_MIDS, mods: { attack: 0.2, control: 0.1, defense: -0.3, shot: 1.4, header: -0.015, outside: 0.02 } },
  // wingers
  { id: "w_defensive", label: "Extremo de apoio", description: "Baixa para ajudar a defender.", slots: WINGERS, mods: { defense: 0.45, attack: -0.4, drain: 1.08 } },
  { id: "w", label: "Extremo", description: "Desequilibra no 1x1 e cruza.", slots: WINGERS, mods: {} },
  { id: "w_inside", label: "Avançado interior", description: "Corta para dentro e remata.", slots: WINGERS, mods: { attack: 0.25, shot: 1.5, header: -0.02, create: 0.8, outside: 0.02 } },
  // strikers
  { id: "st", label: "Ponta de lança", description: "Finalizador completo.", slots: ["ST"], mods: {} },
  { id: "st_target", label: "Pivô", description: "Segura a bola de costas e ganha no ar.", slots: ["ST"], mods: { control: 0.2, header: 0.03, oneOnOne: -0.015 } },
  { id: "st_false9", label: "Falso 9", description: "Baixa para criar. Remata menos, os colegas mais.", slots: ["ST"], mods: { control: 0.45, attack: -0.15, shot: 0.6, create: 1.5 } },
  { id: "st_runner", label: "Avançado de profundidade", description: "Ataca o espaço nas costas da defesa.", slots: ["ST"], mods: { attack: 0.2, control: -0.25, oneOnOne: 0.025, offside: 1.3 } },
];

export const ROLE_BY_ID: Record<string, RoleDef> = Object.fromEntries(ROLES.map((r) => [r.id, r]));

/** Default (neutral) role per slot. */
export const DEFAULT_ROLE: Record<Slot, string> = {
  GK: "gk", CB: "cb", LB: "fb", RB: "fb", LWB: "wb", RWB: "wb", DM: "dm", CM: "cm", AM: "am",
  LM: "wm", RM: "wm", LW: "w", RW: "w", ST: "st",
};

export const rolesForSlot = (slot: Slot): RoleDef[] => ROLES.filter((r) => r.slots.includes(slot));

/** Role valid for the slot, else the slot default. */
export function resolveRole(slot: Slot, role: string | null | undefined): RoleDef {
  const r = role ? ROLE_BY_ID[role] : undefined;
  return r && r.slots.includes(slot) ? r : ROLE_BY_ID[DEFAULT_ROLE[slot]];
}
