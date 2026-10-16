/**
 * Name matching between dataset players and Wikidata squad members (CC0). Conservative by design: a birth date is
 * only taken when exactly one Wikidata person matches, the date has day precision and is unambiguous, and the age is
 * plausible. Everything else stays unknown — we never guess ages for real people.
 */

export interface WdPerson { qid: string; label: string; aliases: string[]; dobs: { date: string; precision: number }[] }
export interface SourceP { id: string; name: string }
export type MatchResult =
  | { id: string; status: "matched"; qid: string; birth_date: string; by: "exact" | "tokens" | "mononym" }
  | { id: string; status: "ambiguous" | "no_match" | "bad_date"; candidates?: string[] };

export function normName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ø/gi, "o").replace(/ß/g, "ss").replace(/æ/gi, "ae")
    .toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
}
const tokens = (s: string) => normName(s).split(" ").filter((t) => t.length > 1 && !PARTICLES.has(t));
const PARTICLES = new Set(["de", "da", "do", "dos", "das", "van", "der", "den", "von", "di", "del", "la", "le", "el", "e", "y", "jr", "junior"]);

/** One birth date with day precision, or null when missing/coarse/conflicting. */
export function birthDateOf(p: WdPerson): string | null {
  const days = [...new Set(p.dobs.filter((d) => d.precision >= 11).map((d) => d.date.slice(0, 10)))];
  if (days.length !== 1 || p.dobs.some((d) => d.precision < 11 && !days[0].startsWith(d.date.slice(0, 4)))) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(days[0]) ? days[0] : null;
}

export function plausible(date: string, asOf: Date, min = 15, max = 45): boolean {
  const b = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(b.getTime())) return false;
  let age = asOf.getUTCFullYear() - b.getUTCFullYear();
  const m = asOf.getUTCMonth() - b.getUTCMonth();
  if (m < 0 || (m === 0 && asOf.getUTCDate() < b.getUTCDate())) age--;
  return age >= min && age <= max;
}

function uniq<T>(xs: T[]) { return [...new Set(xs)]; }

export function matchSquad(source: SourceP[], squad: WdPerson[], asOf: Date): MatchResult[] {
  const names = squad.map((p) => ({ p, all: uniq([p.label, ...p.aliases].filter(Boolean).map(normName)) }));
  const out: MatchResult[] = [];
  for (const s of source) {
    const n = normName(s.name);
    const st = tokens(s.name);
    let by: "exact" | "tokens" | "mononym" = "exact";
    let hits = names.filter((x) => x.all.includes(n)).map((x) => x.p);
    if (!hits.length && st.length >= 2) {
      by = "tokens";
      const last = st[st.length - 1];
      hits = names.filter((x) => x.all.some((a) => {
        const at = tokens(a);
        if (at.length < 2 || at[at.length - 1] !== last) return false;
        const A = new Set(at), S = new Set(st);
        return st.every((t) => A.has(t)) || at.every((t) => S.has(t));
      })).map((x) => x.p);
    }
    if (!hits.length && st.length === 1) {
      by = "mononym";
      hits = names.filter((x) => x.all.some((a) => tokens(a).length === 1 && tokens(a)[0] === st[0])).map((x) => x.p);
    }
    const qids = uniq(hits.map((h) => h.qid));
    if (!qids.length) { out.push({ id: s.id, status: "no_match" }); continue; }
    if (qids.length > 1) { out.push({ id: s.id, status: "ambiguous", candidates: qids }); continue; }
    const person = hits[0];
    const dob = birthDateOf(person);
    if (!dob || !plausible(dob, asOf)) { out.push({ id: s.id, status: "bad_date", candidates: qids }); continue; }
    out.push({ id: s.id, status: "matched", qid: person.qid, birth_date: dob, by });
  }
  // two dataset players claiming the same person: drop both (homonyms in the squad)
  const claimed = new Map<string, number>();
  for (const r of out) if (r.status === "matched") claimed.set(r.qid, (claimed.get(r.qid) ?? 0) + 1);
  return out.map((r) => (r.status === "matched" && claimed.get(r.qid)! > 1 ? { id: r.id, status: "ambiguous" as const, candidates: [r.qid] } : r));
}
