"use client";
import { useEffect, useState } from "react";
import { currentTheme, reducedMotion, type Theme } from "@/lib/prefs";

/** Live view of the device display preferences (updates when any toggle changes them). */
export function usePrefs(): { theme: Theme; reduce: boolean; ready: boolean } {
  const [s, set] = useState<{ theme: Theme; reduce: boolean; ready: boolean }>({ theme: "dark", reduce: false, ready: false });
  useEffect(() => {
    const read = () => set({ theme: currentTheme(), reduce: reducedMotion(), ready: true });
    read();
    window.addEventListener("tl-prefs", read);
    return () => window.removeEventListener("tl-prefs", read);
  }, []);
  return s;
}
