import { ButtonLink, Card } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { getUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getUser().catch(() => null);
  const features = [
    ["Ligas privadas", "Cria uma liga, partilha um código e joga com 4 a 20 amigos. Os clubes vazios ficam com a IA."],
    ["Jogos simulados lance a lance", "Um motor determinístico por posses gera golos, xG, remates, cartões e notas — tudo a partir dos mesmos eventos."],
    ["Evolução credível", "Forma, fitness e moral mudam todas as jornadas; o OVR evolui devagar, com explicação para cada ponto."],
    ["Mercado seguro", "Propostas, contrapropostas da IA e transferências atómicas. Sem dinheiro duplicado, sem jogadores em dois clubes."],
  ];
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-6xl px-4 py-16">
        <section className="max-w-3xl">
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-accent">Futebol · gestão · amigos</p>
          <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-6xl">
            A tua liga. As tuas decisões. <span className="text-info">Jornada a jornada.</span>
          </h1>
          <p className="mt-5 text-lg text-muted">{APP_TAGLINE} Aprende em cinco minutos e tem profundidade para uma época inteira.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={user ? "/dashboard" : "/auth?mode=signup"}>{user ? "Ir para as minhas ligas" : "Criar conta grátis"}</ButtonLink>
            {!user && <ButtonLink href="/auth" variant="secondary">Já tenho conta</ButtonLink>}
          </div>
        </section>
        <section className="mt-16 grid gap-4 sm:grid-cols-2">
          {features.map(([t, d]) => (
            <Card key={t}>
              <h2 className="font-bold">{t}</h2>
              <p className="mt-1 text-sm text-muted">{d}</p>
            </Card>
          ))}
        </section>
        <p className="mt-16 text-xs text-faint">
          {APP_NAME} é um jogo independente, sem licenças oficiais de ligas ou clubes. Sem compras na app nem apostas.
        </p>
      </main>
    </>
  );
}
