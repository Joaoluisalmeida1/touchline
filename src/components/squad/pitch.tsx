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

export const fitTone = (fit: number) => (fit >= 0.97 ? "ring-accent" : fit >= 0.9 ? "ring-warn" : "ring-danger");
export const fitText = (fit: number) => (fit >= 0.97 ? "text-accent" : fit >= 0.9 ? "text-warn" : "text-danger");

export function PitchToken({ p, slot, role, captain, selected, look, compact }: {
  p: SquadP; slot: Slot; role?: string; captain?: boolean; selected?: boolean; look: ClubLook; compact?: boolean;
}) {
  const fit = fitOf(p, slot);
  const eff = effOf(p, slot);
  const roleLabel = role ? ROLE_BY_ID[role]?.label : undefined;
  return (
    <div className={cn("group relative flex w-[76px] flex-col items-center sm:w-24", selected && "scale-105")}>
      <div className={cn("relative rounded-full ring-2 ring-offset-2 ring-offset-transparent transition", selected ? "ring-info" : fitTone(fit))}>
        <Shirt primary={look.primary} secondary={look.secondary} number={p.shirt} size={compact ? 34 : 40} />
        {captain && <span className="absolute -left-1.5 -top-1 rounded bg-amber-300 px-1 text-[9px] font-black text-amber-950" title="Capitão">C</span>}
        {p.fitness < 70 && <span className="absolute -right-1.5 -top-1 rounded bg-danger px-1 text-[9px] font-black text-white" title={`Condição ${p.fitness}%`}>{p.fitness}</span>}
      </div>
      <span className="mt-1 max-w-full truncate rounded bg-black/70 px-1.5 text-[11px] font-semibold leading-5 text-white">{surname(p.name)}</span>
      <span className="flex items-center gap-1 text-[10px] font-bold leading-4">
        <span className="rounded bg-white/90 px-1 text-slate-900 tabular">{eff}</span>
        <span className={cn("drop-shadow", fit < 0.97 ? fitText(fit) : "text-white/80")}>{SLOT_LABEL[slot]}</span>
      </span>
      {!compact && roleLabel && <span className="hidden max-w-full truncate text-[9px] leading-3 text-white/70 sm:block">{roleLabel}</span>}
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
    <div className="relative mx-auto aspect-[68/90] w-full max-w-[520px] select-none overflow-hidden rounded-2xl border border-emerald-900/60 bg-[repeating-linear-gradient(0deg,#0f3d2a_0,#0f3d2a_9%,#0d3524_9%,#0d3524_18%)] shadow-inner">
      <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 68 90" preserveAspectRatio="none" aria-hidden>
        <g fill="none" stroke="rgba(255,255,255,.32)" strokeWidth=".35">
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
            <DropZone id={`slot:${i}`} className="rounded-xl" activeClassName="ring-2 ring-info bg-info/15">
              <button type="button" disabled={locked} onClick={() => onSlotClick(i)}
                aria-label={`${SLOT_LABEL[c.slot]}: ${p ? p.name : "vazio"}`}
                className="block rounded-xl p-0.5">
                {p ? (
                  <Draggable id={p.id} disabled={locked}>
                    <PitchToken p={p} slot={c.slot} role={st.roles[i]} captain={st.ins.captain === p.id} selected={selected === p.id} look={look} />
                  </Draggable>
                ) : (
                  <div className={cn("flex w-[76px] flex-col items-center gap-1 sm:w-24", selected && "animate-pulse")}>
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-white/50 text-lg text-white/60">+</span>
                    <span className="rounded bg-black/50 px-1.5 text-[11px] font-bold text-white/80">{SLOT_LABEL[c.slot]}</span>
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
    <div className={cn("flex items-center gap-2 rounded-lg border px-2 py-1.5 transition",
      selected ? "border-info bg-info/10" : "border-line bg-bg/60 hover:border-faint", unavailable && "opacity-55")}>
      <PlayerAvatar id={p.id} primary={look.primary} secondary={look.secondary} size={30} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-5">
          {p.shirt !== null && <span className="mr-1 text-xs text-faint tabular">{p.shirt}</span>}{p.name}
        </p>
        <div className="flex items-center gap-1.5 text-[11px] leading-4 text-muted">{sub}</div>
      </div>
      {right}
    </div>
  );
}
