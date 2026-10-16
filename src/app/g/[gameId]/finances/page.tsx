import { Wallet } from "lucide-react";
import { AnimatedNumber } from "@/components/fx/animated-number";
import { Bar, Stagger, StaggerItem } from "@/components/fx/motion";
import { Card, CardTitle, Empty, cn, eur } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getFinances, getGame } from "@/server/queries";
import { getSeasonPnl } from "@/server/club-queries";

export const metadata = { title: "Finanças" };

const LABEL: Record<string, string> = {
  initial_balance: "Saldo inicial", transfer_sale: "Vendas", transfer_purchase: "Compras", gate_receipts: "Bilheteira",
  sponsorship: "Patrocínios", wages: "Salários", prize_money: "Prémios", result_bonus: "Prémios de jogo", adjustment: "Ajustes",
  staff_wages: "Staff", infrastructure: "Obras",
};
const REVENUE = new Set(["gate_receipts", "sponsorship", "prize_money", "result_bonus"]);

export default async function Finances({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  if (!game.my_club_id) return <Empty title="Ainda não tens clube" icon={<Wallet />} />;
  const [{ club, ledger, byType }, pnl] = await Promise.all([getFinances(user.id, game.my_club_id), getSeasonPnl(user.id, game.my_club_id, game.current_season)]);
  const blocks = [...new Set(pnl.map((r) => r.block))].sort((a, b) => a - b);
  const types = [...new Set(pnl.map((r) => r.event_type))].sort((a, b) => Number(REVENUE.has(b)) - Number(REVENUE.has(a)) || a.localeCompare(b));
  const cell = (b: number, t: string) => Number(pnl.find((r) => r.block === b && r.event_type === t)?.total ?? 0);
  const revenue = pnl.filter((r) => REVENUE.has(r.event_type)).reduce((s2, r) => s2 + Number(r.total), 0);
  const wagesPaid = -pnl.filter((r) => r.event_type === "wages" || r.event_type === "staff_wages").reduce((s2, r) => s2 + Number(r.total), 0);
  const ratio = revenue > 0 ? wagesPaid / revenue : 0;
  const played = Math.max(1, game.current_matchday);
  const net = pnl.filter((r) => r.event_type !== "transfer_sale" && r.event_type !== "transfer_purchase").reduce((s2, r) => s2 + Number(r.total), 0);
  const projection = Number(club?.cash_cents ?? 0) + Math.round((net / played) * Math.max(0, (game.total_rounds ?? 0) - game.current_matchday));
  if (!club) return <Empty title="Sem dados" />;
  const available = Number(club.cash_cents) - Number(club.reserved_cents);
  const flows = byType.filter((r) => r.event_type !== "initial_balance");
  const maxAbs = Math.max(1, ...flows.map((r) => Math.abs(Number(r.total))));
  // balance sparkline (oldest → newest)
  const series = [...ledger].reverse().map((l) => Number(l.balance_after_cents));
  const w = 600, h = 120;
  const lo = Math.min(...series, 0), hi = Math.max(...series, 1);
  const pts = series.map((v, i) => [series.length === 1 ? w / 2 : (i * w) / (series.length - 1), h - 8 - ((v - lo) / (hi - lo || 1)) * (h - 16)]);
  const path = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const kpis: [string, number, string?][] = [
    ["Saldo", Number(club.cash_cents)], ["Reservado em propostas", Number(club.reserved_cents)], ["Disponível", available, "accent"], ["Folha salarial / jornada", Number(club.wage_bill)],
  ];
  return (
    <div className="space-y-5">
      <Stagger className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([k, v, tone]) => (
          <StaggerItem key={k}>
            <div className={cn("surface h-full rounded-[var(--radius-card)] p-4", tone === "accent" && "border-accent/35")}>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{k}</p>
              <p className={cn("mt-2 font-display text-3xl font-extrabold leading-none sm:text-4xl", v < 0 ? "text-danger" : tone === "accent" ? "text-accent" : "text-ink")}>
                <AnimatedNumber value={v} format="eur" />
              </p>
            </div>
          </StaggerItem>
        ))}
      </Stagger>

      {series.length > 1 && (
        <Card>
          <CardTitle>Evolução do saldo</CardTitle>
          <svg viewBox={`0 0 ${w} ${h}`} className="h-32 w-full" preserveAspectRatio="none" role="img" aria-label="Evolução do saldo ao longo dos movimentos">
            <defs>
              <linearGradient id="fin-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d4ff3a" stopOpacity=".28" /><stop offset="1" stopColor="#d4ff3a" stopOpacity="0" /></linearGradient>
            </defs>
            <path d={`${path} L${w},${h} L0,${h} Z`} fill="url(#fin-fill)" />
            <path d={path} fill="none" stroke="#d4ff3a" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        </Card>
      )}

      {blocks.length > 0 && (
        <Card className="overflow-hidden">
          <CardTitle action={<span className="text-xs text-muted">Projeção no fim da época: <b className={cn("tabular", projection < 0 ? "text-danger" : "text-ink")}>{eur(projection)}</b></span>}>Contas da época (blocos de 4 jornadas)</CardTitle>
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-xs"><span className="text-muted">Salários / receitas</span><span className={cn("font-bold tabular", ratio > 0.7 ? "text-danger" : "text-ink")}>{Math.round(ratio * 100)}%</span></div>
            <div className="relative h-2 rounded-full bg-line">
              <div className={cn("h-full rounded-full", ratio > 0.7 ? "bg-danger" : "bg-accent")} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
              <span className="absolute -top-1 h-4 w-0.5 bg-warn" style={{ left: "70%" }} title="Linha de alerta: 70%" />
            </div>
            <p className="mt-1 text-[11px] text-faint">Acima de 70% as contas ficam apertadas — a direção nota.</p>
          </div>
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                <tr className="border-b border-line"><th className="px-4 py-2 sm:px-5">Tipo</th>{blocks.map((b) => <th key={b} className="px-3 py-2 text-right">J{b * 4 + 1}–{b * 4 + 4}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {types.map((t) => (
                  <tr key={t}>
                    <td className="px-4 py-2 font-medium sm:px-5">{LABEL[t] ?? t}</td>
                    {blocks.map((b) => { const v = cell(b, t); return <td key={b} className={cn("px-3 py-2 text-right tabular", v < 0 ? "text-danger" : v > 0 ? "text-accent" : "text-faint")}>{v ? eur(v) : "—"}</td>; })}
                  </tr>
                ))}
                <tr className="font-bold">
                  <td className="px-4 py-2 sm:px-5">Resultado</td>
                  {blocks.map((b) => { const v = types.reduce((s2, t) => s2 + cell(b, t), 0); return <td key={b} className={cn("px-3 py-2 text-right tabular", v < 0 ? "text-danger" : "text-accent")}>{eur(v)}</td>; })}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card>
          <CardTitle>Resumo por tipo</CardTitle>
          <ul className="space-y-3 text-sm">
            {byType.map((r, i) => {
              const v = Number(r.total);
              return (
                <li key={r.event_type}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-muted">{LABEL[r.event_type] ?? r.event_type}</span>
                    <span className={cn("font-display text-base font-bold tabular", v < 0 ? "text-danger" : "text-accent")}>{eur(r.total)}</span>
                  </div>
                  {r.event_type !== "initial_balance" && (
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                      <Bar pct={(Math.abs(v) / maxAbs) * 100} delay={i * 0.04} className={cn("h-full rounded-full", v < 0 ? "bg-danger" : "bg-accent")} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card className="overflow-hidden p-0 sm:p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-left text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
                <tr className="border-b border-line"><th className="px-4 py-3">Quando</th><th className="px-4 py-3">Movimento</th><th className="px-4 py-3 text-right">Valor</th><th className="px-4 py-3 text-right">Saldo</th></tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {ledger.map((l) => {
                  const v = Number(l.amount_cents);
                  return (
                    <tr key={l.id} className="transition-colors hover:bg-surface-2/50">
                      <td className="px-4 py-2.5"><span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-display text-xs font-bold text-muted ring-1 ring-line">E{l.season_number ?? "-"} · J{l.round_number ?? "-"}</span></td>
                      <td className="px-4 py-2.5 font-medium">{LABEL[l.event_type] ?? l.event_type}</td>
                      <td className={cn("px-4 py-2.5 text-right font-semibold tabular", v < 0 ? "text-danger" : "text-accent")}>{v > 0 ? "+" : ""}{eur(l.amount_cents, false)}</td>
                      <td className="px-4 py-2.5 text-right tabular text-muted">{eur(l.balance_after_cents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
      <p className="text-xs text-faint">Receitas, salários, patrocínios e prémios são regras do jogo (economy-v2), não dados reais. Cada movimento tem uma chave de idempotência — nunca é aplicado duas vezes.</p>
    </div>
  );
}
