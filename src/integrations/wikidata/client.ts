/**
 * Minimal Wikidata client (official APIs only: wbsearchentities + SPARQL endpoint; data is CC0).
 * Polite by default: one request at a time, ≥1.1 s apart, descriptive User-Agent (Wikimedia policy).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ColourStatement, WdClub } from "./colours";
import type { WdPerson } from "./match";

const API = "https://www.wikidata.org/w/api.php";
const SPARQL = "https://query.wikidata.org/sparql";
const ENWIKI = "https://en.wikipedia.org/w/api.php";
const FOOTBALL_CLUB = "Q476028";
const FOOTBALL_LEAGUE = "Q15991303";
const LABEL_LANGS = `"en","pt","es","fr","de","it","nl","no","nb","mul"`;
const isQid = (q: string) => /^Q\d+$/.test(q);
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Dataset countries vs Wikidata's "country" (P17): the home nations are "United Kingdom" on Wikidata. */
const UK = new Set(["england", "scotland", "wales", "northern ireland", "united kingdom", "uk", "great britain"]);
export const countryKey = (c: string) => (UK.has(fold(c)) ? "united kingdom" : fold(c));
const leagueWords = (s: string) => fold(s).split(" ").filter(Boolean); // keep "a"/"b"/"2": they tell tiers apart
interface WdClaim { rank: "preferred" | "normal" | "deprecated"; mainsnak?: { datavalue?: { value?: unknown } } }
interface WdEntity { claims?: Record<string, WdClaim[]>; labels?: Record<string, { value: string }>; sitelinks?: Record<string, { title: string }> }
const itemId = (c: WdClaim) => (c.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id ?? "";
const qidOf = (uri: string) => uri.split("/").pop()!;

export interface CacheOptions { dir: string; ttlMs: number }

export class WikidataClient {
  private last = 0;
  requests = 0;
  cacheHits = 0;
  /** cache: optional on-disk cache of successful responses (re-runs don't hit Wikidata again). */
  constructor(
    private ua = `TouchlineAgeImport/1.0 (${process.env.WIKIDATA_CONTACT ?? "https://github.com/"}; private football game)`,
    private gapMs = 1100,
    private cache?: CacheOptions,
  ) {}

  private async get(url: string, accept: string): Promise<unknown> {
    const file = this.cache ? path.join(this.cache.dir, `${createHash("sha256").update(url).digest("hex").slice(0, 32)}.json`) : null;
    if (file) {
      const s = await stat(file).catch(() => null);
      if (s && Date.now() - s.mtimeMs < this.cache!.ttlMs) {
        this.cacheHits++;
        return JSON.parse(await readFile(file, "utf8"));
      }
    }
    const body = await this.fetchJson(url, accept);
    if (file) {
      await mkdir(this.cache!.dir, { recursive: true });
      await writeFile(file, JSON.stringify(body));
    }
    return body;
  }

  private async fetchJson(url: string, accept: string): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = this.last + this.gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      this.requests++;
      const res = await fetch(url, { headers: { "User-Agent": this.ua, Accept: accept }, signal: AbortSignal.timeout(65_000) });
      if (res.status === 429 || res.status >= 500) {
        const retry = Number(res.headers.get("retry-after") ?? 0) * 1000 || 2000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, retry));
        continue;
      }
      if (!res.ok) throw new Error(`wikidata ${res.status} for ${url.slice(0, 120)}`);
      return res.json();
    }
    throw new Error("wikidata: too many retries");
  }

  private sparql(q: string) {
    return this.get(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`, "application/sparql-results+json") as Promise<{ results: { bindings: Record<string, { value: string }>[] } }>;
  }

  /** Football-club item for a club name (first search hit that is an association football club). */
  async findClub(name: string): Promise<string | null> {
    const s = (await this.get(`${API}?action=wbsearchentities&format=json&type=item&limit=8&language=en&uselang=en&search=${encodeURIComponent(name)}`, "application/json")) as { search?: { id: string }[] };
    const ids = (s.search ?? []).map((x) => x.id).filter((id) => /^Q\d+$/.test(id));
    if (!ids.length) return null;
    const r = await this.sparql(`SELECT ?c WHERE { VALUES ?c { ${ids.map((i) => `wd:${i}`).join(" ")} } ?c wdt:P31/wdt:P279* wd:Q476028 . }`);
    const ok = new Set(r.results.bindings.map((b) => b.c.value.split("/").pop()!));
    return ids.find((i) => ok.has(i)) ?? null;
  }

  private async search(text: string): Promise<string[]> {
    const s = (await this.get(`${API}?action=wbsearchentities&format=json&type=item&limit=10&language=en&uselang=en&search=${encodeURIComponent(text)}`, "application/json")) as { search?: { id: string }[] };
    return (s.search ?? []).map((x) => x.id).filter(isQid);
  }

  /** Full-text search (labels, aliases, descriptions) restricted to football leagues — finds "Campeonato Brasileiro Série A" for "Série A". */
  private async searchLeagues(text: string): Promise<string[]> {
    const q = `${text} haswbstatement:P31=${FOOTBALL_LEAGUE}`;
    const s = (await this.get(`${API}?action=query&list=search&format=json&srlimit=20&srsearch=${encodeURIComponent(q)}`, "application/json")) as { query?: { search?: { title: string }[] } };
    return (s.query?.search ?? []).map((x) => x.title).filter(isQid);
  }

  /**
   * Football-league item for a dataset league name. Candidates from prefix and full-text search (also without a leading
   * country word: "Brazil Série A" → "Série A"), kept if they are football leagues. When the dataset knows the country,
   * the league's country must match (England/Scotland/Wales → United Kingdom); never picks a league from another
   * country. Returns the choice and the candidates so the CLI can report instead of guessing.
   */
  async findLeague(name: string, country: string | null): Promise<{ qid: string | null; candidates: { qid: string; label: string; country: string }[] }> {
    const queries = [name, name.replace(/^\S+\s+/, "")].filter((q, i, a) => q.length > 2 && a.indexOf(q) === i);
    const found: string[] = [];
    for (const q of queries) found.push(...(await this.search(q)), ...(await this.searchLeagues(q))); // sequential
    const ids = [...new Set(found)];
    if (!ids.length) return { qid: null, candidates: [] };
    const r = await this.sparql(`
SELECT ?l ?label ?alias ?countryLabel WHERE {
  VALUES ?l { ${ids.map((i) => `wd:${i}`).join(" ")} }
  ?l wdt:P31/wdt:P279* wd:${FOOTBALL_LEAGUE} .
  OPTIONAL { ?l rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?l skos:altLabel|rdfs:label ?alias . FILTER(LANG(?alias) IN (${LABEL_LANGS})) }
  OPTIONAL { ?l wdt:P17 ?country . ?country rdfs:label ?countryLabel . FILTER(LANG(?countryLabel) = "en") }
}`);
    // one row per (label, alias, country) combination: merge them
    const seen = new Map<string, { qid: string; label: string; country: string; names: Set<string> }>();
    for (const b of r.results.bindings) {
      const qid = qidOf(b.l.value);
      const cur = seen.get(qid) ?? { qid, label: "", country: "", names: new Set<string>() };
      cur.label ||= b.label?.value ?? "";
      cur.country ||= b.countryLabel?.value ?? "";
      for (const n of [b.label?.value, b.alias?.value]) if (n) cur.names.add(n);
      seen.set(qid, cur);
    }
    const all = ids.map((i) => seen.get(i)).filter((c): c is NonNullable<typeof c> => !!c); // search order = relevance
    const candidates = all.map(({ qid, label, country: c }) => ({ qid, label, country: c }));
    // without a country only an unambiguous single candidate is accepted
    if (!country) return { qid: all.length === 1 ? all[0].qid : null, candidates };
    const pool = all.filter((c) => countryKey(c.country) === countryKey(country));
    if (pool.length <= 1) return { qid: pool[0]?.qid ?? null, candidates };
    // several leagues (tiers, women's, defunct, the organiser): best label/alias match with the dataset name,
    // an exact name/alias match wins outright ("Segunda Liga" is an alias of "Liga Portugal 2")
    const wanted = leagueWords(name);
    const exact = (n: string) => leagueWords(n).join(" ") === wanted.join(" ");
    const score = (c: (typeof all)[number]) => (c.label && exact(c.label) ? 200 : 0) || Math.max(...[...c.names].map((n) => {
      if (exact(n)) return 100; // alias match ("Segunda Liga" → Liga Portugal 2)
      const w = leagueWords(n);
      return w.filter((x) => wanted.includes(x)).length - 0.1 * w.length;
    }));
    const ranked = [...pool].sort((a, b) => score(b) - score(a)); // stable: ties keep search relevance order
    // a clear winner, or an exact name match where search relevance breaks the tie (league vs. its organiser body)
    const ok = score(ranked[0]) > score(ranked[1]) || score(ranked[0]) >= 100;
    return { qid: ok ? ranked[0].qid : null, candidates };
  }

  /** Countries (P17) of an item, as QIDs. */
  async countriesOf(qid: string): Promise<string[]> {
    const e = (await this.entities([qid], "claims"))[qid];
    return (e?.claims?.P17 ?? []).filter((c) => c.rank !== "deprecated").map(itemId).filter(isQid);
  }

  /**
   * Fallback for a club missing from the league's member list (no P118 statement): name search, accepted only when
   * the hit is a football club in the same country as the league.
   */
  async findClubInCountry(name: string, countryQids: string[]): Promise<string | null> {
    if (!countryQids.length) return null;
    const qid = await this.findClub(name);
    if (!qid) return null;
    const theirs = await this.countriesOf(qid);
    return theirs.some((c) => countryQids.includes(c)) ? qid : null;
  }

  /** Every football club that has a "league" (P118) statement for the league, with labels and aliases. */
  async leagueClubs(leagueQid: string): Promise<WdClub[]> {
    if (!isQid(leagueQid)) throw new Error("bad qid");
    const r = await this.sparql(`
SELECT ?c ?label (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases) WHERE {
  ?c wdt:P118 wd:${leagueQid} .
  ?c wdt:P31/wdt:P279* wd:${FOOTBALL_CLUB} .
  OPTIONAL { ?c rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?c skos:altLabel|rdfs:label ?alias . FILTER(LANG(?alias) IN (${LABEL_LANGS})) }
} GROUP BY ?c ?label`);
    return r.results.bindings.map((b) => ({ qid: qidOf(b.c.value), label: b.label?.value ?? "", aliases: b.aliases?.value ? b.aliases.value.split("|") : [] }));
  }

  /** wbgetentities in batches of 50 (the API maximum): one request per 50 items. */
  private async entities(ids: string[], props: string): Promise<Record<string, WdEntity>> {
    const out: Record<string, WdEntity> = {};
    const valid = [...new Set(ids.filter(isQid))];
    for (let i = 0; i < valid.length; i += 50) {
      const batch = valid.slice(i, i + 50);
      const r = (await this.get(`${API}?action=wbgetentities&format=json&props=${props}&languages=en&sitefilter=enwiki&ids=${batch.join("|")}`, "application/json")) as { entities?: typeof out };
      Object.assign(out, r.entities ?? {});
    }
    return out;
  }

  /**
   * "Official color" (P6364) statements per club, in the order shown on the item, plus each colour's sRGB hex (P465)
   * and English label. Two batched calls per 50 clubs, regardless of how many colours they have.
   */
  async clubColours(clubQids: string[]): Promise<{ statements: Map<string, ColourStatement[]>; hex: Map<string, string>; names: Map<string, string>; enwiki: Map<string, string> }> {
    const clubs = await this.entities(clubQids, "claims|sitelinks");
    const statements = new Map<string, ColourStatement[]>();
    const enwiki = new Map<string, string>();
    for (const [qid, e] of Object.entries(clubs)) {
      if (e.sitelinks?.enwiki?.title) enwiki.set(qid, e.sitelinks.enwiki.title);
      statements.set(qid, (e.claims?.P6364 ?? [])
        .map((c) => ({ qid: itemId(c), rank: c.rank }))
        .filter((s): s is ColourStatement => isQid(s.qid)));
    }
    const colourIds = [...new Set([...statements.values()].flat().map((s) => s.qid))];
    const colours = await this.entities(colourIds, "claims|labels");
    const hex = new Map<string, string>(), names = new Map<string, string>();
    for (const [qid, e] of Object.entries(colours)) {
      const v = e.claims?.P465?.find((c) => c.rank !== "deprecated")?.mainsnak?.datavalue?.value;
      if (typeof v === "string") hex.set(qid, v);
      if (e.labels?.en?.value) names.set(qid, e.labels.en.value);
    }
    return { statements, hex, names, enwiki };
  }

  /** Wikitext of the lead section (where the infobox lives) of an English Wikipedia article — small, cacheable. */
  async wikipediaLead(title: string): Promise<string> {
    const r = (await this.get(`${ENWIKI}?action=parse&prop=wikitext&section=0&redirects=1&format=json&formatversion=2&page=${encodeURIComponent(title)}`, "application/json")) as { parse?: { wikitext?: string } };
    return r.parse?.wikitext ?? "";
  }

  /** People with a "member of sports team" statement for the club still open or ended since `sinceYear`. */
  async squad(clubQid: string, sinceYear: number): Promise<WdPerson[]> {
    if (!/^Q\d+$/.test(clubQid)) throw new Error("bad qid");
    const r = await this.sparql(`
SELECT ?p ?label ?dob ?prec (GROUP_CONCAT(DISTINCT ?alias; separator="|") AS ?aliases) WHERE {
  ?p p:P54 ?st . ?st ps:P54 wd:${clubQid} .
  OPTIONAL { ?st pq:P582 ?end }
  FILTER(!BOUND(?end) || YEAR(?end) >= ${Math.floor(sinceYear)})
  ?p p:P569/psv:P569 [ wikibase:timeValue ?dob ; wikibase:timePrecision ?prec ] .
  OPTIONAL { ?p rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?p skos:altLabel|rdfs:label ?alias . FILTER(LANG(?alias) IN ("en","pt","es","fr","de","it","nl","mul")) }
} GROUP BY ?p ?label ?dob ?prec`);
    const by = new Map<string, WdPerson>();
    for (const b of r.results.bindings) {
      const qid = b.p.value.split("/").pop()!;
      const cur = by.get(qid) ?? { qid, label: b.label?.value ?? "", aliases: [], dobs: [] };
      cur.aliases = [...new Set([...cur.aliases, ...(b.aliases?.value ? b.aliases.value.split("|") : [])])];
      cur.dobs.push({ date: b.dob.value.slice(0, 10), precision: Number(b.prec.value) });
      by.set(qid, cur);
    }
    return [...by.values()];
  }
}
