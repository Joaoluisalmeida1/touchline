/**
 * Minimal Wikidata client (official APIs only: wbsearchentities + SPARQL endpoint; data is CC0).
 * Polite by default: one request at a time, ≥1.1 s apart, descriptive User-Agent (Wikimedia policy).
 */
import type { WdPerson } from "./match";

const API = "https://www.wikidata.org/w/api.php";
const SPARQL = "https://query.wikidata.org/sparql";

export class WikidataClient {
  private last = 0;
  constructor(private ua = `TouchlineAgeImport/1.0 (${process.env.WIKIDATA_CONTACT ?? "https://github.com/"}; private football game)`, private gapMs = 1100) {}

  private async get(url: string, accept: string): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = this.last + this.gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
      const res = await fetch(url, { headers: { "User-Agent": this.ua, Accept: accept } });
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
