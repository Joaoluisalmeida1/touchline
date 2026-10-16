"use client";
import { useOptimistic, useTransition } from "react";
import { reactWallAction } from "@/server/actions";
import { cn } from "../ui";

export const EMOJIS = ["👏", "🔥", "😂", "😬", "🤝"] as const;

/** Toggle reactions with an optimistic count; the server keeps one reaction per (user, emoji). */
export function WallReactions({ gameId, postId, reactions }: { gameId: string; postId: string; reactions: { emoji: string; n: number; mine: boolean }[] }) {
  const [pending, start] = useTransition();
  const [state, toggle] = useOptimistic(reactions, (cur, emoji: string) => {
    const r = cur.find((x) => x.emoji === emoji);
    if (!r) return [...cur, { emoji, n: 1, mine: true }];
    return cur.map((x) => (x.emoji === emoji ? { ...x, n: x.n + (x.mine ? -1 : 1), mine: !x.mine } : x)).filter((x) => x.n > 0);
  });
  return (
    <div className="flex flex-wrap items-center gap-1" aria-busy={pending}>
      {EMOJIS.map((e) => {
        const r = state.find((x) => x.emoji === e);
        return (
          <button key={e} type="button" aria-pressed={!!r?.mine} aria-label={`Reagir ${e}`}
            onClick={() => start(async () => { toggle(e); await reactWallAction({ gameId, postId, emoji: e }); })}
            className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs transition",
              r?.mine ? "border-accent/50 bg-accent/10 text-ink" : r ? "border-line-strong bg-surface-2 text-muted" : "border-transparent text-faint opacity-60 hover:opacity-100 hover:bg-surface-2")}>
            <span>{e}</span>{r ? <span className="font-bold tabular">{r.n}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
