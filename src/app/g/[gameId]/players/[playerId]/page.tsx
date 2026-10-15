import { notFound } from "next/navigation";
import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardTitle, Field, FormArrow, Meter, OvrBadge, POS_LABEL, eur, inputCls } from "@/components/ui";
import { OfferForm } from "@/components/offer-form";
import { OvrChart } from "@/components/ovr-chart";
import { listPlayerAction, unlistPlayerAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getGame, getPlayer } from "@/server/queries";

export default async function PlayerPage({ params, searchParams }: { params: Promise<{ gameId: string; playerId: string }>; searchParams: Promise<{ toast?: string }> }) {
  const { gameId, playerId } = await params;
  const { toast } = await searchParams;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const data = await getPlayer(user.id, gameId, playerId);
  if (!data) notFound();
  const { player: p, log, matches, askingPrice, transfers } = data;
  const mine = p.club_id === game.my_club_id;
  const st = p.season_stats_json ?? {};
  const points = [{ label: "Início", ovr: p.initial_ovr }, ...log.map((l) => ({ label: `E${l.season_number} J${l.round_number}`, ovr: l.new_ovr }))];
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      {toast === "signed" && mine && (
        <p role="status" className="rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm font-semibold text-accent lg:col-span-2">
          Proposta aceite! {p.name_snapshot} já é jogador do teu clube.
        </p>
      )}
      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center gap-4">
            <OvrBadge ovr={p.current_ovr} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-black">{p.name_snapshot}</h2>
              <p className="text-sm text-muted">{POS_LABEL[p.position_group]}{p.position_detail ? ` · ${p.position_detail}` : ""} · {p.club_name ?? "Sem clube"} · {p.age ? `${p.age} anos` : "idade não verificada"}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="info">Potencial {p.potential_band}</Badge>
              {p.injured_matches > 0 && <Badge tone="danger">Lesionado ({p.injury_type}) · {p.injured_matches} jogos</Badge>}
              {p.suspension_matches > 0 && <Badge tone="warn">Suspenso · {p.suspension_matches}</Badge>}
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-muted">OVR na época</p><p className="text-lg font-bold tabular">{p.season_start_ovr} → {p.current_ovr}</p></div>
            <div><p className="text-xs text-muted">Forma recente</p><p className="text-lg"><FormArrow form={Number(p.form)} /> <span className="text-xs text-muted tabular">{Number(p.form).toFixed(2)}</span></p></div>
            <div><p className="text-xs text-muted">Condição física</p><Meter value={p.fitness} label="Condição física" /></div>
            <div><p className="text-xs text-muted">Moral</p><Meter value={p.morale} label="Moral" tone="bg-info" /></div>
          </div>
          <p className="mt-4 text-xs text-faint">A forma e a condição afetam o rendimento imediato (limitado a ±3%). O OVR é a capacidade estrutural e só muda em pontos de avaliação a cada 4 jornadas.</p>
        </Card>

        <Card>
          <CardTitle>Evolução do OVR</CardTitle>
          <OvrChart points={points} />
          {log.length === 0 ? <p className="mt-3 text-sm text-muted">Sem alterações de OVR desde o início.</p> : (
            <ul className="mt-3 space-y-1 text-sm">
              {log.slice().reverse().map((l, i) => (
                <li key={i} className="flex gap-2"><span className="w-20 shrink-0 text-xs text-faint">E{l.season_number} · J{l.round_number}</span><span>{String((l.change_reason_json as { text?: string }).text ?? `${l.old_ovr} → ${l.new_ovr}`)}</span></li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Últimos jogos</CardTitle>
          {matches.length === 0 ? <p className="text-sm text-muted">Ainda não jogou.</p> : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-line">
                {matches.map((m) => (
                  <tr key={m.fixture_id}>
                    <td className="py-2"><Link href={`/g/${gameId}/matches/${m.fixture_id}`} className="hover:text-info">J{m.round_number} · {m.home_short} {m.result_home}–{m.result_away} {m.away_short}</Link></td>
                    <td className="py-2 text-muted tabular">{m.minutes}&apos;</td>
                    <td className="py-2 tabular">{m.goals ? `${m.goals}G ` : ""}{m.assists ? `${m.assists}A ` : ""}{m.cards_yellow ? "🟨" : ""}{m.cards_red ? "🟥" : ""}</td>
                    <td className="py-2 text-right font-bold tabular">{m.rating ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardTitle>Época</CardTitle>
          <dl className="grid grid-cols-3 gap-3 text-center text-sm">
            {[["Jogos", st.apps ?? 0], ["Golos", st.goals ?? 0], ["Assist.", st.assists ?? 0], ["Minutos", st.minutes ?? 0], ["Nota", st.rated ? ((st.rating_sum ?? 0) / st.rated).toFixed(2) : "—"]].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg bg-bg/60 p-2"><dt className="text-xs text-muted">{k}</dt><dd className="font-bold tabular">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card>
          <CardTitle>Contrato e mercado</CardTitle>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Valor de mercado (jogo)</dt><dd className="font-semibold tabular">{eur(p.market_value_cents)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Salário semanal</dt><dd className="tabular">{eur(p.wage_cents)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Contrato até</dt><dd>Época {p.contract_end_season}</dd></div>
            {p.listed_price && <div className="flex justify-between"><dt className="text-muted">À venda por</dt><dd className="font-semibold text-info tabular">{eur(p.listed_price)}</dd></div>}
          </dl>
          <div className="mt-4">
            {mine ? (
              p.listed_price ? (
                <ActionForm action={unlistPlayerAction} hidden={{ gameId, playerId: p.id }} submitLabel="Retirar do mercado" variant="secondary" />
              ) : (
                <ActionForm action={listPlayerAction} hidden={{ gameId, playerId: p.id }} submitLabel="Colocar à venda" variant="secondary">
                  <Field label="Preço pedido (€)"><input name="askingEur" inputMode="numeric" defaultValue={Math.round(Number(p.market_value_cents) / 100 * 1.2)} className={inputCls} /></Field>
                </ActionForm>
              )
            ) : game.my_club_id && p.club_id ? (
              <OfferForm gameId={gameId} playerId={p.id} suggestedEur={Math.round(Number(askingPrice ?? p.market_value_cents) / 100)} aiClub={!p.manager_user_id} />
            ) : null}
          </div>
        </Card>
        {transfers.length > 0 && (
          <Card>
            <CardTitle>Transferências nesta liga</CardTitle>
            <ul className="space-y-1 text-sm">{transfers.map((t, i) => <li key={i}>{t.from_name} → {t.to_name} · {eur(t.price_cents)}</li>)}</ul>
          </Card>
        )}
      </div>
    </div>
  );
}
