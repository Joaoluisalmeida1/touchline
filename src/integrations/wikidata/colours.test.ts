import { describe, expect, it } from "vitest";
import { coloursFromKit, contrast, kitShade, matchClubs, parentName, parseInfoboxKit, pickColours, toHex, type WdClub } from "./colours";

const wd = (qid: string, label: string, aliases: string[] = []): WdClub => ({ qid, label, aliases });

describe("matchClubs", () => {
  const league = [
    wd("Q1", "S.L. Benfica", ["Sport Lisboa e Benfica"]), wd("Q2", "S.L. Benfica B"), wd("Q3", "FC Porto"),
    wd("Q4", "Inter Milan", ["FC Internazionale Milano"]), wd("Q5", "AC Milan"), wd("Q6", "FC Schalke 04"),
    wd("Q7", "Vitória S.C.", ["Vitória de Guimarães"]), wd("Q8", "Vitória F.C.", ["Vitória de Setúbal"]),
  ];
  const m = (name: string) => matchClubs([{ id: "x", name }], league)[0];

  it("ignores legal-form words, punctuation and accents", () => {
    expect(m("Benfica")).toMatchObject({ status: "matched", qid: "Q1", by: "exact" });
    expect(m("Porto")).toMatchObject({ status: "matched", qid: "Q3" });
    expect(m("Schalke 04")).toMatchObject({ status: "matched", qid: "Q6" });
    expect(m("Vitoria SC")).toMatchObject({ status: "matched", qid: "Q7" });
  });

  it("keeps reserve teams apart from the first team", () => {
    expect(m("Benfica B")).toMatchObject({ status: "matched", qid: "Q2" });
  });

  it("matches short names by token containment, but only when unique", () => {
    expect(m("Inter")).toMatchObject({ status: "matched", qid: "Q4", by: "tokens" });
    expect(m("Milan")).toMatchObject({ status: "matched", qid: "Q5", by: "exact" }); // "AC Milan" minus filler, not Inter Milan
    expect(m("Vitória").status).toBe("ambiguous"); // Guimarães or Setúbal
    expect(m("Feirense").status).toBe("no_match");
  });

  it("uses filler words to separate clubs that only differ by them", () => {
    expect(m("Vitória FC")).toMatchObject({ status: "matched", qid: "Q8" });
    expect(m("1. FC Schalke 04")).toMatchObject({ status: "matched", qid: "Q6" }); // dots and numbers
  });

  it("drops a match when two dataset clubs claim the same item", () => {
    const r = matchClubs([{ id: "a", name: "Benfica" }, { id: "b", name: "SL Benfica" }], league);
    expect(r.map((x) => x.status)).toEqual(["ambiguous", "ambiguous"]);
  });
});

describe("pickColours", () => {
  const hex = new Map([["red", "#ff0000"], ["white", "#ffffff"], ["black", "#000000"], ["claret", "#800032"], ["sky", "#77b5fe"], ["offwhite", "#fcfaf5"]]);
  const s = (qid: string, rank: "preferred" | "normal" | "deprecated" = "normal") => ({ qid, rank });

  it("keeps item order, maps pure web colours to kit shades and keeps specific shades", () => {
    expect(pickColours([s("red"), s("white")], hex)).toEqual({ primary: "#c8102e", secondary: "#ffffff", all: ["#c8102e", "#ffffff"] });
    expect(pickColours([s("white"), s("black")], hex)?.primary).toBe("#ffffff"); // Real Madrid / Juventus: white first
    expect(pickColours([s("claret"), s("sky")], hex)).toMatchObject({ primary: "#800032", secondary: "#77b5fe" });
  });

  it("puts preferred rank first and ignores deprecated statements", () => {
    expect(pickColours([s("white"), s("red", "preferred"), s("black", "deprecated")], hex)?.all).toEqual(["#c8102e", "#ffffff"]);
  });

  it("chooses a readable secondary when the next colour is indistinguishable or missing", () => {
    expect(pickColours([s("white"), s("offwhite")], hex)?.secondary).toBe("#111827");
    expect(pickColours([s("red")], hex)?.secondary).toBe("#ffffff");
    expect(pickColours([], hex)).toBeNull();
    expect(pickColours([s("unknown")], hex)).toBeNull();
  });
});

describe("Wikipedia infobox kit", () => {
  const box = (fields: Record<string, string>) => `{{Infobox football club\n${Object.entries(fields).map(([k, v]) => `| ${k} = ${v}`).join("\n")}\n}}`;

  it("uses body then shorts for plain kits", () => {
    const kit = parseInfoboxKit(box({ body1: "FF0000", shorts1: "FFFFFF", socks1: "FF0000", pattern_b1: "" }))!;
    expect(coloursFromKit(kit)).toMatchObject({ primary: "#c8102e", secondary: "#ffffff" });
  });

  it("does not trust a white body drawn under a pattern image: shorts/socks carry the colour", () => {
    const rioAve = parseInfoboxKit(box({ pattern_b1: "_rioave2627h", body1: "FFFFFF", shorts1: "007711", socks1: "007711" }))!;
    expect(coloursFromKit(rioAve)).toMatchObject({ primary: "#007711", secondary: "#ffffff" });
    const allWhite = parseInfoboxKit(box({ pattern_b1: "_x", body1: "FFFFFF", shorts1: "FFFFFF", socks1: "FFFFFF" }))!;
    expect(coloursFromKit(allWhite)).toBeNull();
  });

  it("returns null without kit fields", () => {
    expect(parseInfoboxKit("{{Infobox football club | name = X }}")).toBeNull();
  });
});

describe("helpers", () => {
  it("toHex normalises and rejects junk", () => {
    expect(toHex("FF0000")).toBe("#ff0000");
    expect(toHex("#f00")).toBe("#ff0000");
    expect(toHex("red")).toBeNull();
    expect(toHex(undefined)).toBeNull();
  });

  it("kitShade maps exact and near-pure web colours only", () => {
    expect(kitShade("#ff0000")).toBe("#c8102e");
    expect(kitShade("#fe0000")).toBe("#c8102e");
    expect(kitShade("#d60000")).toBe("#d60000");
    expect(kitShade("#0122eb")).toBe("#0122eb");
  });

  it("parentName recognises reserve and youth teams", () => {
    expect(parentName("Benfica B")).toBe("Benfica");
    expect(parentName("FC Porto II")).toBe("FC Porto");
    expect(parentName("Sporting U23")).toBe("Sporting");
    expect(parentName("Club Brugge")).toBeNull();
  });

  it("contrast is symmetric and maximal for black/white", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(contrast("#ffffff", "#000000")).toBe(contrast("#000000", "#ffffff"));
  });
});
