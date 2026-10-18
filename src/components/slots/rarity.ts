import type { Rarity } from "@/engine/slots/slots";

/** Rarity colours of the Roleta (shared by the client cabinet and server-rendered lists). */
export const RARITY: Record<Rarity, { label: string; bg: string; ink: string; ring: string }> = {
  common: { label: "Comum", bg: "#4b5563", ink: "#fff", ring: "#9ca3af" },
  rare: { label: "Raro", bg: "#2563eb", ink: "#fff", ring: "#93c5fd" },
  epic: { label: "Épico", bg: "#9333ea", ink: "#fff", ring: "#d8b4fe" },
  legendary: { label: "Lendário", bg: "#f59e0b", ink: "#1a1100", ring: "#fde68a" },
  bad: { label: "Azar", bg: "#dc2626", ink: "#fff", ring: "#fca5a5" },
  disaster: { label: "Desastre", bg: "#0a0a0a", ink: "#ff4d4d", ring: "#ff4d4d" },
};
