/**
 * Validation for scripts/catalog/colour-estimates.json — club colours estimated by hand for clubs with no usable data
 * on Wikidata or Wikipedia. Stored as colors_source.provider = "estimate": the Wikidata colours tool replaces them as
 * soon as it finds sourced colours, and they never replace sourced or manual colours.
 */
import { distinct, toHex } from "../wikidata/colours";

export interface ColourEstimate { league: string; club: string; primary: string; secondary: string; confidence: "high" | "medium" | "low" }

/** Providers an estimate must never overwrite (sourced data, or a human's explicit choice). */
export const PROTECTED_PROVIDERS = new Set(["wikidata", "wikipedia_infobox", "parent_club", "manual"]);

/** Throws on the first problem: malformed hex, unknown confidence, duplicate club, or an unreadable colour pair. */
export function validateEstimates(raw: unknown): ColourEstimate[] {
  const list = (raw as { clubs?: unknown })?.clubs;
  if (!Array.isArray(list)) throw new Error("estimates: expected { clubs: [...] }");
  const seen = new Set<string>();
  return list.map((e: Record<string, unknown>, i) => {
    const where = `estimates[${i}] ${String(e.club)}`;
    const primary = toHex(String(e.primary ?? "")), secondary = toHex(String(e.secondary ?? ""));
    if (typeof e.league !== "string" || !e.league || typeof e.club !== "string" || !e.club) throw new Error(`${where}: league and club are required`);
    if (!primary || !secondary) throw new Error(`${where}: primary/secondary must be #rrggbb`);
    if (!["high", "medium", "low"].includes(String(e.confidence))) throw new Error(`${where}: confidence must be high|medium|low`);
    if (!distinct(primary, secondary)) throw new Error(`${where}: primary and secondary are indistinguishable`);
    const key = `${e.league}|${e.club}`;
    if (seen.has(key)) throw new Error(`${where}: duplicate`);
    seen.add(key);
    return { league: e.league, club: e.club, primary, secondary, confidence: e.confidence as ColourEstimate["confidence"] };
  });
}
