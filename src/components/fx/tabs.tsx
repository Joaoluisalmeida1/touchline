"use client";
/**
 * Sliding-pill tabs. Adapted from Watermelon UI "Continuous Tabs" / "Fluid Tabs" (https://ui.watermelon.sh, MIT):
 * a shared-layout pill springs between options; the label briefly blurs as it becomes active.
 */
import { LayoutGroup, motion } from "motion/react";
import Link from "next/link";
import { useId, type ReactNode } from "react";
import { cn } from "../ui";

export interface TabDef<K extends string> { id: K; label: ReactNode; icon?: ReactNode; badge?: ReactNode }

const pillSpring = { type: "spring", stiffness: 420, damping: 34, mass: 0.7 } as const;

export function PillTabs<K extends string>({ tabs, value, onChange, label, size = "md", className, stretch }: {
  tabs: TabDef<K>[]; value: K; onChange: (k: K) => void; label: string; size?: "sm" | "md"; className?: string; stretch?: boolean;
}) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <div role="tablist" aria-label={label}
        className={cn("relative inline-flex items-center gap-0.5 rounded-xl border border-line bg-bg/70 p-1", stretch && "flex w-full", className)}>
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => onChange(t.id)}
              className={cn("relative rounded-lg font-semibold outline-none transition-colors", stretch && "flex-1",
                size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
                active ? "text-accent-ink" : "text-muted hover:text-ink")}>
              {active && <motion.span layoutId="pill" transition={pillSpring} className="absolute inset-0 rounded-lg bg-accent shadow-[0_0_24px_-6px_rgb(212_255_58/.6)]" />}
              <motion.span className="relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap"
                animate={{ filter: active ? ["blur(0px)", "blur(3px)", "blur(0px)"] : "blur(0px)" }} transition={{ duration: 0.28 }}>
                {t.icon}{t.label}{t.badge}
              </motion.span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}

/** Route tabs (links) with an animated underline + glow. */
export function NavTabs({ items, activeHref, label }: { items: { href: string; label: string; icon?: ReactNode }[]; activeHref: string; label: string }) {
  const id = useId();
  return (
    <LayoutGroup id={id}>
      <nav aria-label={label} className="no-scrollbar -mb-px flex gap-1 overflow-x-auto">
        {items.map((it) => {
          const active = it.href === activeHref;
          return (
            <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
              className={cn("group relative flex items-center gap-2 whitespace-nowrap px-3 pb-3 pt-2 text-sm font-semibold transition-colors",
                active ? "text-ink" : "text-muted hover:text-ink")}>
              <span className={cn("transition-colors", active ? "text-accent" : "text-faint group-hover:text-muted")}>{it.icon}</span>
              {it.label}
              {active && (
                <motion.span layoutId="underline" transition={pillSpring}
                  className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-accent shadow-[0_0_14px_rgb(212_255_58/.7)]" />
              )}
            </Link>
          );
        })}
      </nav>
    </LayoutGroup>
  );
}
