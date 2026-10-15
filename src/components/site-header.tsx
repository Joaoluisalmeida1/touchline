import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { logoutAction } from "@/server/actions";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 font-black tracking-tight">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect x="1" y="1" width="30" height="30" rx="8" fill="#16223a" stroke="#34d399" strokeWidth="2" />
        <path d="M16 1v30M1 16h30" stroke="#34d399" strokeOpacity=".35" />
        <circle cx="16" cy="16" r="5" fill="none" stroke="#38bdf8" strokeWidth="2" />
      </svg>
      <span>{APP_NAME}</span>
    </Link>
  );
}

export function SiteHeader({ user }: { user?: { email: string | null } | null }) {
  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Logo />
        <nav className="flex items-center gap-1 text-sm">
          {user ? (
            <>
              <Link href="/dashboard" className="rounded-lg px-3 py-2 text-muted hover:text-ink">As minhas ligas</Link>
              <form action={logoutAction}>
                <button className="rounded-lg px-3 py-2 text-muted hover:text-ink" type="submit">Sair</button>
              </form>
            </>
          ) : (
            <Link href="/auth" className="rounded-lg px-3 py-2 font-semibold text-accent hover:brightness-110">Entrar</Link>
          )}
        </nav>
      </div>
    </header>
  );
}
