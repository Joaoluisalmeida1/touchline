import Link from "next/link";
import { LogOut, Trophy } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { logoutAction } from "@/server/actions";
import { ThemeToggle } from "./shell/theme-toggle";

/** Touchline mark: a pitch outline with the touchline drawn in brand blue. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" aria-hidden>
      <rect x="1.5" y="1.5" width="31" height="31" rx="4" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <rect x="1" y="1" width="9" height="32" rx="3" fill="var(--color-brand)" />
      <path d="M21.5 1.5v31" stroke="currentColor" strokeWidth="1.5" opacity=".35" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" prefetch={false} className="group flex items-center gap-2.5" aria-label={`${APP_NAME} — início`}>
      <LogoMark />
      <span className="font-display text-[22px] font-black uppercase leading-none tracking-[0.02em] [font-stretch:66%]">{APP_NAME}</span>
    </Link>
  );
}

function Initials({ email }: { email: string | null }) {
  const s = (email ?? "?").split("@")[0].replace(/[^a-z0-9]/gi, " ").trim();
  const ini = s.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <span className="flex size-8 items-center justify-center rounded-full bg-surface-3 font-display text-sm font-bold text-ink ring-1 ring-line-strong" title={email ?? undefined}>{ini}</span>
  );
}

export function SiteHeader({ user }: { user?: { email: string | null } | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Logo />
        <nav className="flex items-center gap-1.5 text-sm">
          <ThemeToggle />
          {user ? (
            <>
              <Link href="/dashboard" prefetch={false} className="flex items-center gap-2 rounded-xl px-3 py-2 font-semibold text-muted transition hover:bg-surface-2 hover:text-ink">
                <Trophy className="size-4" /><span className="hidden sm:inline">As minhas ligas</span>
              </Link>
              <form action={logoutAction}>
                <button className="flex items-center gap-2 rounded-xl px-2.5 py-2 font-semibold text-muted transition hover:bg-surface-2 hover:text-ink" type="submit" aria-label="Sair">
                  <LogOut className="size-4" /><span className="hidden sm:inline">Sair</span>
                </button>
              </form>
              <Initials email={user.email} />
            </>
          ) : (
            <Link href="/auth" className="rounded-[10px] bg-accent px-4 py-2 font-bold text-accent-ink transition hover:brightness-110">Entrar</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
