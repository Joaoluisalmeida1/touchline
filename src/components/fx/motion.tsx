"use client";
/**
 * Motion primitives shared across the app. The entrance style (blur + rise + spring) follows the
 * Watermelon UI motion language (https://ui.watermelon.sh, MIT).
 */
import { MotionConfig, motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";

export const spring = { type: "spring", stiffness: 380, damping: 32, mass: 0.8 } as const;
export const softSpring = { type: "spring", stiffness: 240, damping: 26, mass: 0.9 } as const;

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={spring}>{children}</MotionConfig>;
}

const rise = {
  hidden: { opacity: 0, y: 10, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { type: "spring", stiffness: 260, damping: 28 } },
} as const;

/** Fades + un-blurs its content in on mount. */
export function Reveal({ children, delay = 0, className, ...rest }: { children: ReactNode; delay?: number; className?: string } & Omit<HTMLMotionProps<"div">, "children">) {
  return (
    <motion.div initial="hidden" animate="show" variants={{ hidden: rise.hidden, show: { ...rise.show, transition: { ...rise.show.transition, delay } } }}
      className={className} {...rest}>
      {children}
    </motion.div>
  );
}

/** Container that staggers its <StaggerItem> children in. */
export function Stagger({ children, className, gap = 0.05, as = "div" }: { children: ReactNode; className?: string; gap?: number; as?: "div" | "ul" | "ol" }) {
  const C = as === "ul" ? motion.ul : as === "ol" ? motion.ol : motion.div;
  return (
    <C initial="hidden" animate="show" variants={{ hidden: {}, show: { transition: { staggerChildren: gap } } }} className={className}>
      {children}
    </C>
  );
}

export function StaggerItem({ children, className, as = "div", ...rest }: { children: ReactNode; className?: string; as?: "div" | "li" } & Omit<HTMLMotionProps<"div">, "children">) {
  const C = as === "li" ? motion.li : motion.div;
  return <C variants={rise} className={className} {...(rest as object)}>{children}</C>;
}

/** Animated horizontal bar (0–100%). */
export function Bar({ pct, className, delay = 0, style }: { pct: number; className?: string; delay?: number; style?: React.CSSProperties }) {
  return (
    <motion.div className={className} style={style} initial={{ width: 0 }} animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
      transition={{ type: "spring", stiffness: 120, damping: 22, delay }} />
  );
}
