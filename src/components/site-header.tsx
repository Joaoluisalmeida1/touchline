import Link from "next/link";
import { LogOut, Trophy } from "lucide-react";
import { APP_NAME } from "@/lib/brand";
import { logoutAction } from "@/server/actions";

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="tl-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#efffb0" /><stop offset=".55" stopColor="#d4ff3a" /><stop offset="1" stopColor="#8fc70a" /></linearGradient>
      </defs>
      <path d="M7 2h22l-4 28H3z" fill="url(#tl-g)" />
      <path d="M10.5 9.5h13M16.7 9.5 14.4 25" stroke="#0b0e00" strokeWidth="3.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" prefetch={false} className="group flex items-center gap-2" aria-label={`${APP_NAME} — início`}>
      <span className="transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110"><LogoMark /></span>
      <span className="font-display text-[22px] font-extrabold uppercase italic leading-none tracking-tight">{APP_NAME}</span>
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
    <header className="sticky top-0 z-40 border-b border-line/80 bg-bg/75 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
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
            <Link href="/auth" className="rounded-xl bg-accent px-4 py-2 font-bold text-accent-ink transition hover:brightness-105">Entrar</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
