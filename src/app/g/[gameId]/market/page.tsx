import Link from "next/link";
import { ArrowLeft, ArrowRight, Handshake, Search, Tag } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { PlayerAvatar } from "@/components/squad/avatar";
import { Badge, Card, CardTitle, Empty, FormArrow, OvrBadge, PosPill, cn, eur, inputCls } from "@/components/ui";
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
  const POS: [string, string][] = [["", "Todos"], ["GK", "GR"], ["DEF", "DEF"], ["MID", "MED"], ["ATT", "AV"]];
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-4">
        <Card className="p-3 sm:p-4">
          <form className="space-y-3" method="get">
            <div className="flex flex-wrap gap-2">
              <label className="relative min-w-[200px] flex-1">
                <span className="sr-only">Nome</span>
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
                <input name="q" defaultValue={sp.q} placeholder="Procurar jogador…" className={cn(inputCls, "pl-10")} />
              </label>
              <div className="flex gap-1 rounded-xl border border-line bg-bg/70 p-1" role="radiogroup" aria-label="Posição">
                {POS.map(([v, l]) => (
                  <label key={v} className="cursor-pointer">
                    <input type="radio" name="pos" value={v} defaultChecked={(sp.pos ?? "") === v} className="peer sr-only" />
                    <span className="flex h-9 items-center rounded-lg px-2.5 text-xs font-bold text-muted transition peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent">{l}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-28"><input name="min" type="number" min={1} max={99} defaultValue={sp.min} placeholder="OVR mín." aria-label="OVR mínimo" className={inputCls} /></span>
              <span className="w-36"><input name="price" type="number" min={0} defaultValue={sp.price} placeholder="Preço máx. €" aria-label="Preço máximo" className={inputCls} /></span>
              <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line bg-bg/70 px-3 text-sm font-semibold text-muted has-[:checked]:border-info/40 has-[:checked]:text-info">
                <input type="checkbox" name="listed" value="1" defaultChecked={sp.listed === "1"} /> <Tag className="size-3.5" />À venda
              </label>
              <button className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-bold text-accent-ink transition hover:brightness-105 active:scale-[.97]" type="submit">
                <Search className="size-4" />Pesquisar
              </button>
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden p-0 sm:p-0">
          {market.rows.length === 0 ? <div className="p-4"><Empty title="Nenhum jogador encontrado" icon={<Search />}>Experimenta alargar os filtros.</Empty></div> : (
            <ul className="divide-y divide-line/70">
              {market.rows.map((p) => (
                <li key={p.id} className="group flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2/50 sm:px-4">
                  <OvrBadge ovr={p.current_ovr} />
                  <PlayerAvatar id={p.id} primary="#2a313b" secondary="#5d6772" size={36} className="hidden sm:block" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/g/${gameId}/players/${p.id}`} className="block truncate font-bold hover:text-accent">{p.name_snapshot}</Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                      <PosPill group={p.position_group} />
                      <span className="truncate">{p.club_name ?? "Livre"}{p.manager_user_id ? "" : " (IA)"}</span>
                      <span className="text-faint">Pot. <b className="text-muted">{p.potential_band}</b></span>
                      {p.age ? <span className="text-faint">{p.age}a</span> : null}
                      <FormArrow form={Number(p.form)} />
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-xl font-extrabold leading-none tabular">{eur(p.listed_price ?? p.market_value_cents)}</p>
                    {p.listed_price ? <Badge tone="info" className="mt-1">À venda</Badge> : <span className="text-[10px] font-semibold uppercase tracking-wider text-faint">valor</span>}
                  </div>
                  {game.my_club_id && (
                    <Link href={`/g/${gameId}/players/${p.id}`} className="hidden items-center gap-1.5 rounded-xl border border-line-strong px-3 py-2 text-xs font-bold transition hover:border-accent hover:bg-accent hover:text-accent-ink sm:inline-flex">
                      <Handshake className="size-3.5" />Proposta
                    </Link>
                  )}
                  {game.my_club_id && (
                    <Link href={`/g/${gameId}/players/${p.id}`} aria-label={`Proposta por ${p.name_snapshot}`} className="flex size-9 items-center justify-center rounded-xl border border-line-strong text-muted sm:hidden">
                      <ArrowRight className="size-4" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t border-line p-3 text-sm">
            {market.page > 1 ? <Link href={qs({ page: String(market.page - 1) })} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-muted hover:bg-surface-2 hover:text-ink"><ArrowLeft className="size-4" />Anterior</Link> : <span />}
            <span className="font-display text-sm font-bold text-faint">Página {market.page}</span>
            {market.hasMore ? <Link href={qs({ page: String(market.page + 1) })} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 font-semibold text-muted hover:bg-surface-2 hover:text-ink">Seguinte<ArrowRight className="size-4" /></Link> : <span />}
          </div>
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardTitle icon={<Handshake />}>As minhas propostas</CardTitle>
          {offers.length === 0 ? <p className="text-sm text-muted">Sem propostas.</p> : (
            <ul className="space-y-2.5 text-sm">
              {offers.map((o) => (
                <li key={o.id} className="rounded-2xl border border-line bg-bg/50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/g/${gameId}/players/${o.player_id}`} className="truncate font-bold hover:text-accent">{o.player_name}</Link>
                    <Badge tone={o.status === "pending" ? "info" : o.status === "accepted" ? "accent" : "default"} dot={o.status === "pending"}>{STATUS[o.status] ?? o.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {o.i_am_buyer ? `Para ${o.seller_name}` : `De ${o.buyer_name}`} · <b className="font-display text-sm text-ink">{eur(o.amount_cents)}</b>
                    {o.counter_amount_cents ? <> · pedem <b className="font-display text-sm text-warn">{eur(o.counter_amount_cents)}</b></> : ""}
                  </p>
                  {o.status === "pending" && (o.i_am_buyer ? (
                    <ActionForm action={cancelOfferAction} hidden={{ gameId, offerId: o.id }} submitLabel="Cancelar" variant="ghost" inline className="mt-1" submitClassName="min-h-8 px-2 text-xs" />
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <ActionForm action={respondOfferAction} hidden={{ gameId, offerId: o.id, accept: "true" }} submitLabel="Aceitar" inline submitClassName="min-h-9" confirm={`Vender ${o.player_name} por ${eur(o.amount_cents, false)}?`} />
                      <ActionForm action={respondOfferAction} hidden={{ gameId, offerId: o.id, accept: "false" }} submitLabel="Recusar" variant="secondary" inline submitClassName="min-h-9" />
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
            <ul className="space-y-3 text-sm">
              {transfers.map((t, i) => (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-accent ring-1 ring-line"><ArrowRight className="size-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/g/${gameId}/players/${t.player_id}`} className="block truncate font-bold hover:text-accent">{t.player_name}</Link>
                    <p className="truncate text-xs text-muted">{t.from_name} → {t.to_name}</p>
                  </div>
                  <span className="font-display text-base font-extrabold tabular">{eur(t.price_cents)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
