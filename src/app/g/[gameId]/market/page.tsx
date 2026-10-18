import Link from "next/link";
import { ArrowDownRight, ArrowRight, Globe, Handshake, History, Search, Tag, TrendingDown, Users } from "lucide-react";
import { randomUUID } from "node:crypto";
import { ActionForm } from "@/components/action-form";
import { BuyButton, ListForm } from "@/components/market/market-ui";
import { PlayerAvatar } from "@/components/squad/avatar";
import { Badge, Card, CardTitle, Empty, OvrBadge, PosPill, cn, eur, inputCls } from "@/components/ui";
import { listingAfter, roundsOnList, MARKET } from "@/engine/market/market";
import { acceptCounterAction, cancelOfferAction, counterOfferAction, respondOfferAction, signFreeAgentAction, unlistPlayerAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getFreeAgents } from "@/server/career-queries";
import { getPool } from "@/server/db";
import { getListingActivity, getSellable, getTransferList, type ListingRow } from "@/server/market-queries";
import { getFinances, getGame, getOffers, searchMarket } from "@/server/queries";
import { marketTick } from "@/server/services/market";

export const metadata = { title: "Mercado" };

type SP = { pos?: string; price?: string; min?: string; sort?: string; q?: string; fpos?: string };
const STATUS: Record<string, string> = { pending: "Pendente", accepted: "Aceite", rejected: "Recusada", cancelled: "Cancelada", expired: "Expirada", superseded: "Ultrapassada", countered: "Contraproposta" };
const SORTS: [string, string][] = [["new", "Novidades"], ["ending", "A sair"], ["ratio", "% do valor"], ["price", "Preço"], ["ovr", "OVR"]];

