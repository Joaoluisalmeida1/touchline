import Link from "next/link";
import { Badge, Card, Empty, FormArrow, Meter, OvrBadge, POS_LABEL, POS_TONE, eur, cn } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getGame, getSquad } from "@/server/queries";

export const metadata = { title: "Plantel" };

export default async function Squad({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ pos?: string }> }) {
  const { gameId } = await params;
  const { pos } = await searchParams;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  if (!game.my_club_id) return <Empty title="Ainda não tens clube">Escolhe um clube no Resumo.</Empty>;
  const position = ["GK", "DEF", "MID", "ATT"].includes(pos ?? "") ? pos : undefined;
  const squad = await getSquad(user.id, gameId, game.my_club_id, position);
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3 text-sm">
        {[["", "Todos"], ["GK", "Guarda-redes"], ["DEF", "Defesas"], ["MID", "Médios"], ["ATT", "Avançados"]].map(([k, l]) => (
          <Link key={k} href={`/g/${gameId}/squad${k ? `?pos=${k}` : ""}`} className={cn("rounded-full px-3 py-1", (position ?? "") === k ? "bg-surface-2 font-semibold text-ink" : "text-muted hover:text-ink")}>{l}</Link>
        ))}
        <span className="ml-auto text-muted">{squad.length} jogadores</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-faint">
            <tr>
              <th className="p-3">Jogador</th><th className="p-3">OVR</th><th className="p-3">Pot.</th><th className="p-3">Idade</th>
              <th className="p-3">Forma</th><th className="p-3">Condição</th><th className="p-3">Moral</th><th className="p-3">Época</th>
              <th className="p-3 text-right">Valor</th><th className="p-3 text-right">Salário/sem.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {squad.map((p) => {
              const st = p.season_stats_json ?? {};
              const delta = p.current_ovr - p.season_start_ovr;
              return (
                <tr key={p.id} className="hover:bg-surface-2/50">
                  <td className="p-3">
                    <Link href={`/g/${gameId}/players/${p.id}`} className="font-semibold hover:text-info">{p.name_snapshot}</Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs">
                      <span className={cn("font-bold", POS_TONE[p.position_group])}>{POS_LABEL[p.position_group]}</span>
                      {p.injured_matches > 0 && <Badge tone="danger">Lesão · {p.injured_matches}j</Badge>}
                      {p.suspension_matches > 0 && <Badge tone="warn">Castigo · {p.suspension_matches}j</Badge>}
                      {p.listed_price && <Badge tone="info">À venda</Badge>}
                    </div>
                  </td>
                  <td className="p-3"><div className="flex items-center gap-2"><OvrBadge ovr={p.current_ovr} size="sm" />{delta !== 0 && <span className={cn("text-xs font-bold", delta > 0 ? "text-accent" : "text-danger")}>{delta > 0 ? `+${delta}` : delta}</span>}</div></td>
                  <td className="p-3"><span title="Potencial estimado (inferido pelo jogo)" className="font-bold text-muted">{p.potential_band}</span></td>
                  <td className="p-3 tabular text-muted">{p.age ?? "—"}</td>
                  <td className="p-3"><FormArrow form={Number(p.form)} /></td>
                  <td className="p-3"><Meter value={p.fitness} label="Condição física" /></td>
                  <td className="p-3"><Meter value={p.morale} label="Moral" tone="bg-info" /></td>
                  <td className="p-3 text-xs text-muted tabular">{st.apps ?? 0}J {st.goals ?? 0}G {st.assists ?? 0}A{st.rated ? ` · ${((st.rating_sum ?? 0) / st.rated).toFixed(1)}` : ""}</td>
                  <td className="p-3 text-right tabular">{eur(p.market_value_cents)}</td>
                  <td className="p-3 text-right tabular text-muted">{eur(p.wage_cents)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line p-3 text-xs text-faint">Potencial (A–E) e salários são valores do jogo, inferidos/gerados — não são dados do fornecedor. Idade só aparece quando verificada.</p>
    </Card>
  );
}
