import { describe, expect, it } from "vitest";
import { birthDateOf, matchSquad, normName, type WdPerson } from "./match";

const P = (qid: string, label: string, dob = "1995-03-04", aliases: string[] = [], precision = 11): WdPerson => ({ qid, label, aliases, dobs: [{ date: dob, precision }] });
const asOf = new Date("2026-08-01T00:00:00Z");

describe("wikidata matching", () => {
  it("normalises accents and punctuation", () => {
    expect(normName("João Mário-Neto")).toBe("joao mario neto");
    expect(normName("Ødegaard")).toBe("odegaard");
  });
  it("matches exact names, token subsets and mononyms; skips ambiguity", () => {
    const squad = [P("Q1", "Rafael Leão", "1999-06-10"), P("Q2", "Pedro Gonçalves", "1998-06-28", ["Pote"]), P("Q3", "João Silva"), P("Q4", "Ricardo Silva"), P("Q5", "Pepe", "1983-02-26")];
    const r = matchSquad([
      { id: "a", name: "Rafael Leao" }, { id: "b", name: "Pote" }, { id: "c", name: "Silva" },
      { id: "e", name: "Pepe" }, { id: "f", name: "Ninguém Conhecido" },
    ], squad, asOf);
    const by = new Map(r.map((x) => [x.id, x]));
    expect(by.get("a")).toMatchObject({ status: "matched", qid: "Q1", birth_date: "1999-06-10", by: "exact" });
    expect(by.get("b")).toMatchObject({ status: "matched", qid: "Q2", by: "exact" });
    expect(by.get("c")?.status).toBe("no_match"); // single surname shared by two people is never taken
    expect(by.get("e")).toMatchObject({ status: "matched", qid: "Q5", birth_date: "1983-02-26" });
    expect(matchSquad([{ id: "d", name: "Pedro António Gonçalves" }], squad, asOf)[0]).toMatchObject({ status: "matched", qid: "Q2", by: "tokens" });
    expect(matchSquad([{ id: "g", name: "Velho" }], [P("Q7", "Velho", "1970-01-01")], asOf)[0].status).toBe("bad_date");
    expect(by.get("f")?.status).toBe("no_match");
  });
  it("rejects coarse or conflicting dates and homonym claims", () => {
    expect(birthDateOf(P("Q", "x", "1995-01-01", [], 9))).toBeNull();
    expect(birthDateOf({ qid: "Q", label: "x", aliases: [], dobs: [{ date: "1995-01-01", precision: 11 }, { date: "1996-02-02", precision: 11 }] })).toBeNull();
    const r = matchSquad([{ id: "a", name: "Bruno Costa" }, { id: "b", name: "Bruno Costa" }], [P("Q9", "Bruno Costa")], asOf);
    expect(r.every((x) => x.status === "ambiguous")).toBe(true);
  });
});