export default async function Market({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<SP> }) {
  const { gameId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const classic = (game.settings_json?.market ?? "osm") === "classic";
  // first batch of the season appears as soon as someone opens the market (idempotent)
  if (!classic) await marketTick(getPool(), gameId).catch((e) => console.error(JSON.stringify({ level: "error", msg: "market.tick_failed", game_id: gameId, error: (e as Error).message })));
  const pos = ["GK", "DEF", "MID", "ATT"].includes(sp.pos ?? "") ? sp.pos : undefined;
  const sort = (SORTS.find(([k]) => k === sp.sort)?.[0] ?? "new") as "new";
  const clubId: string | null = game.my_club_id ?? null;
  const [list, activity, offers, freeAgents, sellable, fin, friends] = await Promise.all([
    getTransferList(user.id, gameId, { position: pos, maxPrice: Number(sp.price) || undefined, minOvr: Number(sp.min) || 1, sort }),
    getListingActivity(user.id, gameId),
    getOffers(user.id, gameId),
    getFreeAgents(user.id, gameId, game.current_season),
    clubId ? getSellable(user.id, clubId) : [],
    clubId ? getFinances(user.id, clubId) : null,
    sp.q || sp.fpos ? searchMarket(user.id, gameId, { q: sp.q?.slice(0, 40), position: ["GK", "DEF", "MID", "ATT"].includes(sp.fpos ?? "") ? sp.fpos : undefined, league: "game", page: 1 }) : null,
  ]);
  const myListings = list.filter((l) => l.mine);
  const slots = Number(game.settings_json?.market_slots ?? MARKET.managerSlots);
  const available = fin ? Number(fin.club?.cash_cents ?? 0) - Number(fin.club?.reserved_cents ?? 0) : null;
  const windowOpen = game.status === "active" && game.current_matchday <= 3;
  const others = list.filter((l) => !l.mine);
  const dropping = others.filter((l) => l.origin !== "manager").length;
  const friendRows = (friends?.rows ?? []).filter((r) => r.manager_user_id && r.kind === "game");

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Mercado · Época {game.current_season} · Jornada {game.current_matchday}</p>
          <h2 className="headline text-4xl sm:text-5xl">Lista de transferências</h2>
          <p className="mt-2 max-w-2xl text-sm text-muted">Todas as jornadas entram jogadores novos. Se ninguém os comprar, o preço desce — até saírem da lista. Quem clicar primeiro, leva.</p>
        </div>
        <dl className="flex flex-wrap gap-2">
          <div className="rounded-xl border border-line bg-surface px-4 py-2"><dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">À venda</dt><dd className="font-display text-2xl font-black tabular">{others.length}</dd></div>
          <div className="rounded-xl border border-line bg-surface px-4 py-2"><dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">A descer</dt><dd className="font-display text-2xl font-black tabular">{dropping}</dd></div>
          {available !== null && <div className="rounded-xl border border-line bg-surface px-4 py-2"><dt className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Disponível</dt><dd className="font-display text-2xl font-black tabular">{eur(available)}</dd></div>}
        </dl>
      </header>

      {classic && <Card><p className="text-sm text-muted">Esta liga usa o mercado clássico (propostas diretas aos clubes). A Lista de Transferências está desligada.</p></Card>}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Card className="p-3 sm:p-4">
            <form method="get" className="flex flex-wrap items-center gap-2">
              <div className="flex gap-1 rounded-[10px] border border-line bg-bg/70 p-1" role="radiogroup" aria-label="Posição">
                {([["", "Todos"], ["GK", "GR"], ["DEF", "DEF"], ["MID", "MED"], ["ATT", "AV"]] as const).map(([v, l]) => (
                  <label key={v} className="cursor-pointer">
                    <input type="radio" name="pos" value={v} defaultChecked={(sp.pos ?? "") === v} className="peer sr-only" />
                    <span className="flex h-9 items-center rounded-lg px-2.5 text-xs font-bold text-muted transition peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:ring-2 peer-focus-visible:ring-accent">{l}</span>
                  </label>
                ))}
              </div>
              <span className="w-28"><input name="min" type="number" min={1} max={99} defaultValue={sp.min} placeholder="OVR mín." aria-label="OVR mínimo" className={inputCls} /></span>
              <span className="w-36"><input name="price" type="number" min={0} defaultValue={sp.price} placeholder="Preço máx. €" aria-label="Preço máximo" className={inputCls} /></span>
              <select name="sort" defaultValue={sort} aria-label="Ordenar" className={cn(inputCls, "w-40")}>
                {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              <button type="submit" className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-accent px-5 text-sm font-bold text-accent-ink hover:brightness-110"><Search className="size-4" />Filtrar</button>
            </form>
          </Card>

          <Card className="overflow-hidden p-0 sm:p-0">
            {others.length === 0 ? (
              <div className="p-4"><Empty title="Lista vazia" icon={<Tag />}>{game.status === "active" ? "Novos jogadores aparecem a cada jornada." : "A lista abre quando a liga começar."}</Empty></div>
            ) : (
              <ul className="divide-y divide-line">
                {others.map((l) => <ListingItem key={l.id} l={l} gameId={gameId} round={game.current_matchday} canBuy={!!clubId && available !== null} available={available ?? 0} />)}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle icon={<Users />}>Jogadores dos teus amigos</CardTitle>
            <p className="mb-3 text-sm text-muted">Para jogadores de outros treinadores fazes propostas (com troca e nota) a partir da ficha do jogador.</p>
            <form method="get" className="flex flex-wrap gap-2">
              <input name="q" defaultValue={sp.q} placeholder="Nome do jogador…" aria-label="Nome do jogador" className={cn(inputCls, "min-w-[180px] flex-1")} />
              <select name="fpos" defaultValue={sp.fpos ?? ""} aria-label="Posição" className={cn(inputCls, "w-32")}>
                <option value="">Todas</option><option value="GK">GR</option><option value="DEF">DEF</option><option value="MID">MED</option><option value="ATT">AV</option>
              </select>
              <button type="submit" className="inline-flex min-h-11 items-center gap-2 rounded-[10px] border border-line-strong px-4 text-sm font-bold hover:bg-surface-2"><Search className="size-4" />Procurar</button>
            </form>
            {friends && (friendRows.length === 0 ? <p className="mt-3 text-sm text-muted">Nenhum jogador encontrado nos plantéis dos amigos.</p> : (
              <ul className="mt-3 divide-y divide-line">
                {friendRows.slice(0, 20).map((p) => (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <OvrBadge ovr={p.current_ovr} size="sm" />
                    <PosPill group={p.position_group} />
                    <Link href={`/g/${gameId}/players/${p.id}`} prefetch={false} className="min-w-0 flex-1 truncate font-semibold hover:text-accent">{p.name_snapshot}</Link>
                    <span className="hidden truncate text-xs text-muted sm:inline">{p.club_name}</span>
                    <Link href={`/g/${gameId}/players/${p.id}`} prefetch={false} className="inline-flex items-center gap-1 rounded-[10px] border border-line-strong px-3 py-1.5 text-xs font-bold hover:bg-surface-2"><Handshake className="size-3.5" />Proposta</Link>
                  </li>
                ))}
              </ul>
            ))}
          </Card>
        </div>

        <aside className="space-y-5">
          {clubId && !classic && (
            <Card>
              <CardTitle icon={<Tag />} action={<Badge tone={myListings.length >= slots ? "warn" : "default"}>{myListings.length}/{slots} vagas</Badge>}>Os meus à venda</CardTitle>
              {myListings.length > 0 && (
                <ul className="mb-4 space-y-2">
                  {myListings.map((l) => {
                    const ratio = Number(l.price_cents) / Math.max(1, Number(l.value_cents));
                    return (
                      <li key={l.id} className="flex items-center gap-2.5 rounded-xl bg-surface-2 p-2.5">
                        <OvrBadge ovr={l.ovr} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{l.name}</p>
                          <p className="text-xs text-muted tabular">{eur(l.price_cents)} · {Math.round(ratio * 100)}% do valor</p>
                        </div>
                        <ActionForm action={unlistPlayerAction} hidden={{ gameId, playerId: l.player_id! }} submitLabel="Retirar" variant="ghost" inline submitClassName="min-h-8 px-2 text-xs" />
                      </li>
                    );
                  })}
                </ul>
              )}
              <ListForm gameId={gameId} players={sellable.filter((p) => !p.listed)} slotsLeft={slots - myListings.length} />
            </Card>
          )}

          {freeAgents.length > 0 && (
            <Card>
              <CardTitle action={<Badge tone={windowOpen ? "accent" : "default"} dot={windowOpen}>{windowOpen ? "Até à J3" : "Fechado"}</Badge>}>Jogadores livres</CardTitle>
              <ul className="space-y-2 text-sm">
                {freeAgents.map((p) => (
                  <li key={p.id} className="flex items-center gap-2.5">
                    <OvrBadge ovr={p.current_ovr} size="sm" />
                    <PosPill group={p.position_group} />
                    <Link href={`/g/${gameId}/players/${p.id}`} prefetch={false} className="flex-1 truncate font-semibold hover:text-accent">{p.name_snapshot}</Link>
                    <span className="text-xs text-muted tabular">{eur(p.free_agent_wage_cents)}/j</span>
                    {windowOpen && clubId && (
                      <ActionForm action={signFreeAgentAction} hidden={{ gameId, playerId: p.id }} submitLabel="Contratar" variant="ghost" inline submitClassName="min-h-8 px-2 text-xs"
                        confirm={`Contratar ${p.name_snapshot} sem custo de transferência (salário ${eur(p.free_agent_wage_cents, false)}/jornada)?`} />
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardTitle icon={<Handshake />}>Propostas entre amigos</CardTitle>
            {offers.length === 0 ? <p className="text-sm text-muted">Sem propostas.</p> : (
              <ul className="space-y-2.5 text-sm">
                {offers.map((o) => (
                  <li key={o.id} className="rounded-xl border border-line bg-bg/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Link href={`/g/${gameId}/players/${o.player_id}`} prefetch={false} className="truncate font-bold hover:text-accent">{o.player_name}</Link>
                      <Badge tone={o.status === "pending" ? "info" : o.status === "accepted" ? "accent" : "default"} dot={o.status === "pending"}>{STATUS[o.status] ?? o.status}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {o.i_am_buyer ? `Para ${o.seller_name}` : `De ${o.buyer_name}`} · {o.swap_name ? <><b className="text-ink">{o.swap_name}</b> + </> : null}<b className="font-display text-sm text-ink">{eur(o.amount_cents)}</b>
                      {o.counter_amount_cents ? <> · pedem <b className="font-display text-sm text-warn">{eur(o.counter_amount_cents)}</b>{o.swap_name ? " + a troca" : ""}</> : ""}
                    </p>
                    {o.message && <p className="mt-1 text-xs italic text-muted">«{o.message}»</p>}
                    {o.counter_message && <p className="mt-1 text-xs italic text-warn">«{o.counter_message}»</p>}
                    {o.status === "pending" && (o.i_am_buyer ? (
                      <ActionForm action={cancelOfferAction} hidden={{ gameId, offerId: o.id }} submitLabel="Cancelar" variant="ghost" inline className="mt-1" submitClassName="min-h-8 px-2 text-xs" />
                    ) : (
                      <div className="mt-2 space-y-2">
                        <div className="flex gap-2">
                          <ActionForm action={respondOfferAction} hidden={{ gameId, offerId: o.id, accept: "true" }} submitLabel="Aceitar" inline submitClassName="min-h-9"
                            confirm={o.swap_name ? `Trocar ${o.player_name} por ${o.swap_name} + ${eur(o.amount_cents, false)}?` : `Vender ${o.player_name} por ${eur(o.amount_cents, false)}?`} />
                          <ActionForm action={respondOfferAction} hidden={{ gameId, offerId: o.id, accept: "false" }} submitLabel="Recusar" variant="secondary" inline submitClassName="min-h-9" />
                        </div>
                        <details className="group rounded-xl border border-line bg-surface/40 px-3 py-2">
                          <summary className="cursor-pointer text-xs font-bold text-muted group-open:text-ink">Contrapropor</summary>
                          <ActionForm action={counterOfferAction} hidden={{ gameId, offerId: o.id }} submitLabel="Enviar contraproposta" variant="secondary" className="mt-2 space-y-2" submitClassName="min-h-9 w-full">
                            <input name="amountEur" inputMode="numeric" required defaultValue={Math.round(Number(o.amount_cents) / 100 * 1.25)} aria-label="Valor pedido (€)" className={cn(inputCls, "min-h-9 font-display font-bold tabular")} />
                            <input name="message" maxLength={140} placeholder="Nota (opcional)" aria-label="Nota da contraproposta" className={cn(inputCls, "min-h-9")} />
                          </ActionForm>
                        </details>
                      </div>
                    ))}
                    {o.status === "countered" && o.i_am_buyer && !o.has_reply && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <ActionForm action={acceptCounterAction} hidden={{ gameId, offerId: o.id, idempotencyKey: randomUUID() }} submitLabel="Aceitar contraproposta" inline submitClassName="min-h-9"
                          confirm={`Pagar ${eur(o.counter_amount_cents, false)}${o.swap_name ? ` + ${o.swap_name}` : ""} por ${o.player_name}?`} />
                        <Link href={`/g/${gameId}/players/${o.player_id}?parent=${o.id}`} prefetch={false} className="inline-flex min-h-9 items-center rounded-[10px] border border-line-strong bg-surface-2 px-3 text-xs font-bold hover:border-faint">Nova proposta</Link>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle icon={<History />}>Vendidos na lista</CardTitle>
            {activity.length === 0 ? <p className="text-sm text-muted">Ainda ninguém comprou.</p> : (
              <ul className="space-y-3 text-sm">
                {activity.map((a) => (
                  <li key={a.id} className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink"><ArrowRight className="size-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      {a.player_id ? <Link href={`/g/${gameId}/players/${a.player_id}`} prefetch={false} className="block truncate font-bold hover:text-accent">{a.name}</Link> : <span className="block truncate font-bold">{a.name}</span>}
                      <p className="truncate text-xs text-muted">{a.seller_name} → {a.buyer_name}{a.closed_round !== null ? ` · J${a.closed_round}` : ""}</p>
                    </div>
                    <span className="font-display text-base font-black tabular">{eur(a.sold_price_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function ListingItem({ l, gameId, round, canBuy, available }: { l: ListingRow; gameId: string; round: number; canBuy: boolean; available: number }) {
  const price = Number(l.price_cents), value = Number(l.value_cents), ratio = price / Math.max(1, value);
  const decays = l.origin !== "manager";
  const next = decays ? listingAfter(Number(l.start_price_cents), Number(l.floor_price_cents), l.rounds_unsold + 1) : null;
  const left = decays ? roundsOnList(Number(l.start_price_cents), Number(l.floor_price_cents)) - l.rounds_unsold : null;
  const fresh = l.listed_round === round && l.rounds_unsold === 0;
  const tone = ratio <= 0.85 ? "text-up" : ratio >= 1.2 ? "text-warn" : "text-muted";
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-3 py-3.5 sm:px-4">
      <OvrBadge ovr={l.ovr} />
      <PlayerAvatar id={l.player_id ?? l.id} primary={l.club_color ?? "#3a4048"} secondary={l.club_color2 ?? "#cfcac0"} size={38} className="hidden sm:block" />
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex items-center gap-2">
          {l.player_id ? <Link href={`/g/${gameId}/players/${l.player_id}`} prefetch={false} className="truncate font-bold hover:text-accent">{l.name}</Link> : <span className="truncate font-bold">{l.name}</span>}
          {fresh && <Badge tone="accent">Novo</Badge>}
          {l.origin === "manager" && <Badge tone="info">{l.seller_manager ?? "Amigo"}</Badge>}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <PosPill group={l.position_group} />
          {l.age ? <span>{l.age} anos</span> : null}
          <span className="inline-flex min-w-0 items-center gap-1 truncate">{l.origin === "external" ? <Globe className="size-3.5 shrink-0" /> : <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: l.club_color ?? "#64748b" }} />}{l.club_name}</span>
          <span>Pot. <b className="text-ink">{l.potential_band}</b></span>
        </p>
      </div>
      <div className="min-w-[132px] text-right">
        <p className="font-display text-2xl font-black leading-none tabular">{eur(price)}</p>
        <p className="mt-1 text-xs tabular"><b className={tone}>{Math.round(ratio * 100)}%</b> <span className="text-muted">de {eur(value)}</span></p>
        {next && (left !== null && left <= 1
          ? <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-down">Última jornada</p>
          : <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted"><TrendingDown className="size-3" />{eur(next.price)} na J{round + 1}</p>)}
        {!next && <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted"><ArrowDownRight className="size-3 rotate-45" />Preço fixo</p>}
      </div>
      {canBuy && <div className="w-full sm:w-auto"><BuyButton gameId={gameId} listingId={l.id} priceCents={l.price_cents} name={l.name} disabled={price > available} />{price > available && <p className="text-right text-xs text-muted">Sem verba</p>}</div>}
    </li>
  );
}
