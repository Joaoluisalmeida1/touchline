import "server-only";
import type { Formation, LineupInstructions, Slot, Tactics } from "@/engine/common/types";
import { DEFAULT_TACTICS, isFormation, isSlot } from "@/engine/common/types";
import type { ClubLook, PresetPayload, SquadP } from "@/components/squad/types";
import { fromLineup } from "@/components/squad/editor";
import { getClubColors, getGame, getRecentRatings, getSquad, getTacticsAndLineup } from "./queries";

/** Loads everything the squad hub needs (as the signed-in user; RLS applies). */
export async function loadSquadHub(userId: string, gameId: string) {
  const game = await getGame(userId, gameId);
  if (!game?.my_club_id) return { game, data: null };
  const clubId: string = game.my_club_id;
  const [rows, tl, recent, colors] = await Promise.all([
    getSquad(userId, gameId, clubId), getTacticsAndLineup(userId, clubId), getRecentRatings(userId, clubId, 5), getClubColors(userId, clubId),
  ]);
  const squad: SquadP[] = rows.map((p) => {
    const st = p.season_stats_json as Record<string, number> | null ?? {};
    const prof = (p.profile_json ?? {}) as Record<string, number | string>;
    const fam: Partial<Record<Slot, number>> = {};
    for (const [k, v] of Object.entries(p.position_familiarity ?? {})) if (isSlot(k)) fam[k] = Number(v);
    return {
      id: p.id, name: p.name_snapshot, group: p.position_group,
      preferred_slot: isSlot(p.preferred_slot) ? p.preferred_slot : null, preferred_slot_season: p.preferred_slot_season, familiarity: fam,
      shirt: p.shirt_number, ovr: p.current_ovr, ovr_delta: p.current_ovr - p.season_start_ovr, potential_band: p.potential_band,
      age: p.age, form: Number(p.form), fitness: p.fitness, morale: p.morale, sharpness: p.sharpness,
      injured: p.injured_matches, injury_type: p.injury_type, suspended: p.suspension_matches, listed: !!p.listed_price,
      value_cents: Number(p.market_value_cents), wage_cents: Number(p.wage_cents), contract_end: p.contract_end_season,
      stats: {
        apps: Number(st.apps ?? 0), starts: Number(st.starts ?? 0), goals: Number(st.goals ?? 0), assists: Number(st.assists ?? 0),
        minutes: Number(st.minutes ?? 0), avg: st.rated ? Math.round((Number(st.rating_sum ?? 0) / Number(st.rated)) * 100) / 100 : null,
        yellow: Number(st.yellow ?? 0), red: Number(st.red ?? 0), clean_sheets: Number(st.clean_sheets ?? 0),
      },
      recent: recent[p.id] ?? [],
      profile: {
        attack: Number(prof.attack ?? 50), defense: Number(prof.defense ?? 50), creation: Number(prof.creation ?? 50),
        physical: Number(prof.physical ?? 60), set_pieces: Number(prof.set_pieces ?? 40), keeper: Number(prof.keeper ?? 0),
        individual: !!prof.source && prof.source !== "position_default",
      },
    };
  });
  const t = tl.tactics;
  const tactics: Tactics = t ? {
    mentality: t.mentality, tempo: t.tempo, pressing: t.pressing, defensive_line: t.defensive_line, width: t.width,
    passing_directness: t.passing_directness, transitions: t.transitions,
  } : DEFAULT_TACTICS;
  const fallback: Formation = isFormation(t?.formation) ? t.formation : "4-3-3";
  const l = tl.lineup;
  const initial = fromLineup(squad, l ? { formation: l.formation, starters: l.starters_json ?? [], bench: l.bench_json ?? [] } : null,
    tactics, (l?.instructions_json ?? {}) as LineupInstructions, fallback);
  const look: ClubLook = {
    name: colors?.name_snapshot ?? "Clube", short: colors?.short_name ?? "FC",
    primary: colors?.primary_color ?? "#2d6a4f", secondary: colors?.secondary_color ?? "#e9ecef",
  };
  const presets = tl.presets.filter((pr) => isFormation((pr.payload as { formation?: string }).formation))
    .map((pr) => ({ id: pr.id, name: pr.name, payload: pr.payload as unknown as PresetPayload }));
  const locked = !!game.processing_lease_until && new Date(game.processing_lease_until) > new Date();
  return {
    game,
    data: {
      clubId, squad, look, initial, presets, locked, saved: !!l, season: Number(game.current_season ?? 1),
      serverWarnings: (l?.warnings_json ?? []) as string[],
    },
  };
}
