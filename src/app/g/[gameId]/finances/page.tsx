import { Card, CardTitle, Empty, eur } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getFinances, getGame } from "@/server/queries";

export const metadata = { title: "Finanças" };

const LABEL: Record<string, string> = {
  initial_balance: "Saldo inicial", transfer_sale: "Vendas", transfer_purchase: "Compras", gate_receipts: "Bilheteira",
  sponsorship: "Patrocínios", wages: "Salários", prize_money: "Prémios", result_bonus: "Prémios de jogo", adjustment: "Ajustes",
};

export default async function Finances({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  if (!game.my_club_id) return <Empty title="Ainda não tens clube" />;
  const { club, ledger, byType } = await getFinances(user.id, game.my_club_id);
  if (!club) return <Empty title="Sem dados" />;
  const available = Number(club.cash_cents) - Number(club.reserved_cents);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        {[["Saldo", club.cash_cents], ["Reservado em propostas", club.reserved_cents], ["Disponível", available], ["Folha salarial / jornada", club.wage_bill]].map(([k, v]) => (
          <Card key={String(k)}><p className="text-xs uppercase tracking-wide text-muted">{k}</p><p className={`mt-1 text-2xl font-black tabular ${Number(v) < 0 ? "text-danger" : ""}`}>{eur(v as string)}</p></Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card>
          <CardTitle>Resumo por tipo</CardTitle>
          <ul className="space-y-1 text-sm">
            {byType.map((r) => <li key={r.event_type} className="flex justify-between"><span className="text-muted">{LABEL[r.event_type] ?? r.event_type}</span><span className={`tabular ${Number(r.total) < 0 ? "text-danger" : "text-accent"}`}>{eur(r.total)}</span></li>)}
          </ul>
        </Card>
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-xs uppercase text-faint"><tr><th className="p-3">Quando</th><th className="p-3">Movimento</th><th className="p-3 text-right">Valor</th><th className="p-3 text-right">Saldo</th></tr></thead>
            <tbody className="divide-y divide-line">
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td className="p-3 text-muted">E{l.season_number ?? "-"} · J{l.round_number ?? "-"}</td>
                  <td className="p-3">{LABEL[l.event_type] ?? l.event_type}</td>
                  <td className={`p-3 text-right tabular ${Number(l.amount_cents) < 0 ? "text-danger" : "text-accent"}`}>{eur(l.amount_cents, false)}</td>
                  <td className="p-3 text-right tabular">{eur(l.balance_after_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
      <p className="text-xs text-faint">Receitas, salários e prémios são regras do jogo (economy-v1), não dados reais. Cada movimento tem uma chave de idempotência — nunca é aplicado duas vezes.</p>
    </div>
  );
}
