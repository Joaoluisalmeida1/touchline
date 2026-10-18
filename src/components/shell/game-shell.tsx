"use client";
/**
 * UI v2 game shell: icon rail (desktop), context bar with the hub's sub-tabs, deadline, command palette and the
 * "Hoje" drawer of pending decisions, and a five-hub bottom dock on phones. Pure presentation: every number shown
 * here was read on the server for this user.
 */
import { AnimatePresence, motion } from "motion/react";
import {
  Bell, CalendarClock, ChevronRight, Contact, Gavel, Handshake, Inbox, LayoutGrid, LogOut, Megaphone, Search, Sprout, Swords, X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { logoutAction } from "@/server/actions";
import type { TodayItem, TodayKind } from "@/server/today-queries";
import { NavTabs } from "../fx/tabs";
import { LogoMark } from "../site-header";
import { ClubBadge } from "../squad/avatar";
import { Badge, cn } from "../ui";
import { CommandPalette, type PaletteItem } from "./command-palette";
import { hubs, locate, type Hub } from "./hubs";
import { ThemeToggle } from "./theme-toggle";

export interface ShellGame {
  id: string; name: string; league: string; status: string; season: number; round: number; totalRounds: number;
  deadline: string | null; synthetic: boolean; isOwner: boolean;
}
export interface ShellClub { id: string; name: string; short: string; primary: string; secondary: string; skin?: string | null }

export function GameShell({ game, club, today, players, children }: {
  game: ShellGame; club: ShellClub | null; today: TodayItem[]; players: { id: string; name: string; ovr: number; position_group: string }[];
  children: ReactNode;
}) {
  const path = usePathname();
  const base = `/g/${game.id}`;
  const all = useMemo(() => hubs(game.isOwner), [game.isOwner]);
  const { hub, tabHref } = locate(path, base, all);
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  useEffect(() => { setDrawer(false); setPalette(false); }, [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteItems = useMemo<PaletteItem[]>(() => [
    ...all.flatMap((h) => h.tabs.map((t) => ({ id: `s:${h.id}${t.key}`, group: "Ecrãs", label: t.label === h.label ? h.label : `${h.label} › ${t.label}`, href: base + t.key, keywords: t.keywords ?? "", icon: <h.icon /> }))),
    ...today.map((i) => ({ id: `t:${i.kind}:${i.id}`, group: "Por decidir", label: i.title, href: i.href, keywords: i.detail, icon: KIND_ICON[i.kind] })),
    ...players.map((p) => ({ id: `p:${p.id}`, group: "Plantel", label: p.name, hint: `${p.position_group} · ${p.ovr}`, href: `${base}/players/${p.id}`, keywords: p.position_group, icon: undefined })),
  ], [all, base, today, players]);

  return (
    <div className="flex min-h-dvh">
      <Rail hubs={all} active={hub.id} base={base} />
      <div className="min-w-0 flex-1">
        <ContextBar game={game} club={club} hub={hub} tabHref={tabHref} base={base} todayCount={today.length}
          onToday={() => setDrawer(true)} onPalette={() => setPalette(true)} />
        <main className="mx-auto max-w-[1280px] px-4 pb-28 pt-6 sm:px-6 md:pb-12 lg:px-8">{children}</main>
      </div>
      <MobileDock hubs={all} active={hub.id} base={base} />
      <TodayDrawer open={drawer} onClose={() => setDrawer(false)} items={today} round={game.round} />
      <CommandPalette open={palette} onClose={() => setPalette(false)} items={paletteItems} />
    </div>
  );
}

/* ------------------------------------------------------------------ rail (desktop) */

function Rail({ hubs: all, active, base }: { hubs: Hub[]; active: string; base: string }) {
  return (
    <nav aria-label="Navegação da liga" className="sticky top-0 hidden h-dvh w-[88px] shrink-0 flex-col items-center gap-1 border-r border-line bg-bg py-4 md:flex">
      <Link href="/dashboard" prefetch={false} aria-label="As minhas ligas" title="As minhas ligas" className="mb-4 flex flex-col items-center gap-1 text-ink">
        <LogoMark size={32} />
        <span className="font-display text-[10px] font-black uppercase tracking-[0.12em] [font-stretch:66%]">Touchline</span>
      </Link>
      {all.map((h) => {
        const on = h.id === active;
        return (
          <Link key={h.id} href={base + h.tabs[0].key} prefetch={false} aria-current={on ? "page" : undefined}
            className={cn("relative flex min-h-[58px] w-[72px] flex-col items-center justify-center gap-1 rounded-[10px] text-xs transition-colors",
              on ? "font-bold text-accent-ink" : "font-semibold text-muted hover:bg-surface-2 hover:text-ink")}>
            {on && <motion.span layoutId="rail-on" className="absolute inset-0 rounded-[10px] bg-accent" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
            <span className="relative [&_svg]:size-[22px]"><h.icon /></span>
            <span className="relative">{h.label}</span>
          </Link>
        );
      })}
      <div className="mt-auto flex flex-col items-center gap-1">
        <Link href="/dashboard" prefetch={false} className="flex min-h-[52px] w-[72px] flex-col items-center justify-center gap-1 rounded-[10px] text-[11px] font-semibold text-muted hover:bg-surface-2 hover:text-ink">
          <LayoutGrid className="size-5" />Ligas
        </Link>
        <form action={logoutAction}>
          <button type="submit" className="flex min-h-[52px] w-[72px] flex-col items-center justify-center gap-1 rounded-[10px] text-[11px] font-semibold text-muted hover:bg-surface-2 hover:text-ink">
            <LogOut className="size-5" />Sair
          </button>
        </form>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ context bar */

function ContextBar({ game, club, hub, tabHref, base, todayCount, onToday, onPalette }: {
  game: ShellGame; club: ShellClub | null; hub: Hub; tabHref: string; base: string; todayCount: number; onToday: () => void; onPalette: () => void;
}) {
  const pct = game.totalRounds ? Math.round((game.round / game.totalRounds) * 100) : 0;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/92 backdrop-blur supports-[backdrop-filter]:bg-bg/85">
      <div className="mx-auto flex max-w-[1280px] items-center gap-3 px-4 pt-3 sm:px-6 lg:px-8">
        {club ? (
          <Link href={`${base}/club`} prefetch={false} aria-label={`${club.name} — clube`} className="shrink-0">
            <ClubBadge seed={club.id} name={club.name} short={club.short} primary={club.primary} secondary={club.secondary} skin={club.skin} size={40} />
          </Link>
        ) : (
          <Link href="/dashboard" prefetch={false} aria-label="As minhas ligas" className="shrink-0 text-ink md:hidden"><LogoMark size={30} /></Link>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-[11px] font-extrabold uppercase tracking-[0.14em] text-muted">
              {game.league}{game.status === "active" ? ` · Época ${game.season} · J${game.round}/${game.totalRounds || "?"}` : ""}
            </p>
            {game.synthetic && <span className="hidden shrink-0 sm:inline-flex"><Badge tone="warn">Dados fictícios</Badge></span>}
          </div>
          <h1 className="truncate font-display text-[22px] font-black uppercase leading-tight [font-stretch:70%] sm:text-[26px]">
            {club ? club.name : game.name}
            {club && <span className="ml-2 hidden align-middle text-sm font-semibold normal-case text-muted [font-stretch:100%] lg:inline">{game.name}</span>}
          </h1>
        </div>
        {game.status === "active" && game.deadline && <DeadlinePill to={game.deadline} className="hidden lg:flex" />}
        {game.status === "setup" && <span className="hidden sm:inline-flex"><Badge tone="info" dot>Em preparação</Badge></span>}
        <button type="button" onClick={onPalette} aria-label="Procurar (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K"
          className="flex h-10 items-center gap-2 rounded-[10px] border border-line bg-surface px-2.5 text-sm text-muted transition hover:border-line-strong hover:text-ink">
          <Search className="size-[18px]" />
          <span className="hidden xl:inline">Procurar jogador, ecrã, ação</span>
          <kbd className="hidden rounded border border-line px-1.5 py-px font-sans text-[11px] font-bold sm:inline">⌘K</kbd>
        </button>
        <button type="button" onClick={onToday} aria-label={`Por decidir: ${todayCount}`}
          className={cn("relative flex h-10 items-center gap-2 rounded-[10px] border px-2.5 text-sm font-bold transition",
            todayCount ? "border-transparent bg-accent text-accent-ink hover:brightness-110" : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink")}>
          <Bell className="size-[18px]" />
          <span className="hidden sm:inline">Por decidir</span>
          <span className="tabular">{todayCount}</span>
        </button>
        <ThemeToggle className="hidden sm:flex" />
      </div>
      <div className="mx-auto flex max-w-[1280px] items-end gap-4 px-2 pt-2 sm:px-4 lg:px-6">
        <div className="min-w-0 flex-1">
          <NavTabs label={`Secções: ${hub.label}`} activeHref={tabHref} items={hub.tabs.map((t) => ({ href: base + t.key, label: t.label }))} />
        </div>
        {game.status === "active" && game.totalRounds > 0 && (
          <div className="hidden w-28 shrink-0 pb-3.5 md:block" title={`Jornada ${game.round} de ${game.totalRounds}`}>
            <div className="h-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-ink" style={{ width: `${pct}%` }} /></div>
          </div>
        )}
      </div>
    </header>
  );
}

function DeadlinePill({ to, className }: { to: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const ms = new Date(to).getTime() - now;
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (x: number) => String(x).padStart(2, "0");
  const label = ms <= 0 ? "A processar" : d > 0 ? `${d}d ${p(h)}h ${p(m)}m` : `${p(h)}:${p(m)}:${p(sec)}`;
  return (
    <div className={cn("h-10 items-center gap-2 rounded-full border border-line bg-surface px-3.5", className)} title="Fecho da jornada">
      <CalendarClock className="size-4 text-muted" />
      <span className="text-sm text-muted">Prazo</span>
      <span className={cn("font-display text-[17px] font-black tabular", ms > 0 && s < 3600 ? "text-warn" : "text-ink")}>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ mobile dock */

function MobileDock({ hubs: all, active, base }: { hubs: Hub[]; active: string; base: string }) {
  const dock = all.filter((h) => h.dock);
  return (
    <nav aria-label="Navegação da liga (telemóvel)" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="mx-auto grid max-w-md grid-cols-5 px-1.5 py-1.5">
        {dock.map((h) => {
          const on = h.id === active;
          return (
            <Link key={h.id} href={base + h.tabs[0].key} prefetch={false} aria-current={on ? "page" : undefined} className="relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[10px] py-1">
              {on && <motion.span layoutId="dock-on" className="absolute inset-x-1 inset-y-0 rounded-[10px] bg-accent" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <span className={cn("relative [&_svg]:size-5", on ? "text-accent-ink" : "text-muted")}><h.icon /></span>
              <span className={cn("relative text-[11px] font-semibold", on ? "text-accent-ink" : "text-muted")}>{h.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ today drawer */

const KIND_ICON: Record<TodayKind, ReactNode> = {
  inbox: <Inbox />, press: <Megaphone />, sponsor: <Handshake />, contract: <Contact />, offer_in: <Gavel />, counter: <Gavel />, academy: <Sprout />, duel: <Swords />,
};
const KIND_LABEL: Record<TodayKind, string> = {
  inbox: "Gabinete", press: "Imprensa", sponsor: "Patrocínio", contract: "Contrato", offer_in: "Proposta recebida", counter: "Contraproposta", academy: "Formação", duel: "Duelo",
};

function TodayDrawer({ open, onClose, items, round }: { open: boolean; onClose: () => void; items: TodayItem[]; round: number }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button type="button" aria-label="Fechar" className="fixed inset-0 z-50 bg-scrim" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside role="dialog" aria-modal="true" aria-label="Por decidir"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l border-line bg-surface shadow-[var(--tl-shadow)]"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 420, damping: 40 }}>
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <p className="eyebrow">Hoje</p>
                <h2 className="headline mt-1 text-3xl">Por decidir</h2>
              </div>
              <button type="button" onClick={onClose} aria-label="Fechar" className="flex size-10 items-center justify-center rounded-[10px] text-muted hover:bg-surface-2 hover:text-ink"><X className="size-5" /></button>
            </div>
            <div className="thin-scroll flex-1 space-y-2 overflow-y-auto p-4">
              {items.length === 0 && (
                <div className="rounded-xl border border-dashed border-line-strong px-5 py-10 text-center">
                  <p className="font-display text-xl font-black uppercase">Tudo respondido</p>
                  <p className="mt-1 text-sm text-muted">Não há decisões pendentes para esta jornada.</p>
                </div>
              )}
              {items.map((i) => {
                const urgent = i.dueRound !== null && i.dueRound <= round + 1;
                return (
                  <Link key={`${i.kind}:${i.id}`} href={i.href} prefetch={false} className="group flex gap-3 rounded-xl bg-surface-2 p-3.5 transition hover:bg-surface-3">
                    <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-ink [&_svg]:size-[18px]">{KIND_ICON[i.kind]}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted">
                        {KIND_LABEL[i.kind]}
                        {i.dueRound !== null && <span className={urgent ? "text-warn" : undefined}>até à J{i.dueRound}</span>}
                      </span>
                      <span className="mt-0.5 block font-semibold leading-snug text-ink">{i.title}</span>
                      {i.detail && <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{i.detail}</span>}
                    </span>
                    <ChevronRight className="mt-2 size-4 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-ink" />
                  </Link>
                );
              })}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
