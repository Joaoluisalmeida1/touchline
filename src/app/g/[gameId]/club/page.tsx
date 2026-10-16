import { Building2, Construction, Handshake, Landmark, Star, Ticket, Users } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { SectionTabs } from "@/components/club/section-tabs";
import { Badge, Card, CardTitle, Empty, Stat, cn, eur } from "@/components/ui";
import {
  BOARD, DEAL_KIND, SLOTS, STAFF, UPGRADES, matchdayGate, ticketPriceEur, type Slot, type StaffRole, type TicketPrice,
} from "@/engine/economy/business";
import { hireStaffAction, setBudgetShiftAction, setTicketPriceAction, signSponsorAction, startUpgradeAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getClubOffice } from "@/server/club-queries";
import { getPool } from "@/server/db";
import { ensureBusiness } from "@/server/services/business";

export const metadata = { title: "Clube" };
type Office = NonNullable<Awaited<ReturnType<typeof getClubOffice>>>;
type Tab = "direcao" | "patrocinios" | "estadio" | "staff";

const PRICE: { id: TicketPrice; label: string; hint: string }[] = [
  { id: "low", label: "Baixo", hint: "Mais público, adeptos contentes (+1 humor/jornada)" },
  { id: "normal", label: "Normal", hint: "Equilíbrio" },
  { id: "high", label: "Alto", hint: "Mais receita por bilhete, menos público (−1 humor/jornada)" },
];

