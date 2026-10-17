/**
 * UI v2 guards: theme tokens keep AA contrast in both themes, hub routing covers every route, and the command
 * palette search is accent-insensitive.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rankPalette, type PaletteItem } from "./palette-search";
import { hubs, locate } from "./hubs";

function block(css: string, selector: RegExp): Record<string, string> {
  const m = selector.exec(css);
  if (!m) throw new Error(`no block for ${selector}`);
  const body = css.slice(m.index + m[0].length, css.indexOf("}", m.index));
  return Object.fromEntries([...body.matchAll(/--tl-([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((x) => [x[1], x[2]]));
}
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
    .reduce((s, c, i) => s + c * [0.2126, 0.7152, 0.0722][i], 0);
};
const ratio = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe("theme tokens", () => {
  const css = readFileSync(path.resolve("src/app/globals.css"), "utf8");
  const themes = { dark: block(css, /\[data-theme="dark"\]\s*\{/), light: block(css, /\[data-theme="light"\]\s*\{/) };
  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: text colours pass AA (4.5:1) on every surface`, () => {
      for (const fg of ["ink", "muted", "faint", "accent", "up", "down", "warn", "info", "gold"]) {
        for (const bg of ["bg", "surface", "surface-2"]) {
          expect(ratio(t[fg], t[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(ratio(t["accent-ink"], t.accent), "accent-ink on accent").toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("hubs", () => {
  const base = "/g/abc";
  const all = hubs(true);
  it("every page route belongs to exactly one hub", () => {
    const keys = all.flatMap((h) => h.tabs.map((t) => t.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of ["", "/week", "/squad", "/tactics", "/fixtures", "/market", "/club", "/finances", "/table", "/news", "/cup", "/social", "/history", "/settings"]) {
      expect(keys).toContain(r);
    }
  });
  it("locates nested pages", () => {
    expect(locate(`${base}/matches/x`, base, all).hub.id).toBe("jogo");
    expect(locate(`${base}/players/x`, base, all).hub.id).toBe("equipa");
    expect(locate(`${base}/finances`, base, all)).toMatchObject({ tabHref: `${base}/finances` });
    expect(locate(base, base, all)).toMatchObject({ tabHref: base });
    expect(locate(`${base}/clubhouse`, base, all).hub.id).toBe("hoje"); // no false prefix match on /club
  });
});

describe("command palette", () => {
  const items: PaletteItem[] = [
    { id: "1", group: "Ecrãs", label: "Clube › Finanças", href: "/f", keywords: "dinheiro saldo" },
    { id: "2", group: "Ecrãs", label: "Liga › Tabela", href: "/t", keywords: "classificação" },
    { id: "3", group: "Plantel", label: "Saulo Bavel", href: "/p", keywords: "ATT" },
  ];
  it("ignores accents and case and searches keywords", () => {
    expect(rankPalette(items, "financas").map((i) => i.id)).toEqual(["1"]);
    expect(rankPalette(items, "CLASSIFICACAO").map((i) => i.id)).toEqual(["2"]);
    expect(rankPalette(items, "saulo").map((i) => i.id)).toEqual(["3"]);
  });
  it("hides players until the user types", () => {
    expect(rankPalette(items, "").map((i) => i.id)).toEqual(["1", "2"]);
  });
});
