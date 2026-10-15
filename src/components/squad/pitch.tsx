"use client";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { Formation, Slot } from "@/engine/common/types";
import { SLOT_LABEL, slotCoordinates } from "@/engine/lineup/formations";
import { ROLE_BY_ID } from "@/engine/lineup/roles";
import { cn } from "../ui";
import { PlayerAvatar, Shirt } from "./avatar";
import { effOf, fitOf } from "./editor";
import { surname, type ClubLook, type EditorState, type SquadP } from "./types";

export function Draggable({ id, disabled, children, className }: { id: string; disabled?: boolean; children: ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `p:${id}`, data: { playerId: id }, disabled });
  return (
    <div ref={setNodeRef} {...listeners} {...attributes} role="presentation" tabIndex={-1}
      className={cn(className, isDragging && "opacity-30")} style={{ touchAction: "manipulation" }}>
      {children}
    </div>
  );
}

export function DropZone({ id, children, className, activeClassName }: { id: string; children: ReactNode; className?: string; activeClassName?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={cn(className, isOver && (activeClassName ?? "ring-2 ring-info"))}>{children}</div>;
}

export const fitTone = (fit: number) => (fit >= 0.97 ? "ring-accent/90" : fit >= 0.9 ? "ring-warn" : "ring-danger");
export const fitText = (fit: number) => (fit >= 0.97 ? "text-accent" : fit >= 0.9 ? "text-warn" : "text-danger");

export function PitchToken({ p, slot, role, captain, selected, look, compact }: {
  p: SquadP; slot: Slot; role?: string; captain?: boolean; selected?: boolean; look: ClubLook; compact?: boolean;
}) {
  const fit = fitOf(p, slot);
  const eff = effOf(p, slot);
  const roleLabel = role ? ROLE_BY_ID[role]?.label : undefined;
  return (
    <div className={cn("group relative flex w-[76px] flex-col items-center transition-transform duration-200 sm:w-24", selected && "-translate-y-1 scale-110")}>
      <div className={cn("relative rounded-full ring-2 ring-offset-2 ring-offset-pitch transition", selected ? "ring-white shadow-[0_0_24px_4px_rgb(212_255_58/.55)]" : fitTone(fit))}>
        <Shirt primary={look.primary} secondary={look.secondary} number={p.shirt} size={compact ? 34 : 40} />
        {captain && <span className="absolute -left-2 -top-1.5 flex size-4 items-center justify-center rounded-full bg-gold font-display text-[10px] font-extrabold text-[#2a1a00] ring-2 ring-pitch" title="Capitão">C</span>}
        {p.fitness < 70 && <span className="absolute -right-2 -top-1.5 rounded-full bg-danger px-1 font-display text-[10px] font-bold text-white ring-2 ring-pitch" title={`Condição ${p.fitness}%`}>{p.fitness}</span>}
      </div>
      <span className="mt-1.5 flex max-w-full items-stretch overflow-hidden rounded-md text-[11px] font-bold leading-5 shadow-[0_4px_10px_rgb(0_0_0/.45)]">
        <span className={cn("px-1 font-display text-xs tabular", eff >= 78 ? "bg-accent text-accent-ink" : eff >= 70 ? "bg-white text-slate-900" : "bg-slate-300 text-slate-900")}>{eff}</span>
        <span className="truncate bg-black/80 px-1.5 font-display text-xs uppercase tracking-wide text-white">{surname(p.name)}</span>
      </span>
      <span className={cn("mt-0.5 font-display text-[10px] font-bold uppercase leading-3 tracking-wider drop-shadow", fit < 0.97 ? fitText(fit) : "text-white/70")}>
        {SLOT_LABEL[slot]}{!compact && roleLabel ? <span className="hidden font-sans font-medium normal-case tracking-normal text-white/55 sm:inline"> · {roleLabel}</span> : null}
      </span>
    </div>
  );
}

export function Pitch({ squad, st, look, selected, locked, onSlotClick }: {
  squad: SquadP[]; st: EditorState; look: ClubLook; selected: string | null; locked: boolean;
  onSlotClick: (index: number) => void;
}) {
  const byId = new Map(squad.map((p) => [p.id, p]));
  const coords = slotCoordinates(st.formation as Formation);
  return (
    <div className="relative mx-auto aspect-[68/90] w-full max-w-[540px] select-none overflow-hidden rounded-[26px] border border-white/10 bg-[repeating-linear-gradient(0deg,#123a26_0,#123a26_9%,#0f3220_9%,#0f3220_18%)] shadow-[0_30px_80px_-30px_rgb(0_0_0/.9),inset_0_0_80px_rgb(0_0_0/.55)]">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgb(212_255_58/.08),transparent_60%)]" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 68 90" preserveAspectRatio="none" aria-hidden>
        <g fill="none" stroke="rgba(255,255,255,.38)" strokeWidth=".35">
          <rect x="2" y="2" width="64" height="86" rx=".5" />
          <line x1="2" y1="45" x2="66" y2="45" /><circle cx="34" cy="45" r="7" /><circle cx="34" cy="45" r=".5" fill="rgba(255,255,255,.4)" />
          <rect x="16" y="2" width="36" height="13" /><rect x="25" y="2" width="18" height="5" />
          <rect x="16" y="75" width="36" height="13" /><rect x="25" y="83" width="18" height="5" />
          <path d="M28 15 A7 7 0 0 0 40 15" /><path d="M28 75 A7 7 0 0 1 40 75" />
        </g>
      </svg>
      {coords.map((c, i) => {
        const id = st.xi[i];
        const p = id ? byId.get(id) : undefined;
        return (
          <div key={`${st.formation}-${i}`} className="absolute z-10 -translate-x-1/2 translate-y-1/2 transition-[left,bottom] duration-300"
            style={{ left: `${c.x}%`, bottom: `${c.y}%` }}>
            <DropZone id={`slot:${i}`} className="rounded-xl" activeClassName="ring-2 ring-accent bg-accent/15">
              <button type="button" disabled={locked} onClick={() => onSlotClick(i)}
                aria-label={`${SLOT_LABEL[c.slot]}: ${p ? p.name : "vazio"}`}
                className="block rounded-xl p-0.5">
                {p ? (
                  <Draggable id={p.id} disabled={locked}>
                    <PitchToken p={p} slot={c.slot} role={st.roles[i]} captain={st.ins.captain === p.id} selected={selected === p.id} look={look} />
                  </Draggable>
                ) : (
                  <div className={cn("flex w-[76px] flex-col items-center gap-1 sm:w-24", selected && "animate-pulse")}>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-accent/60 bg-black/20 text-lg font-bold text-accent">+</span>
                    <span className="rounded-md bg-black/60 px-1.5 font-display text-xs font-bold uppercase text-white/85">{SLOT_LABEL[c.slot]}</span>
                  </div>
                )}
              </button>
            </DropZone>
          </div>
        );
      })}
    </div>
  );
}

/** Compact horizontal card for bench / reserves lists. */
export function PlayerChip({ p, look, selected, sub, right }: { p: SquadP; look: ClubLook; selected?: boolean; sub?: ReactNode; right?: ReactNode }) {
  const unavailable = p.injured > 0 || p.suspended > 0;
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl border px-2 py-1.5 transition",
      selected ? "border-accent/70 bg-accent/10 shadow-[0_0_0_3px_rgb(212_255_58/.12)]" : "border-line bg-bg/60 hover:border-line-strong hover:bg-surface-2", unavailable && "opacity-55")}>
      <PlayerAvatar id={p.id} primary={look.primary} secondary={look.secondary} size={30} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-5">
          {p.shirt !== null && <span className="mr-1.5 font-display text-xs font-bold text-faint tabular">{p.shirt}</span>}{p.name}
        </p>
        <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted">{sub}</div>
      </div>
      {right}
    </div>
  );
}
