import { ArrowDownRight, ArrowUpRight, CalendarDays, PiggyBank, Receipt, Wallet } from "lucide-react";
import { AnimatedNumber } from "@/components/fx/animated-number";
import { Bar, Stagger, StaggerItem } from "@/components/fx/motion";
import { Card, CardTitle, Empty, cn, eur, eurSigned } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getFinances, getGame, getRoundFlows } from "@/server/queries";
import { getSeasonPnl } from "@/server/club-queries";

export const metadata = { title: "Finanças" };

/** Plain-language names for ledger entries (unknown types fall back to a readable version of the key). */
const LABEL: Record<string, string> = {
  initial_balance: "Saldo inicial", transfer_sale: "Venda de jogadores", transfer_purchase: "Compra de jogadores", gate_receipts: "Bilheteira",
  sponsorship: "Patrocínios", wages: "Salários dos jogadores", prize_money: "Prémios da liga", result_bonus: "Prémios por resultado",
  adjustment: "Outros acertos", staff_wages: "Salários do staff", infrastructure: "Obras no estádio",
};
const label = (t: string) => LABEL[t] ?? t.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export default async function Finances({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  if (!game.my_club_id) return <Empty title="Ainda não tens clube" icon={<Wallet />} />;
  const season = game.current_season;
  const [{ club, ledger }, pnl, flows] = await Promise.all([
    getFinances(user.id, game.my_club_id), getSeasonPnl(user.id, game.my_club_id, season), getRoundFlows(user.id, game.my_club_id, season),
  ]);
  if (!club) return <Empty title="Sem dados" />;

  const cash = Number(club.cash_cents), reserved = Number(club.reserved_cents), available = cash - reserved;
  // season totals per type (transfers kept apart: they are one-off, not the running economy)
  const totals = new Map<string, number>();
  for (const r of pnl) totals.set(r.event_type, (totals.get(r.event_type) ?? 0) + Number(r.total));
  const isTransfer = (t: string) => t === "transfer_sale" || t === "transfer_purchase";
  const income = [...totals].filter(([t, v]) => v > 0 && !isTransfer(t)).sort((a, b) => b[1] - a[1]);
  const spending = [...totals].filter(([t, v]) => v < 0 && !isTransfer(t)).sort((a, b) => a[1] - b[1]);
  const transfers = (totals.get("transfer_sale") ?? 0) + (totals.get("transfer_purchase") ?? 0);
  const incomeTotal = income.reduce((s, [, v]) => s + v, 0);
  const spendingTotal = -spending.reduce((s, [, v]) => s + v, 0);
  const wages = -((totals.get("wages") ?? 0) + (totals.get("staff_wages") ?? 0));
  const ratio = incomeTotal > 0 ? wages / incomeTotal : 0;
  const played = Math.max(1, game.current_matchday);
  const runningNet = incomeTotal - spendingTotal;
  const perRound = runningNet / played;
  const left = Math.max(0, Number(game.total_rounds ?? 0) - game.current_matchday);
  const projection = cash + Math.round(perRound * left);
  const sinceStart = flows.seasonStart !== null ? cash - flows.seasonStart : null;

  // chart: money in (up) and out (down) per matchday
  const rounds = flows.rounds.filter((r) => r.round > 0);
  const peak = Math.max(1, ...rounds.map((r) => Math.max(r.income, -r.expenses)));
  const W = 720, H = 200, mid = H / 2, slot = rounds.length ? W / rounds.length : W, bw = Math.min(36, slot * 0.36);

  // movements grouped by matchday (newest first)
  const groups: { key: string; season: number | null; round: number | null; rows: typeof ledger; net: number }[] = [];
  for (const l of ledger) {
    const key = `${l.season_number}-${l.round_number}`;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push(g = { key, season: l.season_number, round: l.round_number, rows: [], net: 0 });
    g.rows.push(l);
    if (l.event_type !== "initial_balance") g.net += Number(l.amount_cents);
  }

  return (
    <div className="space-y-5">
      <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StaggerItem className="sm:col-span-2">
          <div className="surface h-full rounded-[var(--radius-card)] border-accent/35 p-5">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-faint"><Wallet className="size-3.5" />Saldo do clube</p>
            <p className={cn("mt-2 font-display text-5xl font-extrabold leading-none tabular", cash < 0 ? "text-danger" : "text-ink")}><AnimatedNumber value={cash} format="eur" /></p>
            <p className="mt-2 text-sm text-muted">
              {sinceStart !== null && <><b className={cn("tabular", sinceStart < 0 ? "text-danger" : "text-up")}>{eurSigned(sinceStart)}</b> desde o início da época · </>}
              {reserved > 0 ? <>{eur(reserved)} reservado em propostas · <b className="text-ink">{eur(available)} disponível</b></> : <>tudo disponível para contratações</>}
            </p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="surface h-full rounded-[var(--radius-card)] p-5">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-faint"><CalendarDays className="size-3.5" />Média por jornada</p>
            <p className={cn("mt-2 font-display text-3xl font-extrabold leading-none tabular", perRound < 0 ? "text-danger" : "text-up")}>{eurSigned(perRound)}</p>
            <p className="mt-2 text-xs text-muted">{perRound >= 0 ? "Estás a ganhar dinheiro a cada jornada." : "Estás a gastar mais do que recebes."}</p>
          </div>
        </StaggerItem>
        <StaggerItem>
          <div className="surface h-full rounded-[var(--radius-card)] p-5">
            <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-faint"><PiggyBank className="size-3.5" />Fim da época (previsão)</p>
            <p className={cn("mt-2 font-display text-3xl font-extrabold leading-none tabular", projection < 0 ? "text-danger" : "text-ink")}>{eur(projection)}</p>
            <p className="mt-2 text-xs text-muted">{left > 0 ? `Se tudo continuar igual nas ${left} jornadas que faltam.` : "Época terminada."}</p>
          </div>
        </StaggerItem>
      </Stagger>

      {rounds.length > 0 && (
        <Card>
          <CardTitle icon={<Receipt />} action={<span className="flex items-center gap-3 text-xs text-muted"><span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-up" />Entrou</span><span className="flex items-center gap-1"><span className="size-2 rounded-sm bg-danger" />Saiu</span></span>}>Receitas e despesas por jornada</CardTitle>
          <svg viewBox={`0 0 ${W} ${H + 28}`} className="h-auto w-full sm:h-56" role="img" aria-label={`Receitas e despesas por jornada, ${rounds.length} jornadas`}>
            <line x1="0" x2={W} y1={mid} y2={mid} stroke="var(--color-line-strong)" strokeWidth="1" />
            {rounds.map((r, i) => {
              const x = i * slot + slot / 2;
              // leave room above/below the tallest bar for its net label
              const up = (r.income / peak) * (mid - 22), down = (-r.expenses / peak) * (mid - 22), net = r.income + r.expenses;
              return (
                <g key={r.round}>
                  <title>{`Jornada ${r.round}: entrou ${eur(r.income)}, saiu ${eur(-r.expenses)}, saldo ${eurSigned(net)}`}</title>
                  <rect x={x - bw - 1} y={mid - up} width={bw} height={Math.max(1, up)} rx="3" fill="var(--color-up)" opacity=".85" />
                  <rect x={x + 1} y={mid} width={bw} height={Math.max(1, down)} rx="3" fill="var(--color-danger)" opacity=".8" />
                  {/* the svg scales down on phones: CSS font sizes (which beat the attribute) keep the labels readable there */}
                  <text x={x} y={H + 18} textAnchor="middle" fontSize="11" className="text-[20px] sm:text-[11px]" fill="var(--color-faint)">J{r.round}</text>
                  {rounds.length <= 14 && <text x={x} y={net >= 0 ? mid - up - 6 : mid + down + 16} textAnchor="middle" fontSize="10" fontWeight="700" className="max-sm:hidden" fill={net >= 0 ? "var(--color-up)" : "var(--color-danger)"}>{eurSigned(net)}</text>}
                </g>
              );
            })}
          </svg>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {[
          { title: "De onde vem o dinheiro", icon: <ArrowUpRight />, rows: income, total: incomeTotal, tone: "up" as const },
          { title: "Para onde vai", icon: <ArrowDownRight />, rows: spending, total: spendingTotal, tone: "danger" as const },
        ].map((col) => (
          <Card key={col.title}>
            <CardTitle icon={col.icon} action={<span className={cn("font-display text-lg font-extrabold tabular", col.tone === "up" ? "text-up" : "text-danger")}>{eur(col.total)}</span>}>{col.title} · época {season}</CardTitle>
            {col.rows.length === 0 ? <p className="text-sm text-muted">Nada ainda nesta época.</p> : (
              <ul className="space-y-3 text-sm">
                {col.rows.map(([t, v], i) => {
                  const share = col.total ? Math.abs(v) / col.total : 0;
                  return (
                    <li key={t}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{label(t)}</span>
                        <span className="tabular text-muted"><b className="text-ink">{eur(Math.abs(v))}</b> · {Math.round(share * 100)}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                        <Bar pct={share * 100} delay={i * 0.04} className={cn("h-full rounded-full", col.tone === "up" ? "bg-up" : "bg-danger")} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {col.tone === "danger" && incomeTotal > 0 && (
              <div className="mt-5 rounded-xl border border-line bg-bg/50 p-3">
                <div className="mb-1 flex justify-between text-xs"><span className="text-muted">Salários comem {Math.round(ratio * 100)}% das receitas</span><span className={cn("font-bold", ratio > 0.7 ? "text-danger" : "text-up")}>{ratio > 0.7 ? "Apertado" : "Saudável"}</span></div>
                <div className="relative h-2 rounded-full bg-line">
                  <div className={cn("h-full rounded-full", ratio > 0.7 ? "bg-danger" : "bg-up")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                  <span className="absolute -top-1 h-4 w-0.5 bg-warn" style={{ left: "70%" }} title="Limite: 70%" />
                </div>
                <p className="mt-1.5 text-[11px] text-faint">Acima de 70% a direção fica preocupada com as contas.</p>
              </div>
            )}
          </Card>
        ))}
      </div>
      {transfers !== 0 && (
        <p className="text-sm text-muted">Transferências nesta época: <b className={cn("tabular", transfers < 0 ? "text-danger" : "text-up")}>{eurSigned(transfers)}</b> (não contam para a média por jornada).</p>
      )}

      <Card>
        <CardTitle>Movimentos por jornada</CardTitle>
        <div className="divide-y divide-line/60">
          {groups.map((g, gi) => (
            <details key={g.key} open={gi === 0} className="group py-1">
              <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-1 py-2 hover:bg-surface-2/50 [&::-webkit-details-marker]:hidden">
                <span className="w-24 shrink-0 font-display text-sm font-bold">{g.round ? `Jornada ${g.round}` : "Início"}</span>
                <span className="flex-1 truncate text-xs text-muted">{g.rows.map((l) => label(l.event_type)).join(" · ")}</span>
                <span className={cn("font-display font-extrabold tabular", g.net < 0 ? "text-danger" : "text-up")}>{g.round ? eurSigned(g.net) : eur(g.rows[0].balance_after_cents)}</span>
                <span className="text-faint transition group-open:rotate-90">›</span>
              </summary>
              <ul className="mb-2 ml-1 space-y-1 border-l border-line pl-4 text-sm">
                {g.rows.map((l) => (
                  <li key={l.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-muted">{label(l.event_type)}</span>
                    <span className={cn("tabular", Number(l.amount_cents) < 0 ? "text-danger" : "text-ink")}>{l.event_type === "initial_balance" ? eur(l.amount_cents) : eurSigned(l.amount_cents, false)}</span>
                  </li>
                ))}
              </ul>
            </details>
          ))}
        </div>
        {ledger.length >= 100 && <p className="mt-2 text-xs text-faint">A mostrar os 100 movimentos mais recentes.</p>}
      </Card>
      <p className="text-xs text-faint">Valores fictícios, definidos pelas regras do jogo. Cada movimento só é aplicado uma vez.</p>
    </div>
  );
}
