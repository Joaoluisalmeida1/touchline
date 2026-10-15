import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardTitle, Empty, FormArrow, OvrBadge, POS_LABEL, POS_TONE, eur, inputCls, cn } from "@/components/ui";
import { cancelOfferAction, respondOfferAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getGame, getOffers, getRecentTransfers, searchMarket } from "@/server/queries";

export const metadata = { title: "Mercado" };

type SP = { pos?: string; min?: string; max?: string; price?: string; q?: string; listed?: string; page?: string };
const STATUS: Record<string, string> = { pending: "Pendente", accepted: "Aceite", rejected: "Recusada", cancelled: "Cancelada", expired: "Expirada", superseded: "Ultrapassada" };

export default async function Market({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<SP> }) {
  const { gameId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const filters = {
    position: ["GK", "DEF", "MID", "ATT"].includes(sp.pos ?? "") ? sp.pos : undefined,
    minOvr: Number(sp.min) || 1, maxOvr: Number(sp.max) || 99, maxPrice: Number(sp.price) || undefined,
    q: sp.q?.slice(0, 40), listedOnly: sp.listed === "1", page: Math.max(1, Number(sp.page) || 1),
  };
  const [market, offers, transfers] = await Promise.all([searchMarket(user.id, gameId, filters), getOffers(user.id, gameId), getRecentTransfers(user.id, gameId)]);
  const qs = (patch: Partial<SP>) => "?" + new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <div className="space-y-4">
        <Card>
          <form className="grid gap-2 sm:grid-cols-6" method="get">
            <input name="q" defaultValue={sp.q} placeholder="Nome" className={cn(inputCls, "sm:col-span-2")} />
            <select name="pos" defaultValue={sp.pos ?? ""} className={inputCls} aria-label="Posição">
              <option value="">Posição</option><option value="GK">GR</option><option value="DEF">DEF</option><option value="MID">MED</option><option value="ATT">AV</option>
            </select>
            <input name="min" type="number" min={1} max={99} defaultValue={sp.min} placeholder="OVR mín." className={inputCls} />
            <input name="price" type="number" min={0} defaultValue={sp.price} placeholder="Preço máx. €" className={inputCls} />
            <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" name="listed" value="1" defaultChecked={sp.listed === "1"} /> À venda</label>
            <button className="min-h-10 rounded-lg bg-surface-2 text-sm font-semibold sm:col-span-6" type="submit">Pesquisar</button>
          </form>
        </Card>
        <Card className="p-0">
          {market.rows.length === 0 ? <div className="p-4"><Empty title="Nenhum jogador encontrado" /></div> : (
            <ul className="divide-y divide-line">
              {market.rows.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 p-3">
                  <OvrBadge ovr={p.current_ovr} />
                  <div className="min-w-0 flex-1">
                    <Link href={`/g/${gameId}/players/${p.id}`} className="font-semibold hover:text-info">{p.name_snapshot}</Link>
                    <p className="text-xs text-muted"><span className={POS_TONE[p.position_group]}>{POS_LABEL[p.position_group]}</span> · {p.club_name ?? "Livre"} {p.manager_user_id ? "" : "(IA)"} · Pot. {p.potential_band}{p.age ? ` · ${p.age}a` : ""} <FormArrow form={Number(p.form)} /></p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold tabular">{eur(p.listed_price ?? p.market_value_cents)}</p>
                    {p.listed_price ? <Badge tone="info">À venda</Badge> : <span className="text-xs text-muted">valor de mercado</span>}
                  </div>
                  {game.my_club_id && <Link href={`/g/${gameId}/players/${p.id}`} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold hover:border-faint">Proposta</Link>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between border-t border-line p-3 text-sm">
            {market.page > 1 ? <Link href={qs({ page: String(market.page - 1) })} className="text-info">← Anterior</Link> : <span />}
            {market.hasMore && <Link href={qs({ page: String(market.page + 1) })} className="text-info">Seguinte →</Link>}
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <CardTitle>As minhas propostas</CardTitle>
          {offers.length === 0 ? <p className="text-sm text-muted">Sem propostas.</p> : (
            <ul className="space-y-3 text-sm">
              {offers.map((o) => (
                <li key={o.id} className="rounded-lg bg-bg/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/g/${gameId}/players/${o.player_id}`} className="font-semibold hover:text-info">{o.player_name}</Link>
                    <Badge tone={o.status === "pending" ? "info" : o.status === "accepted" ? "accent" : "default"}>{STATUS[o.status] ?? o.status}</Badge>
                  </div>
                  <p className="text-xs text-muted">{o.i_am_buyer ? `Para ${o.seller_name}` : `De ${o.buyer_name}`} · {eur(o.amount_cents)}{o.counter_amount_cents ? ` · pedem ${eur(o.counter_amount_cents)}` : ""}</p>
                  {o.status === "pending" && (o.i_am_buyer ? (
                    <ActionForm action={cancelOfferAction} hidden={{ gameId, offerId: o.id }} submitLabel="Cancelar" variant="ghost" inline />
                  ) : (
                    <div className="mt-1 flex gap-2">
                      <ActionForm action={respondOfferAction} hidden={{ gameId, offerId: o.id, accept: "true" }} submitLabel="Aceitar" inline confirm={`Vender ${o.player_name} por ${eur(o.amount_cents, false)}?`} />
                      <ActionForm action={respondOfferAction} hidden={{ gameId, offerId: o.id, accept: "false" }} submitLabel="Recusar" variant="secondary" inline />
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Últimas transferências</CardTitle>
          {transfers.length === 0 ? <p className="text-sm text-muted">Ainda nenhuma.</p> : (
            <ul className="space-y-1 text-sm">
              {transfers.map((t, i) => (
                <li key={i}><Link href={`/g/${gameId}/players/${t.player_id}`} className="font-semibold hover:text-info">{t.player_name}</Link> <span className="text-muted">{t.from_name} → {t.to_name}</span> <span className="tabular">{eur(t.price_cents)}</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
