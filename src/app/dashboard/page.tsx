import Link from "next/link";
import { ArrowRight, Database, KeyRound, Plus, Trophy, Users } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Crest } from "@/components/crest";
import { Stagger, StaggerItem } from "@/components/fx/motion";
import { SiteHeader } from "@/components/site-header";
import { Badge, ButtonLink, Card, CardTitle, Empty, Field, Headline, cn, inputCls } from "@/components/ui";
import { joinGameAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getProfile, listMyGames } from "@/server/queries";

export const metadata = { title: "As minhas ligas" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, "accent" | "info" | "default"]> = {
  setup: ["Em preparação", "info"], active: ["A decorrer", "accent"], finished: ["Terminada", "default"], archived: ["Arquivada", "default"],
};

export default async function Dashboard() {
  const user = await requireUser("/dashboard");
  const [games, profile] = await Promise.all([listMyGames(user.id), getProfile(user.id)]);
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:pt-12">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <Headline kicker={`Olá, ${profile?.display_name ?? "treinador"}`}>As minhas ligas</Headline>
          <div className="flex gap-2">
            {profile?.is_admin && <ButtonLink href="/admin/import" variant="secondary"><Database className="size-4" />Admin · Dados</ButtonLink>}
            <ButtonLink href="/games/new"><Plus className="size-4" strokeWidth={3} />Criar liga</ButtonLink>
          </div>
        </div>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Stagger className="space-y-3">
            {games.length === 0 && (
              <StaggerItem>
                <Empty title="Ainda não estás em nenhuma liga" icon={<Trophy />}>Cria uma liga e convida os teus amigos, ou usa um código de convite aqui ao lado.</Empty>
              </StaggerItem>
            )}
            {games.map((g) => {
              const [label, tone] = STATUS[g.status] ?? [g.status, "default"];
              const total = Number(g.total_rounds ?? 0);
              const pct = total ? (g.current_matchday / total) * 100 : 0;
              return (
                <StaggerItem key={g.id}>
                  <Link href={`/g/${g.id}`} className="group block">
                    <Card interactive className="overflow-hidden">
                      {g.primary_color && <div aria-hidden className="pointer-events-none absolute -left-16 top-1/2 size-56 -translate-y-1/2 rounded-full opacity-[.14] blur-2xl" style={{ background: g.primary_color }} />}
                      <div className="relative flex items-center gap-4">
                        {g.club_id ? (
                          <Crest id={g.club_id} name={g.club_name} short={g.club_short} color={g.primary_color} color2={g.secondary_color} size={56} className="shrink-0" />
                        ) : (
                          <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-dashed border-line-strong text-faint"><Plus className="size-5" /></span>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={tone} dot={g.status === "active"}>{label}</Badge>
                            {g.is_owner && <Badge tone="info">Criador</Badge>}
                            {g.is_synthetic && <Badge tone="warn">Dados fictícios</Badge>}
                            {g.unread > 0 && <Badge tone="accent">{g.unread} novas</Badge>}
                          </div>
                          <h2 className="mt-1.5 truncate font-display text-2xl font-extrabold uppercase leading-tight tracking-tight">{g.name}</h2>
                          <p className="mt-0.5 truncate text-sm text-muted">
                            {g.club_name ?? "Ainda sem clube — escolhe um"}{g.league_name ? <span className="text-faint"> · {g.league_name}</span> : null}
                          </p>
                        </div>
                        <div className="hidden w-36 shrink-0 text-right sm:block">
                          <p className="font-display text-2xl font-extrabold leading-none tabular">J{g.current_matchday}<span className="text-base text-faint">/{total || "–"}</span></p>
                          <div className="mt-2 h-1 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} /></div>
                          <p className="mt-2 flex items-center justify-end gap-1 text-xs text-muted"><Users className="size-3.5" />{g.members} managers · Época {g.current_season}</p>
                        </div>
                        <ArrowRight className={cn("size-5 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-accent")} />
                      </div>
                    </Card>
                  </Link>
                </StaggerItem>
              );
            })}
          </Stagger>
          <div>
            <Card className="lg:sticky lg:top-20">
              <CardTitle icon={<KeyRound />}>Entrar com convite</CardTitle>
              <ActionForm action={joinGameAction} submitLabel="Entrar na liga" pendingLabel="A entrar…" submitClassName="w-full">
                <Field label="Código de convite" hint="16 caracteres, recebido do criador da liga.">
                  <input name="code" required minLength={16} maxLength={24} placeholder="XXXX XXXX XXXX XXXX" className={`${inputCls} font-mono text-base uppercase tracking-[0.2em]`} autoComplete="off" />
                </Field>
              </ActionForm>
            </Card>
          </div>
        </div>
      </main>
    </>
  );
}
