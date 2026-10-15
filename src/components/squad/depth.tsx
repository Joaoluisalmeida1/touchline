"use client";
import type { Slot } from "@/engine/common/types";
import { FORMATION_SLOTS, PREFERRABLE_SLOTS, SLOT_NAME } from "@/engine/lineup/formations";
import { Card, CardTitle, cn } from "../ui";
import { PlayerAvatar } from "./avatar";
import { effOf, fitOf } from "./editor";
import { fitText } from "./pitch";
import { isAvailableP, type ClubLook, type EditorState, type SquadP } from "./types";

const ALL: Slot[] = ["GK", ...PREFERRABLE_SLOTS.DEF, ...PREFERRABLE_SLOTS.MID, ...PREFERRABLE_SLOTS.ATT];

/** Top options per position, so gaps in the squad are obvious. */
export function DepthChart({ squad, st, look, onOpen }: { squad: SquadP[]; st: EditorState; look: ClubLook; onOpen: (id: string) => void }) {
  const inFormation = new Set(FORMATION_SLOTS[st.formation]);
  const avail = squad.filter(isAvailableP);
  const counts = (["GK", "DEF", "MID", "ATT"] as const).map((g) => ({ g, n: squad.filter((p) => p.group === g).length, a: avail.filter((p) => p.group === g).length }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {counts.map(({ g, n, a }) => (
          <Card key={g} className="p-3">
            <p className="text-[11px] uppercase tracking-wider text-faint">{{ GK: "Guarda-redes", DEF: "Defesas", MID: "Médios", ATT: "Avançados" }[g]}</p>
            <p className="font-display text-3xl font-extrabold tabular">{a}<span className="text-sm font-semibold text-faint">/{n}</span></p>
            <p className="text-[11px] text-muted">disponíveis</p>
          </Card>
        ))}
      </div>
      <Card>
        <CardTitle>Profundidade por posição</CardTitle>
        <p className="mb-3 text-xs text-muted">As 3 melhores opções para cada posição (rendimento efetivo = OVR × adaptação). Posições da formação atual em destaque.</p>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ALL.map((slot) => {
            const top = avail.map((p) => ({ p, eff: effOf(p, slot), fit: fitOf(p, slot) }))
              .filter((x) => x.fit >= 0.85).sort((a, b) => b.eff - a.eff || b.fit - a.fit).slice(0, 3);
            const gap = top.length < 2 || (top[0]?.fit ?? 0) < 0.95;
            return (
              <div key={slot} className={cn("rounded-2xl border p-3", inFormation.has(slot) ? "border-accent/40 bg-accent/[.05]" : "border-line bg-bg/30")}>
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-semibold">{SLOT_NAME[slot]}</p>
                  {gap && <span className="text-[11px] font-semibold text-warn">pouca profundidade</span>}
                </div>
                <ol className="space-y-1">
                  {top.length === 0 && <li className="text-xs text-faint">Ninguém adaptado.</li>}
                  {top.map(({ p, eff, fit }, i) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => onOpen(p.id)} className="flex w-full items-center gap-2 rounded-md px-1 py-0.5 text-left text-sm hover:bg-surface-2">
                        <span className="w-3 text-xs text-faint">{i + 1}</span>
                        <PlayerAvatar id={p.id} primary={look.primary} secondary={look.secondary} size={22} />
                        <span className={cn("flex-1 truncate", st.xi.includes(p.id) && "font-semibold")}>{p.name}</span>
                        <span className={cn("text-xs font-bold tabular", fitText(fit))}>{eff}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
