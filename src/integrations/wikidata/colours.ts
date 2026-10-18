/**
 * Club colours from Wikidata (CC0): matching dataset clubs to Wikidata items and turning "official color" (P6364)
 * statements into the primary/secondary hex pair the game uses. Pure functions — the network lives in client.ts.
 * Conservative like the age matcher: a club only gets colours when exactly one candidate in its league matches.
 */
export interface WdClub { qid: string; label: string; aliases: string[] }
export interface SourceClub { id: string; name: string }
export type ClubMatch =
  | { id: string; status: "matched"; qid: string; by: "exact" | "tokens" | "search" }
  | { id: string; status: "ambiguous"; candidates: string[] }
  | { id: string; status: "no_match" };

/** Legal-form and filler words that differ between providers ("SL Benfica" vs "Benfica", "FC Porto" vs "Porto"). */
const CLUB_STOPWORDS = new Set([
  "fc", "cf", "afc", "sc", "cd", "ac", "as", "ss", "ssc", "us", "rc", "rcd", "ud", "sd", "ca", "cp", "sl", "sv", "vfb", "vfl",
  "tsg", "bv", "bk", "fk", "sk", "if", "ik", "ec", "se", "cr", "fbc", "acf", "osc", "ogc", "aj", "rb", "ad", "gd", "cs", "sad",
  "club", "clube", "football", "futebol", "futbol", "calcio", "association", "de", "da", "do", "dos",
  "das", "del", "la", "el", "le", "les", "of", "the", "and", "e", "y",
]);

/** Significant tokens of a club name; keeps single letters and numbers that tell teams apart ("Benfica B", "Bayer 04"). */
export function clubTokens(name: string): string[] {
  return normClub(name).split(" ").filter((t) => t && !CLUB_STOPWORDS.has(t));
}
/** Lowercase, no diacritics, letters and digits only ("1. FC Köln" → "1 fc koln", "Schalke04" → "schalke 04"). */
export function normClub(name: string): string {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/gi, "o").replace(/ß/g, "ss").replace(/æ/gi, "ae")
    .replace(/\./g, "") // "S.L. Benfica" → "SL Benfica", "1. FC Köln" → "1 FC Köln"
    .toLowerCase().replace(/([a-z])(\d)/g, "$1 $2").replace(/[^a-z0-9]+/g, " ").trim();
}

const key = (name: string) => clubKey(name);

/** Match each dataset club against the clubs of its league on Wikidata (labels + aliases, several languages). */
export function matchClubs(source: SourceClub[], candidates: WdClub[]): ClubMatch[] {
  const names = candidates.map((c) => {
    const all = [c.label, ...c.aliases].filter(Boolean);
    return { c, full: new Set(all.map(normClub)), keys: [...new Set(all.map(key).filter(Boolean))] };
  });
  const out: ClubMatch[] = source.map((s) => {
    // full name first, filler words included: tells "Vitória SC" (Guimarães) from "Vitória FC" (Setúbal)
    const full = [...new Set(names.filter((n) => n.full.has(normClub(s.name))).map((n) => n.c.qid))];
    if (full.length === 1) return { id: s.id, status: "matched", qid: full[0], by: "exact" };
    const k = key(s.name);
    if (!k) return { id: s.id, status: "no_match" };
    const exact = [...new Set(names.filter((n) => n.keys.includes(k)).map((n) => n.c.qid))];
    if (exact.length === 1) return { id: s.id, status: "matched", qid: exact[0], by: "exact" };
    if (exact.length > 1) return { id: s.id, status: "ambiguous", candidates: exact };
    // token containment either way ("Wolves" won't match, "Wolverhampton" → "Wolverhampton Wanderers" will)
    const st = new Set(k.split(" "));
    const near = [...new Set(names.filter((n) => n.keys.some((a) => {
      const at = a.split(" ");
      return at.every((t) => st.has(t)) || [...st].every((t) => at.includes(t));
    })).map((n) => n.c.qid))];
    if (near.length === 1) return { id: s.id, status: "matched", qid: near[0], by: "tokens" };
    return near.length ? { id: s.id, status: "ambiguous", candidates: near } : { id: s.id, status: "no_match" };
  });
  // two dataset clubs claiming the same item (e.g. first team and B team both reduced to "benfica"): keep neither
  const claimed = new Map<string, number>();
  for (const r of out) if (r.status === "matched") claimed.set(r.qid, (claimed.get(r.qid) ?? 0) + 1);
  return out.map((r) => (r.status === "matched" && claimed.get(r.qid)! > 1 ? { id: r.id, status: "ambiguous" as const, candidates: [r.qid] } : r));
}

/* ------------------------------------------------------------------ colours ------------------------------------------------------------------ */

export const HEX = /^#[0-9a-f]{6}$/;

