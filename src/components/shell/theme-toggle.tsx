"use client";
import { Moon, Sun } from "lucide-react";
import { setTheme } from "@/lib/prefs";
import { cn } from "../ui";
import { usePrefs } from "./use-prefs";

/** Sun/moon switch between the dark (default) and light themes. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme } = usePrefs();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button type="button" onClick={() => setTheme(next)} aria-label={next === "light" ? "Mudar para tema claro" : "Mudar para tema escuro"}
      title={next === "light" ? "Tema claro" : "Tema escuro"}
      className={cn("flex size-10 items-center justify-center rounded-[10px] border border-line bg-surface text-ink transition hover:border-line-strong", className)}>
      {theme === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </button>
  );
}
