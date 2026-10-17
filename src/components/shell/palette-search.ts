import type { ReactNode } from "react";

export interface PaletteItem { id: string; group: string; label: string; hint?: string; href?: string; keywords: string; icon?: ReactNode; run?: () => void }

/** Accent- and case-insensitive. */
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function rankPalette(items: PaletteItem[], q: string): PaletteItem[] {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return items.filter((i) => i.group !== "Plantel").slice(0, 40);
  return items
    .map((i) => {
      const label = norm(i.label), hay = `${label} ${norm(i.keywords)} ${norm(i.hint ?? "")}`;
      if (!words.every((w) => hay.includes(w))) return null;
      const score = (label.startsWith(words[0]) ? 0 : label.includes(words[0]) ? 1 : 2) + (i.group === "Plantel" ? 0.5 : 0);
      return { i, score };
    })
    .filter((x): x is { i: PaletteItem; score: number } => x !== null)
    .sort((a, b) => a.score - b.score)
    .slice(0, 40)
    .map((x) => x.i);
}
