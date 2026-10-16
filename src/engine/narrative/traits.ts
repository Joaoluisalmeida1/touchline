/**
 * traits-v1: one personality trait per player, derived only from the player's id (no stored column, no randomness at
 * read time). Traits are fiction layered on top of the dataset — they never claim anything about the real person —
 * and only drive which Gabinete events can happen and how a player reacts.
 */
import { createRng } from "../common/rng";

export const TRAITS_VERSION = "traits-v1";

export type Trait = "professional" | "quiet" | "ambitious" | "loyal" | "temperamental" | "party" | "leader";

export const TRAIT_INFO: Record<Trait, { label: string; hint: string; weight: number }> = {
  professional: { label: "Profissional", hint: "Treina bem, raramente dá problemas.", weight: 20 },
  quiet: { label: "Reservado", hint: "Discreto; não gosta de holofotes.", weight: 18 },
  ambitious: { label: "Ambicioso", hint: "Quer jogar sempre e ouve propostas.", weight: 15 },
  loyal: { label: "Leal", hint: "Ligado ao clube; segura o balneário nos maus momentos.", weight: 14 },
  temperamental: { label: "Temperamental", hint: "Reage mal à crítica e ao banco.", weight: 12 },
  party: { label: "Boémio", hint: "Gosta da noite — às vezes demais.", weight: 11 },
  leader: { label: "Líder", hint: "Fala no balneário; a moral da equipa ouve-o.", weight: 10 },
};

const ALL = Object.keys(TRAIT_INFO) as Trait[];

export function traitOf(playerId: string): Trait {
  return createRng(`${TRAITS_VERSION}|${playerId}`).pickWeighted(ALL, (t) => TRAIT_INFO[t].weight);
}
