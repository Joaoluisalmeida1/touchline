"use client";
import { ArrowLeftRight, CalendarDays, ClipboardList, Ellipsis, Landmark, MessagesSquare, House, ListOrdered, Newspaper, ScrollText, Settings2, Shirt, Wallet, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NavTabs } from "./fx/tabs";
import { cn } from "./ui";

const ICON = "size-4";

function useItems(gameId: string, isOwner: boolean) {
  const base = `/g/${gameId}`;
  return [
    { key: "", label: "Resumo", short: "Resumo", icon: <House className={ICON} /> },
    { key: "/squad", label: "Plantel", short: "Plantel", icon: <Shirt className={ICON} /> },
    { key: "/week", label: "Semana", short: "Semana", icon: <ClipboardList className={ICON} /> },
    { key: "/club", label: "Clube", short: "Clube", icon: <Landmark className={ICON} /> },
    { key: "/news", label: "Jornal", short: "Jornal", icon: <Newspaper className={ICON} /> },
    { key: "/fixtures", label: "Jogos", short: "Jogos", icon: <CalendarDays className={ICON} /> },
    { key: "/table", label: "Classificação", short: "Tabela", icon: <ListOrdered className={ICON} /> },
    { key: "/market", label: "Mercado", short: "Mercado", icon: <ArrowLeftRight className={ICON} /> },
    { key: "/finances", label: "Finanças", short: "Finanças", icon: <Wallet className={ICON} /> },
    { key: "/social", label: "Balneário", short: "Balneário", icon: <MessagesSquare className={ICON} /> },
    { key: "/history", label: "História", short: "História", icon: <ScrollText className={ICON} /> },
    { key: "/settings", label: isOwner ? "Definições" : "Liga", short: isOwner ? "Definições" : "Liga", icon: <Settings2 className={ICON} /> },
  ].map((i) => ({ ...i, href: base + i.key }));
}

function activeHref(path: string, items: { key: string; href: string }[], base: string) {
  if (path === base) return base;
  // players/matches live "under" squad/fixtures for highlighting purposes
  const hit = items.filter((i) => i.key && path.startsWith(i.href)).sort((a, b) => b.href.length - a.href.length)[0];
  if (hit) return hit.href;
  if (path.includes("/matches/")) return base + "/fixtures";
  if (path.includes("/players/") || path.endsWith("/tactics")) return base + "/squad";
  return "";
}

/** Desktop: animated tab bar. */
export function GameNav({ gameId, isOwner }: { gameId: string; isOwner: boolean }) {
  const path = usePathname();
  const items = useItems(gameId, isOwner);
  const active = activeHref(path, items, `/g/${gameId}`);
  return (
    <div className="mt-5 hidden md:block">
      <NavTabs label="Secções da liga" activeHref={active} items={items.map((i) => ({ href: i.href, label: i.label, icon: i.icon }))} />
    </div>
  );
}

const DOCK = ["", "/squad", "/week", "/table", "/market"];

/** Mobile: thumb-reachable dock (Watermelon "Dock" spring) + "Mais" sheet for the rest. */
export function MobileDock({ gameId, isOwner }: { gameId: string; isOwner: boolean }) {
  const path = usePathname();
  const items = useItems(gameId, isOwner);
  const base = `/g/${gameId}`;
  const active = activeHref(path, items, base);
  const [more, setMore] = useState(false);
  useEffect(() => setMore(false), [path]);
  const dock = items.filter((i) => DOCK.includes(i.key));
  const rest = items.filter((i) => !DOCK.includes(i.key));
  const restActive = rest.some((i) => i.href === active);
  return (
    <>
      <AnimatePresence>
        {more && (
          <>
            <motion.button type="button" aria-label="Fechar menu" className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMore(false)} />
            <motion.div role="dialog" aria-label="Mais secções" className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-50 rounded-3xl border border-line-strong bg-surface p-2 shadow-2xl md:hidden"
              initial={{ opacity: 0, y: 24, scale: 0.96, filter: "blur(6px)" }} animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }} exit={{ opacity: 0, y: 16, scale: 0.97 }}>
              <div className="flex items-center justify-between px-3 py-2">
                <p className="eyebrow">Mais</p>
                <button type="button" onClick={() => setMore(false)} className="rounded-lg p-1 text-muted" aria-label="Fechar"><X className="size-4" /></button>
              </div>
              {rest.map((i) => (
                <Link key={i.href} href={i.href} className={cn("flex items-center gap-3 rounded-2xl px-3 py-3 font-semibold", i.href === active ? "bg-accent/10 text-accent" : "text-ink hover:bg-surface-2")}>
                  <span className="flex size-9 items-center justify-center rounded-xl bg-surface-2 ring-1 ring-line">{i.icon}</span>{i.label}
                </Link>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
      <nav aria-label="Navegação da liga" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-6 px-1.5 py-1.5">
          {dock.map((i) => {
            const on = i.href === active;
            return (
              <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined} className="relative flex flex-col items-center gap-0.5 rounded-xl py-1.5">
                {on && <motion.span layoutId="dock-on" className="absolute inset-x-1.5 inset-y-0 rounded-xl bg-accent/12 ring-1 ring-accent/25" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                <motion.span animate={{ y: on ? -1 : 0, scale: on ? 1.12 : 1 }} transition={{ type: "spring", stiffness: 550, damping: 18 }}
                  className={cn("relative [&_svg]:size-5", on ? "text-accent" : "text-muted")}>{i.icon}</motion.span>
                <span className={cn("relative text-[10px] font-semibold", on ? "text-ink" : "text-faint")}>{i.short}</span>
              </Link>
            );
          })}
          <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more}
            className={cn("relative flex flex-col items-center gap-0.5 rounded-xl py-1.5", restActive || more ? "text-accent" : "text-muted")}>
            <Ellipsis className="size-5" />
            <span className={cn("text-[10px] font-semibold", restActive || more ? "text-ink" : "text-faint")}>Mais</span>
          </button>
        </div>
      </nav>
    </>
  );
}