export default async function ClubPage({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { gameId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  await ensureBusiness(getPool(), gameId).catch((e) => console.error(JSON.stringify({ level: "error", msg: "business.ensure_failed", error: (e as Error).message })));
  const o = await getClubOffice(user.id, gameId);
  if (!o) return <Empty title="Ainda não tens clube">Escolhe um clube no Resumo.</Empty>;
  if (o.status !== "active" || !o.board || !o.biz) return <Empty title="A liga ainda não começou" icon={<Landmark />}>A direção define objetivos e orçamento quando a liga arrancar.</Empty>;
  const openSlots = new Set(o.offers.map((x) => x.slot)).size;
  const initial: Tab = (["direcao", "patrocinios", "estadio", "staff"] as const).find((t) => t === sp.tab) ?? (openSlots ? "patrocinios" : "direcao");
  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow mb-2">Época {o.current_season} · {o.info.name_snapshot}</p>
        <h2 className="headline text-4xl sm:text-5xl">Negócio do clube</h2>
      </header>
      <SectionTabs<Tab> label="Clube" initial={initial} tabs={[
        { id: "direcao", label: "Direção" }, { id: "patrocinios", label: "Patrocínios", badge: openSlots },
        { id: "estadio", label: "Estádio" }, { id: "staff", label: "Staff" },
      ]} panels={{
        direcao: <Board o={o} gameId={gameId} />,
        patrocinios: <Sponsors o={o} gameId={gameId} />,
        estadio: <Stadium o={o} gameId={gameId} />,
        staff: <StaffPanel o={o} gameId={gameId} />,
      }} />
    </div>
  );
}

function Gauge({ value }: { value: number }) {
  const tone = value < BOARD.ultimatum ? "bg-danger" : value < BOARD.warning ? "bg-warn" : value >= BOARD.praise ? "bg-accent" : "bg-info";
  return (
    <div className="space-y-1.5">
      <div className="relative h-3 overflow-hidden rounded-full bg-line" role="meter" aria-label="Confiança da direção" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full transition-[width] duration-700", tone)} style={{ width: `${value}%` }} />
        {[BOARD.ultimatum, BOARD.warning, BOARD.praise].map((m) => <span key={m} className="absolute inset-y-0 w-px bg-bg/80" style={{ left: `${m}%` }} />)}
      </div>
      <div className="relative h-4 text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
        {([[BOARD.ultimatum, `${BOARD.ultimatum}`], [BOARD.warning, `${BOARD.warning}`], [BOARD.praise, `${BOARD.praise}`]] as const).map(([m, l]) => (
          <span key={m} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${m}%` }}>{l}</span>
        ))}
      </div>
    </div>
  );
}

function BudgetBar({ label, used, budget, unit }: { label: string; used: number; budget: number; unit: string }) {
  const pct = budget > 0 ? Math.min(100, (used / budget) * 100) : used > 0 ? 100 : 0;
  const over = used > budget;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="font-semibold">{label}</span>
        <span className={cn("tabular", over ? "font-bold text-danger" : "text-muted")}>{eur(used)} / {eur(budget)} <span className="text-faint">{unit}</span></span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line"><div className={cn("h-full rounded-full", over ? "bg-danger" : "bg-accent")} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Board({ o, gameId }: { o: Office; gameId: string }) {
  const b = o.board!;
  const hist = [...(b.history ?? [])].reverse().slice(0, 8);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <Card glow={b.confidence >= BOARD.praise}>
          <CardTitle icon={<Landmark />} action={b.flags?.ultimatum ? <Badge tone="danger">Ultimato</Badge> : b.flags?.warning ? <Badge tone="warn">Aviso</Badge> : b.flags?.praise ? <Badge tone="accent">Satisfeita</Badge> : undefined}>Confiança da direção</CardTitle>
          <p className="mb-3 font-display text-6xl font-extrabold leading-none tabular">{b.confidence}<span className="text-2xl text-faint">/100</span></p>
          <Gauge value={b.confidence} />
          <p className="mt-4 text-sm"><span className="text-muted">Objetivo da época:</span> <b>{b.objective.label}</b></p>
          <p className="mt-2 text-xs text-faint">A confiança sobe e desce com os resultados face ao esperado (força dos clubes), o saldo, os salários e os gastos em transferências. Abaixo de {BOARD.ultimatum} a direção corta {Math.round(BOARD.ultimatumCut * 100)}% do orçamento de transferências; acima de {BOARD.praise} reforça-o em {Math.round(BOARD.praiseBoost * 100)}%. Ninguém é despedido.</p>
        </Card>
        <Card>
          <CardTitle>Orçamento</CardTitle>
          <div className="space-y-4">
            <BudgetBar label="Transferências (época)" used={o.spent} budget={o.budgets!.transfer} unit="gasto" />
            <BudgetBar label="Salários (por jornada)" used={o.wageBill} budget={o.budgets!.wage} unit="jogadores + staff" />
          </div>
          <ActionForm action={setBudgetShiftAction} hidden={{ gameId }} submitLabel="Ajustar" variant="secondary" className="mt-5 space-y-3">
            <fieldset disabled={o.current_matchday > 3}>
              <legend className="mb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Mover entre transferências e salários</legend>
              <div className="grid grid-cols-5 gap-1 rounded-xl border border-line bg-bg/70 p-1">
                {[-20, -10, 0, 10, 20].map((v) => (
                  <label key={v} className="cursor-pointer rounded-lg px-1 py-2 text-center text-xs font-bold text-muted transition hover:bg-surface-2 has-[:checked]:bg-accent has-[:checked]:text-accent-ink">
                    <input type="radio" name="shift" value={v} defaultChecked={b.shift_pct === v} className="sr-only" />
                    {v > 0 ? `+${v}%` : `${v}%`}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-faint">Positivo = mais para transferências, menos para salários. {o.current_matchday > 3 ? "Fechado — só nas 3 primeiras jornadas." : "Disponível até à jornada 3."}</p>
            </fieldset>
          </ActionForm>
        </Card>
      </div>
      <Card>
        <CardTitle>O que a direção anotou</CardTitle>
        {hist.length ? (
          <ul className="space-y-2 text-sm">
            {hist.map((h, i) => (
              <li key={i} className="flex items-center gap-2.5">
                <span className={cn("w-9 text-right font-display font-bold tabular", h.delta > 0 ? "text-accent" : "text-danger")}>{h.delta > 0 ? `+${h.delta}` : h.delta}</span>
                <span className="flex-1">{h.reason}</span>
                <span className="text-[10px] font-bold text-faint">J{h.round}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Ainda nada. A direção avalia depois de cada jornada.</p>}
      </Card>
    </div>
  );
}

function Sponsors({ o, gameId }: { o: Office; gameId: string }) {
  const slots = Object.keys(SLOTS) as Slot[];
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        {slots.map((slot) => {
          const deal = o.deals.find((d) => d.slot === slot);
          const offers = o.offers.filter((x) => x.slot === slot);
          return (
            <Card key={slot} glow={!deal && offers.length > 0}>
              <CardTitle icon={<Handshake />} action={deal ? <Badge tone="accent">Até à época {deal.end_season}</Badge> : offers.length ? <Badge tone="warn" dot>Escolhe até à J{offers[0].deadline_round}</Badge> : undefined}>{SLOTS[slot].label}</CardTitle>
              {deal ? (
                <div>
                  <p className="font-display text-2xl font-bold uppercase">{deal.brand}</p>
                  <DealTerms kind={deal.kind} base={Number(deal.base_cents)} win={Number(deal.win_bonus_cents)} clause={deal.clause} />
                  {deal.signed_by !== "manager" && <p className="mt-2 text-xs text-faint">{deal.signed_by === "default" ? "Assinado por omissão (prazo terminou)." : "Assinado pela administração."}</p>}
                </div>
              ) : offers.length ? (
                <ul className="space-y-2.5">
                  {offers.map((x) => (
                    <li key={x.id} className="rounded-2xl border border-line bg-bg/50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-bold">{x.brand}</p>
                          <DealTerms kind={x.kind} base={Number(x.base_cents)} win={Number(x.win_bonus_cents)} clause={x.clause} seasons={x.seasons} />
                        </div>
                        <ActionForm action={signSponsorAction} hidden={{ gameId, offerId: x.id }} submitLabel="Assinar" inline variant={x.kind === "fixed" ? "secondary" : "primary"} />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted">Sem propostas esta época.</p>}
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-faint">Sem escolha até ao prazo, o clube assina a proposta fixa. Os clubes da IA assinam sempre a fixa. Os bónus de objetivo são pagos no fim da época.</p>
    </div>
  );
}

function DealTerms({ kind, base, win, clause, seasons }: { kind: string; base: number; win: number; clause: { top: number; bonus_cents: number } | null; seasons?: number }) {
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
      <span className="font-bold text-ink">{DEAL_KIND[kind as keyof typeof DEAL_KIND]?.label ?? kind}</span>
      <span>{eur(base)}/jornada</span>
      {win > 0 && <span>+{eur(win)} por vitória</span>}
      {clause && <span>+{eur(clause.bonus_cents)} se acabar no top {clause.top}</span>}
      {seasons && <span>{seasons} {seasons === 1 ? "época" : "épocas"}</span>}
    </div>
  );
}

function Stadium({ o, gameId }: { o: Office; gameId: string }) {
  const s = o.stadium!, b = o.biz!;
  const rep = o.info.reputation;
  const est = (p: TicketPrice) => matchdayGate({ capacity: s.capacity, vip_level: s.vip_level, fan_mood: b.fan_mood, ticket_price: p, reputation: rep }, 60);
  const cash = Number(o.info.cash_cents) - Number(o.info.reserved_cents);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Lotação">{s.capacity.toLocaleString("pt-PT")}</Stat>
          <Stat label="Humor dos adeptos" tone={b.fan_mood >= 60 ? "accent" : b.fan_mood < 35 ? "danger" : undefined}>{b.fan_mood}</Stat>
          <Stat label="Camarotes">{s.vip_level}</Stat>
          <Stat label="Bilhete" hint={PRICE.find((p) => p.id === b.ticket_price)?.label}>€{ticketPriceEur(rep, b.ticket_price)}</Stat>
        </div>
        <Card>
          <CardTitle icon={<Ticket />}>Preço dos bilhetes</CardTitle>
          <ActionForm action={setTicketPriceAction} hidden={{ gameId }} submitLabel="Guardar preço" className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3">
              {PRICE.map((p) => {
                const e = est(p.id);
                return (
                  <label key={p.id} className="cursor-pointer rounded-2xl border border-line bg-bg/50 p-3 transition hover:border-line-strong has-[:checked]:border-accent/60 has-[:checked]:bg-accent/8">
                    <input type="radio" name="level" value={p.id} defaultChecked={b.ticket_price === p.id} className="sr-only" />
                    <span className="flex items-baseline justify-between"><span className="font-display text-lg font-bold uppercase">{p.label}</span><span className="font-bold tabular">€{ticketPriceEur(rep, p.id)}</span></span>
                    <span className="mt-1 block text-xs text-muted">{p.hint}</span>
                    <span className="mt-2 block text-xs"><b className="tabular">{e.attendance.toLocaleString("pt-PT")}</b> <span className="text-faint">espectadores ·</span> <b className="tabular">{eur(e.cents)}</b> <span className="text-faint">por jogo (estimativa)</span></span>
                  </label>
                );
              })}
            </div>
          </ActionForm>
        </Card>
        <Card>
          <CardTitle icon={<Construction />}>Obras</CardTitle>
          {s.building.length > 0 && (
            <p className="mb-3 rounded-xl bg-warn/10 px-3 py-2 text-sm text-warn">Em construção: {s.building.map((u) => UPGRADES[u.kind].label).join(", ")} — pronta {readyText(s.building[0].ready_at, o.current_season)}.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(UPGRADES) as (keyof typeof UPGRADES)[]).map((k) => {
              const u = UPGRADES[k];
              const done = (o.biz!.upgrades ?? []).filter((x) => x.kind === k).length;
              const blocked = s.building.length > 0 || done >= u.max || cash < u.costEur * 100;
              return (
                <div key={k} className="rounded-2xl border border-line bg-bg/50 p-3">
                  <p className="font-bold">{u.label}</p>
                  <p className="mt-1 text-xs text-muted">{eur(u.costEur * 100)} · {u.rounds} jornadas · {done}/{u.max} feitas</p>
                  <ActionForm action={startUpgradeAction} hidden={{ gameId, kind: k }} submitLabel="Construir" variant="secondary" inline className="mt-3"
                    confirm={`Investir ${eur(u.costEur * 100)} em "${u.label}"?`} />
                  {blocked && <p className="mt-1 text-[11px] text-faint">{done >= u.max ? "Máximo atingido." : s.building.length ? "Uma obra de cada vez." : "Saldo insuficiente."}</p>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <Card>
        <CardTitle icon={<Users />}>Últimos jogos em casa</CardTitle>
        {o.attendance.length ? (
          <ul className="space-y-2 text-sm">
            {o.attendance.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <span className="truncate"><span className="text-faint">J{a.round_number}</span> vs {a.away}</span>
                <span className="font-display font-bold tabular">{a.attendance.toLocaleString("pt-PT")}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Ainda sem jogos em casa com o novo modelo de bilheteira.</p>}
        <p className="mt-4 text-xs text-faint">O humor sobe com vitórias (+3) e bilhetes baratos, desce com derrotas (−3) e bilhetes caros, e volta devagar a 50.</p>
      </Card>
    </div>
  );
}

function readyText(readyAt: number, season: number) {
  const s = Math.floor(readyAt / 100), r = readyAt % 100;
  return s > season ? "no início da próxima época" : `depois da jornada ${r}`;
}

function StaffPanel({ o, gameId }: { o: Office; gameId: string }) {
  const roles = Object.keys(STAFF) as StaffRole[];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Staff custa <b className="text-ink">{eur(o.staffWages)}</b> por jornada. Substituir alguém paga 2 jornadas de indemnização ao que sai.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((role) => {
          const cur = o.staff.find((s) => s.role === role);
          const cands = o.candidates.filter((c) => c.role === role);
          return (
            <Card key={role}>
              <CardTitle icon={<Building2 />}>{STAFF[role].label}</CardTitle>
              {cur ? (
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-bold">{cur.name}</p>
                    <p className="text-xs text-muted">{STAFF[role].effect(cur.level)}</p>
                  </div>
                  <div className="text-right"><Stars n={cur.level} /><p className="text-xs text-faint tabular">{eur(Number(cur.wage_cents))}/jornada</p></div>
                </div>
              ) : <p className="mb-3 text-sm text-muted">Vago.</p>}
              {cands.length > 0 && (
                <ul className="space-y-1.5 border-t border-line pt-3">
                  {cands.map((c) => (
                    <li key={c.id} className="flex items-center gap-2.5 text-sm">
                      <Stars n={c.level} />
                      <span className="flex-1 truncate font-medium">{c.name}<span className="ml-2 text-xs text-faint">{STAFF[role].effect(c.level)}</span></span>
                      <span className="text-xs text-muted tabular">{eur(Number(c.wage_cents))}</span>
                      <ActionForm action={hireStaffAction} hidden={{ gameId, candidateId: c.id }} submitLabel="Contratar" variant="ghost" inline
                        confirm={cur ? `Substituir ${cur.name}? Indemnização: ${eur(2 * Number(cur.wage_cents))}.` : undefined} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`Nível ${n} de 5`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={cn("size-3.5", i <= n ? "fill-accent text-accent" : "text-line-strong")} />)}
    </span>
  );
}
