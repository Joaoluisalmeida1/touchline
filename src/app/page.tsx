import { ArrowLeftRight, ArrowRight, Cpu, LineChart, Users } from "lucide-react";
import { ButtonLink } from "@/components/ui";
import { Reveal, Stagger, StaggerItem } from "@/components/fx/motion";
import { SiteHeader } from "@/components/site-header";
import { ClubBadge, Shirt } from "@/components/squad/avatar";
import { APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { getUser } from "@/server/auth";

export const dynamic = "force-dynamic";

// Purely decorative, fictional clubs for the ticker / hero mock-up.
const TICKER: [string, string, number, number, string, string][] = [
  ["Rio Manso", "RMF", 2, 1, "#1d4ed8", "#ffffff"], ["Praia Funda", "PFS", 3, 3, "#0f766e", "#f8fafc"], ["Alto Vento", "AVA", 0, 1, "#dc2626", "#ffffff"],
  ["Torre Velha", "TVD", 4, 2, "#ea580c", "#111827"], ["Quinta Real", "QRU", 1, 0, "#7c3aed", "#fde68a"], ["Ponte Seca", "PSF", 2, 2, "#be123c", "#ffffff"],
];
const XI = [[50, 8], [16, 26], [38, 22], [62, 22], [84, 26], [30, 48], [50, 42], [70, 48], [18, 72], [50, 78], [82, 72]];

function HeroArt() {
  return (
    <div className="relative mx-auto w-full max-w-[460px]">
      <div aria-hidden className="absolute -inset-10 rounded-full bg-accent/10 blur-3xl" />
      <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] border border-line-strong bg-pitch shadow-[0_40px_120px_-40px_rgb(0_0_0/.9)]">
        <div aria-hidden className="absolute inset-0 bg-[repeating-linear-gradient(0deg,rgb(255_255_255/.035)_0,rgb(255_255_255/.035)_10%,transparent_10%,transparent_20%)]" />
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 125" preserveAspectRatio="none" aria-hidden>
          <g fill="none" stroke="rgb(255 255 255 / .22)" strokeWidth=".4">
            <rect x="4" y="4" width="92" height="117" rx="1" /><line x1="4" y1="62.5" x2="96" y2="62.5" /><circle cx="50" cy="62.5" r="10" />
            <rect x="24" y="4" width="52" height="18" /><rect x="24" y="103" width="52" height="18" />
          </g>
        </svg>
        {XI.map(([x, y], i) => (
          <div key={i} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${x}%`, top: `${100 - y}%` }}>
            <Shirt primary="#d4ff3a" secondary="#0b0e00" number={[1, 2, 4, 5, 3, 8, 6, 10, 7, 9, 11][i]} size={34} />
          </div>
        ))}
        <div className="absolute inset-x-4 top-4 flex items-center gap-2 rounded-2xl border border-white/10 bg-black/55 p-2 backdrop-blur-md">
          <ClubBadge seed="hero-a" name="Rio Manso" short="RMF" primary="#1d4ed8" secondary="#ffffff" size={28} />
          <span className="font-display text-sm font-bold uppercase">RMF</span>
          <span className="mx-auto rounded-lg bg-accent px-2.5 font-display text-xl font-extrabold text-accent-ink tabular">2 – 1</span>
          <span className="font-display text-sm font-bold uppercase">PFS</span>
          <ClubBadge seed="hero-b" name="Praia Funda" short="PFS" primary="#0f766e" secondary="#f8fafc" size={28} />
          <span className="ml-1 flex items-center gap-1 rounded-md bg-danger/90 px-1.5 py-0.5 text-[10px] font-black uppercase text-white"><span className="size-1.5 animate-pulse rounded-full bg-white" />78&apos;</span>
        </div>
        <div className="absolute inset-x-4 bottom-4 rounded-2xl border border-white/10 bg-black/55 p-3 backdrop-blur-md">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-white/60"><span>Posse</span><span>xG 1.84 – 0.92</span></div>
          <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full"><div className="w-[58%] bg-accent" /><div className="flex-1 bg-white/25" /></div>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const user = await getUser().catch(() => null);
  const features: [React.ReactNode, string, string][] = [
    [<Users key="u" />, "Ligas privadas", "Cria uma liga, partilha um código e joga com 4 a 20 amigos. Os clubes vazios ficam com a IA."],
    [<Cpu key="c" />, "Jogos simulados lance a lance", "Um motor determinístico por posses gera golos, xG, remates, cartões e notas — tudo a partir dos mesmos eventos."],
    [<LineChart key="l" />, "Evolução credível", "Forma, fitness e moral mudam todas as jornadas; o OVR evolui devagar, com explicação para cada ponto."],
    [<ArrowLeftRight key="a" />, "Mercado seguro", "Propostas, contrapropostas da IA e transferências atómicas. Sem dinheiro duplicado, sem jogadores em dois clubes."],
  ];
  return (
    <>
      <SiteHeader user={user} />
      <div className="relative overflow-hidden">
        <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0" />
        <main className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:pt-20 lg:grid-cols-[1.15fr_1fr]">
          <Reveal>
            <p className="eyebrow mb-5">Futebol · gestão · amigos</p>
            <h1 className="headline text-[44px] sm:text-[84px]">
              A tua liga.<br />As tuas decisões.<br /><span className="italic text-accent">Jornada a jornada.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-muted">{APP_TAGLINE} Aprende em cinco minutos e tem profundidade para uma época inteira.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={user ? "/dashboard" : "/auth?mode=signup"} className="min-h-12 px-6 text-base">
                {user ? "Ir para as minhas ligas" : "Criar conta grátis"}<ArrowRight className="size-4" />
              </ButtonLink>
              {!user && <ButtonLink href="/auth" variant="secondary" className="min-h-12 px-6 text-base">Já tenho conta</ButtonLink>}
            </div>
          </Reveal>
          <Reveal delay={0.15}><HeroArt /></Reveal>
        </main>
      </div>

      <div className="relative overflow-hidden border-y border-line bg-surface/60 py-3" aria-hidden>
        <div className="flex w-max animate-marquee gap-8">
          {[...TICKER, ...TICKER, ...TICKER, ...TICKER].map(([n, s, h, a, c1, c2], i) => (
            <span key={i} className="flex items-center gap-2 whitespace-nowrap font-display text-lg font-bold uppercase text-muted">
              <ClubBadge seed={`t${i % 6}`} name={n} short={s} primary={c1} secondary={c2} size={22} />{n}
              <span className="rounded-md bg-surface-3 px-2 text-ink tabular">{h}–{a}</span>
              <span className="text-faint">{TICKER[(i + 1) % 6][0]}</span>
              <span className="ml-4 text-accent">/</span>
            </span>
          ))}
        </div>
      </div>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <Stagger className="grid gap-4 sm:grid-cols-2">
          {features.map(([icon, t, d], i) => (
            <StaggerItem key={t} className={i === 0 || i === 3 ? "sm:col-span-1" : ""}>
              <div className="surface group h-full rounded-[var(--radius-card)] p-6 transition hover:border-line-strong">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/25 transition group-hover:scale-110 [&_svg]:size-5">{icon}</span>
                <h2 className="mt-5 font-display text-2xl font-extrabold uppercase tracking-tight">{t}</h2>
                <p className="mt-2 text-sm leading-6 text-muted">{d}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
        <p className="mt-16 text-xs text-faint">
          {APP_NAME} é um jogo independente, sem licenças oficiais de ligas ou clubes. Sem compras na app nem apostas.
        </p>
      </section>
    </>
  );
}
