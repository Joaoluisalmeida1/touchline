"use client";
/** Adapted from Watermelon UI "Copy Confirm" (https://ui.watermelon.sh, MIT): icon morph + per-letter label swap. */
import { Check, Copy } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { cn } from "../ui";

function Letters({ text }: { text: string }) {
  return (
    <span className="flex">
      <AnimatePresence mode="popLayout" initial={false}>
        {text.split("").map((ch, i) => (
          <motion.span key={`${text}-${i}`} layout initial={{ opacity: 0, y: 5, scale: 0.7 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { type: "spring", stiffness: 260, damping: 20, delay: 0.02 * i } }}
            exit={{ opacity: 0, y: -5, scale: 0.7 }}>
            {ch === " " ? " " : ch}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}

export function CopyButton({ value, label = "Copiar link", done = "Copiado", className }: { value: string; label?: string; done?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.button type="button" whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.96 }}
      onClick={async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1800); }}
      aria-label={copied ? done : label}
      className={cn("relative inline-flex min-h-10 items-center gap-2 overflow-hidden rounded-xl px-4 text-sm font-bold transition-colors",
        copied ? "bg-emerald-400 text-emerald-950" : "bg-accent text-accent-ink", className)}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={copied ? "c" : "n"} initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }} animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }} transition={{ type: "spring", duration: 0.3, bounce: 0 }}>
          {copied ? <Check className="size-4" strokeWidth={3} /> : <Copy className="size-4" strokeWidth={2.5} />}
        </motion.span>
      </AnimatePresence>
      <Letters text={copied ? done : label} />
    </motion.button>
  );
}
