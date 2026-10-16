"use client";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { PillTabs } from "../fx/tabs";

/** Pill tabs over server-rendered panels (keeps the panels as RSC, only the switch is client-side). */
export function SectionTabs<K extends string>({ label, tabs, panels, initial }: {
  label: string; tabs: { id: K; label: string; badge?: number }[]; panels: Record<K, ReactNode>; initial: K;
}) {
  const [tab, setTab] = useState<K>(initial);
  return (
    <div className="space-y-5">
      <PillTabs label={label} value={tab} onChange={setTab} stretch tabs={tabs.map((t) => ({
        id: t.id,
        label: <>{t.label}{t.badge ? <span className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-accent text-[10px] font-extrabold text-accent-ink">{t.badge}</span> : null}</>,
      }))} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
          {panels[tab]}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
