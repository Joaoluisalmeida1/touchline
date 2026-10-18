import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { validateEstimates } from "./colour-estimates";

const one = (over: Record<string, unknown> = {}) => ({ clubs: [{ league: "94", club: "Moreirense", primary: "#00843d", secondary: "#ffffff", confidence: "high", ...over }] });

describe("validateEstimates", () => {
  it("accepts the committed estimates file", () => {
    const list = validateEstimates(JSON.parse(readFileSync("scripts/catalog/colour-estimates.json", "utf8")));
    expect(list.length).toBeGreaterThan(50);
  });

  it("normalises hex and rejects malformed values", () => {
    expect(validateEstimates(one({ primary: "00843D" }))[0].primary).toBe("#00843d");
    expect(() => validateEstimates(one({ primary: "green" }))).toThrow(/#rrggbb/);
    expect(() => validateEstimates(one({ secondary: "url(javascript:x)" }))).toThrow(/#rrggbb/);
  });

  it("rejects unreadable pairs, unknown confidence and duplicates", () => {
    expect(() => validateEstimates(one({ secondary: "#00843e" }))).toThrow(/indistinguishable/);
    expect(() => validateEstimates(one({ confidence: "sure" }))).toThrow(/confidence/);
    const dup = { clubs: [...one().clubs, ...one().clubs] };
    expect(() => validateEstimates(dup)).toThrow(/duplicate/);
  });
});
