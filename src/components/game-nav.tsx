"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./ui";

export function GameNav({ gameId, isOwner }: { gameId: string; isOwner: boolean }) {
  const path = usePathname();
  const base = `/g/${gameId}`;
  const items = [
    ["", "Resumo"], ["/squad", "Plantel"], ["/tactics", "Tática"], ["/fixtures", "Jogos"], ["/table", "Classificação"],
    ["/market", "Mercado"], ["/finances", "Finanças"], ["/settings", isOwner ? "Definições" : "Liga"],
  ];
  return (
    <nav aria-label="Secções da liga" className="-mb-px mt-4 flex gap-1 overflow-x-auto text-sm">
      {items.map(([href, label]) => {
        const full = base + href;
        const active = href === "" ? path === base : path.startsWith(full);
        return (
          <Link key={href} href={full} aria-current={active ? "page" : undefined}
            className={cn("whitespace-nowrap border-b-2 px-3 py-2.5 font-medium", active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