/** "FF0000" / "#ff0000" / "f00" → "#ff0000", else null. */
export function toHex(v: string | null | undefined): string | null {
  if (!v) return null;
  let h = v.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{3}$/.test(h)) h = h.split("").map((x) => x + x).join("");
  return /^[0-9a-f]{6}$/.test(h) ? `#${h}` : null;
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Wikidata's colour items carry pure web colours ("red" = #ff0000, "green" = #00ff00), which look neon next to real
 * kits. Those exact values are swapped for typical kit shades; any other hex (a specific shade) is kept as is.
 */
const KIT_SHADES: Record<string, string> = {
  "#ff0000": "#c8102e", "#0000ff": "#1e4fae", "#00ff00": "#00843d", "#008000": "#00843d", "#ffff00": "#fcd116",
  "#800080": "#5b2a86", "#ffa500": "#f47920", "#00ffff": "#00a3e0", "#ff00ff": "#c2185b", "#000080": "#1b2a4a",
  "#808080": "#8a8d8f", "#000000": "#111111",
};
/** Exact or near-pure (every channel within 10, e.g. #fe0000) web colour → kit shade; other shades unchanged. */
export function kitShade(hex: string): string {
  if (KIT_SHADES[hex]) return KIT_SHADES[hex];
  const ch = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = ch(hex);
  const near = Object.keys(KIT_SHADES).find((k) => { const [x, y, z] = ch(k); return Math.abs(r - x) <= 10 && Math.abs(g - y) <= 10 && Math.abs(b - z) <= 10; });
  return near ? KIT_SHADES[near] : hex;
}

/** A Wikidata P6364 statement as returned by wbgetentities (order = order on the item page). */
export interface ColourStatement { qid: string; rank: "preferred" | "normal" | "deprecated" }

/**
 * Primary = first colour on the item (editors list the main colour first: Real Madrid white, Benfica red), preferred
 * rank before normal, deprecated ignored. Secondary = next colour that is distinguishable from the primary; if there is
 * none, white or near-black, whichever contrasts more.
 */
export function pickColours(statements: ColourStatement[], hexByQid: Map<string, string>):
  { primary: string; secondary: string; all: string[] } | null {
  const ordered = [...statements.filter((s) => s.rank === "preferred"), ...statements.filter((s) => s.rank === "normal")];
  return fromOrdered(ordered.map((s) => hexByQid.get(s.qid)));
}

/** First colour = primary; secondary = next one distinguishable from it, else white or near-black (more contrast). */
function fromOrdered(hexes: (string | null | undefined)[]): { primary: string; secondary: string; all: string[] } | null {
  const all = [...new Set(hexes.filter((h): h is string => !!h && HEX.test(h)).map(kitShade))];
  if (!all.length) return null;
  const primary = all[0];
  const secondary = all.slice(1).find((h) => contrast(primary, h) >= 1.5)
    ?? (contrast(primary, "#ffffff") >= contrast(primary, "#111827") ? "#ffffff" : "#111827");
  return { primary, secondary, all };
}

/* ------------------------------------------------------- Wikipedia infobox kit (fallback) ------------------------------------------------------- */

export interface Kit { body: string | null; shorts: string | null; socks: string | null; patternedBody: boolean }

/** Home kit colours from the lead section of a club's English Wikipedia article ({{Infobox football club}}). */
export function parseInfoboxKit(wikitext: string): Kit | null {
  const field = (name: string) => new RegExp(`\\|\\s*${name}\\s*=\\s*([^|\\n}]*)`).exec(wikitext)?.[1]?.trim() ?? "";
  const kit = { body: toHex(field("body1")), shorts: toHex(field("shorts1")), socks: toHex(field("socks1")), patternedBody: !!field("pattern_b1") };
  return kit.body || kit.shorts || kit.socks ? kit : null;
}

/**
 * Infobox kits are drawn from a base colour plus a pattern image, so the base alone can mislead: a striped or hooped
 * shirt is often "white body + pattern" with the real colour only in the image. In that case the shorts/socks carry the
 * club colour (Rio Ave: white + green stripes, green shorts). Otherwise body = primary, shorts/socks = secondary.
 */
export function coloursFromKit(kit: Kit): { primary: string; secondary: string; all: string[] } | null {
  const isWhite = (h: string | null) => !h || luminance(h) > 0.9;
  if (kit.patternedBody && isWhite(kit.body)) {
    const accent = [kit.shorts, kit.socks].find((h) => h && !isWhite(h));
    return accent ? fromOrdered([accent, "#ffffff"]) : null;
  }
  return fromOrdered([kit.body, kit.shorts, kit.socks]);
}

/** "Benfica B" → "Benfica", "Porto II" / "Porto U23" → "Porto"; null when the name is not a reserve/youth team. */
export function parentName(name: string): string | null {
  const m = /^(.*\S)\s+(b|ii|u-?2[1-3]|sub-?2[1-3])$/i.exec(name.trim());
  return m ? m[1] : null;
}
export const clubKey = (name: string) => clubTokens(name).join(" ");
