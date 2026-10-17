"use client";
/** Ctrl/⌘ K: jump to any screen, pending decision or player, and flip display settings. Keyboard first. */
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Moon, PersonStanding, Search, Sun, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { setReducedMotion, setTheme } from "@/lib/prefs";
import { cn } from "../ui";
import { usePrefs } from "./use-prefs";
import { rankPalette, type PaletteItem } from "./palette-search";

export type { PaletteItem };


export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const router = useRouter();
  const { theme, reduce } = usePrefs();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const all = useMemo<PaletteItem[]>(() => [
    ...items,
    { id: "a:theme", group: "Ações", label: theme === "dark" ? "Mudar para tema claro" : "Mudar para tema escuro", keywords: "tema claro escuro dark light", icon: theme === "dark" ? <Sun /> : <Moon />, run: () => setTheme(theme === "dark" ? "light" : "dark") },
    { id: "a:motion", group: "Ações", label: reduce ? "Ativar animações" : "Reduzir movimento", keywords: "animações movimento acessibilidade", icon: <PersonStanding />, run: () => setReducedMotion(!reduce) },
  ], [items, theme, reduce]);
  const results = useMemo(() => rankPalette(all, q), [all, q]);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => input.current?.focus(), 10); } }, [open]);
  useEffect(() => setSel(0), [q]);

  const go = (i: PaletteItem | undefined) => {
    if (!i) return;
    if (i.run) i.run();
    if (i.href) router.push(i.href);
    onClose();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(results.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); go(results[sel]); }
  };

  let lastGroup = "";
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button type="button" aria-label="Fechar" className="fixed inset-0 z-[60] bg-scrim" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div role="dialog" aria-modal="true" aria-label="Procurar" onKeyDown={onKey}
            className="fixed inset-x-3 top-[10vh] z-[60] mx-auto flex max-h-[72vh] max-w-xl flex-col overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-[var(--tl-shadow)]"
            initial={{ opacity: 0, y: -8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.16 }}>
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-5 shrink-0 text-muted" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jogador, ecrã ou ação…" aria-label="Procurar"
                role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={results[sel] ? `pi-${results[sel].id}` : undefined}
                className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-faint focus:outline-none" />
              <kbd className="rounded border border-line px-1.5 py-px text-[11px] font-bold text-muted">Esc</kbd>
            </div>
            <ul id="palette-list" role="listbox" aria-label="Resultados" className="thin-scroll flex-1 overflow-y-auto p-2">
              {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Nada encontrado.</li>}
              {results.map((r, k) => {
                const header = r.group !== lastGroup ? r.group : null;
                lastGroup = r.group;
                return (
                  <li key={r.id} role="presentation">
                    {header && <p className="px-3 pb-1 pt-3 text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted">{header}</p>}
                    <button type="button" id={`pi-${r.id}`} role="option" aria-selected={k === sel} onMouseEnter={() => setSel(k)} onClick={() => go(r)}
                      className={cn("flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 text-left", k === sel ? "bg-surface-2 text-ink" : "text-ink")}>
                      <span className="flex size-7 shrink-0 items-center justify-center text-muted [&_svg]:size-[18px]">{r.icon ?? <User />}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold">{r.label}</span>
                      {r.hint && <span className="shrink-0 text-xs text-muted tabular">{r.hint}</span>}
                      {k === sel && <CornerDownLeft className="size-4 shrink-0 text-muted" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
