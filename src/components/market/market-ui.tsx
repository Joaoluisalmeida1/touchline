"use client";
/** Client pieces of the Transfer List: buy button (idempotent, confirm) and the "pôr à venda" form with the 50–150% range. */
import { ShoppingCart, Tag } from "lucide-react";
import { useMemo, useState } from "react";
import { ActionForm } from "../action-form";
import { Field, cn, eur, inputCls } from "../ui";
import { buyListingAction, listPlayerAction } from "@/server/actions";

export function BuyButton({ gameId, listingId, priceCents, name, disabled }: { gameId: string; listingId: string; priceCents: string; name: string; disabled?: boolean }) {
  const key = useMemo(() => crypto.randomUUID(), []);
  if (disabled) return null;
  return (
    <ActionForm action={buyListingAction} hidden={{ gameId, listingId, priceCents, idempotencyKey: key }} inline
      submitLabel="Comprar" pendingLabel="A comprar…" icon={<ShoppingCart className="size-4" />} submitClassName="min-h-10 px-4"
      confirm={`Comprar ${name} por ${eur(priceCents, false)}?`} className="justify-end" />
  );
}

const roundPrice = (cents: number) => Math.max(10_000_000, Math.round(cents / 1_000_000) * 1_000_000);

export function ListForm({ gameId, players, slotsLeft }: {
  gameId: string; players: { id: string; name: string; position_group: string; ovr: number; value_cents: string }[]; slotsLeft: number;
}) {
  const [id, setId] = useState(players[0]?.id ?? "");
  const p = players.find((x) => x.id === id);
  const value = Number(p?.value_cents ?? 0);
  const min = roundPrice(value * 0.5), max = roundPrice(value * 1.5);
  const [pct, setPct] = useState(120);
  const price = roundPrice((value * pct) / 100);
  if (!players.length) return <p className="text-sm text-muted">Não tens jogadores disponíveis para vender.</p>;
  if (slotsLeft <= 0) return <p className="text-sm text-muted">Vagas cheias. Retira um jogador para pôr outro à venda.</p>;
  return (
    <ActionForm action={listPlayerAction} hidden={{ gameId, playerId: id, askingEur: String(Math.round(price / 100)) }}
      submitLabel="Pôr na Lista" icon={<Tag className="size-4" />} variant="secondary" submitClassName="w-full" resetOnSuccess>
      <Field label="Jogador">
        <select value={id} onChange={(e) => setId(e.target.value)} className={inputCls} aria-label="Jogador a vender">
          {players.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.position_group} · {x.ovr} · {eur(x.value_cents)}</option>)}
        </select>
      </Field>
      <div>
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Preço pedido</span>
          <span className={cn("text-xs font-bold tabular", pct <= 90 ? "text-up" : pct >= 130 ? "text-warn" : "text-muted")}>{pct}% do valor</span>
        </div>
        <p className="font-display text-4xl font-black leading-tight tabular">{eur(price)}</p>
        <input type="range" min={50} max={150} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} aria-label="Percentagem do valor" className="w-full" />
        <div className="flex justify-between text-[11px] text-muted tabular"><span>{eur(min)}</span><span>valor {eur(value)}</span><span>{eur(max)}</span></div>
        <p className="mt-2 text-xs text-muted">Os amigos podem comprar logo a este preço. A IA compra nas jornadas — mais depressa quanto mais barato, sobretudo no início da época.</p>
      </div>
    </ActionForm>
  );
}
