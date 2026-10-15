import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { SiteHeader } from "@/components/site-header";
import { Badge, ButtonLink, Card, CardTitle, ClubDot, Empty, Field, inputCls } from "@/components/ui";
import { joinGameAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getProfile, listMyGames } from "@/server/queries";

export const metadata = { title: "As minhas ligas" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { setup: "Em preparação", active: "A decorrer", finished: "Terminada", archived: "Arquivada" };

export default async function Dashboard() {
  const user = await requireUser("/dashboard");
  const [games, profile] = await Promise.all([listMyGames(user.id), getProfile(user.id)]);
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Olá, {profile?.display_name ?? "treinador"}</p>
            <h1 className="text-3xl font-black tracking-tight">As minhas ligas</h1>
          </div>
          <div className="flex gap-2">
            {profile?.is_admin && <ButtonLink href="/admin/import" variant="secondary">Admin · Dados</ButtonLink>}
            <ButtonLink href="/games/new">Criar liga</ButtonLink>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            {games.length === 0 && (
              <Empty title="Ainda não estás em nenhuma liga">Cria uma liga e convida os teus amigos, ou usa um código de convite.</Empty>
            )}
            {games.map((g) => (
              <Link key={g.id} href={`/g/${g.id}`} className="block">
                <Card className="transition hover:border-faint">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-lg font-bold">{g.name}</h2>
                        {g.is_owner && <Badge tone="info">Criador</Badge>}
                        {g.is_synthetic && <Badge tone="warn">Dados fictícios</Badge>}
                      </div>
                      <p className="mt-1 flex items-center gap-2 text-sm text-muted">
                        {g.club_name ? (<><ClubDot color={g.primary_color} /> {g.club_name}</>) : "Ainda sem clube — escolhe um"}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <Badge tone={g.status === "active" ? "accent" : "default"}>{STATUS[g.status] ?? g.status}</Badge>
                      <p className="mt-1 text-muted">
                        Época {g.current_season} · Jornada {g.current_matchday} · {g.members} managers
                        {g.unread > 0 && <span className="ml-2 font-semibold text-info">{g.unread} novas</span>}
                      </p>
                    </div>
                  </div>
                </Card>
              </Link>
            ))}
          </div>
          <Card>
            <CardTitle>Entrar com convite</CardTitle>
            <ActionForm action={joinGameAction} submitLabel="Entrar na liga" pendingLabel="A entrar…">
              <Field label="Código de convite" hint="16 caracteres, recebido do criador da liga.">
                <input name="code" required minLength={16} maxLength={24} className={`${inputCls} font-mono uppercase tracking-widest`} autoComplete="off" />
              </Field>
            </ActionForm>
          </Card>
        </div>
      </main>
    </>
  );
}
