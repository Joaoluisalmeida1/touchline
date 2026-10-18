import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countryKey, WikidataClient } from "./client";

/** Fake Wikidata: prefix search, full-text search and SPARQL answers for two "Serie A" leagues and the Italian organiser. */
function fakeFetch() {
  const leagues = [
    { qid: "Q15804", label: "Serie A", names: ["Serie A"], country: "Italy" },
    { qid: "Q2427920", label: "Lega Serie A", names: ["Lega Serie A", "Serie A"], country: "Italy" },
    { qid: "Q206813", label: "Campeonato Brasileiro Série A", names: ["Campeonato Brasileiro Série A", "Brasileirão"], country: "Brazil" },
  ];
  return vi.fn(async (url: string, _init?: RequestInit) => {
    void _init;
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.includes("wbsearchentities")) return json({ search: [{ id: "Q15804" }, { id: "Q2427920" }] });
    if (url.includes("list=search")) return json({ query: { search: [{ title: "Q15804" }, { title: "Q206813" }, { title: "Q2427920" }] } });
    if (url.includes("query.wikidata.org")) {
      const bindings = leagues.flatMap((l) => l.names.map((n) => ({
        l: { value: `http://www.wikidata.org/entity/${l.qid}` }, label: { value: l.label }, alias: { value: n }, countryLabel: { value: l.country },
      })));
      return json({ results: { bindings } });
    }
    return new Response("not found", { status: 404 });
  });
}

describe("WikidataClient.findLeague", () => {
  let dir: string;
  let fetchMock: ReturnType<typeof fakeFetch>;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "wd-cache-"));
    fetchMock = fakeFetch();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });
  const client = () => new WikidataClient("test-agent", 0, { dir, ttlMs: 60_000 });

  it("never resolves a league to another country (Brazil Série A ≠ Italian Serie A)", async () => {
    expect((await client().findLeague("Brazil Série A", "Brazil")).qid).toBe("Q206813");
  });

  it("prefers the league whose label matches over an organiser that only has it as an alias", async () => {
    expect((await client().findLeague("Serie A", "Italy")).qid).toBe("Q15804");
  });

  it("returns null with the candidates when several countries match and none is given", async () => {
    const r = await client().findLeague("Série A", null);
    expect(r.qid).toBeNull();
    expect(r.candidates.map((c) => c.qid)).toEqual(expect.arrayContaining(["Q15804", "Q206813"]));
  });

  it("serves repeated requests from the disk cache", async () => {
    const a = client();
    await a.findLeague("Serie A", "Italy");
    const calls = fetchMock.mock.calls.length;
    const b = client(); // new process, same cache dir
    await b.findLeague("Serie A", "Italy");
    expect(fetchMock.mock.calls.length).toBe(calls);
    expect(b.cacheHits).toBeGreaterThan(0);
    expect(b.requests).toBe(0);
  });

  it("sends the identifying User-Agent", async () => {
    await client().findLeague("Serie A", "Italy");
    const init = fetchMock.mock.calls[0][1];
    expect((init?.headers as Record<string, string>)["User-Agent"]).toBe("test-agent");
  });
});

describe("countryKey", () => {
  it("treats the home nations as the United Kingdom, as Wikidata does", () => {
    expect(countryKey("England")).toBe("united kingdom");
    expect(countryKey("Scotland")).toBe(countryKey("United Kingdom"));
    expect(countryKey("Brasil")).not.toBe(countryKey("Brazil")); // different spellings are NOT guessed
  });
});
