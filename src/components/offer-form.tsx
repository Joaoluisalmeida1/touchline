"use client";
import { Handshake } from "lucide-react";
import { useMemo, useState } from "react";
import { ActionForm } from "./action-form";
import { Field, cn, inputCls } from "./ui";
import { createOfferAction } from "@/server/actions";

/**
 * Offer form. AI clubs: cash only, answered at once. Human clubs: optional player swap (+ cash, can be €0), a short
 * note, and — when coming from a counter-offer — the parent offer of the negotiation thread.
 */
export function OfferForm({ gameId, playerId, suggestedEur, aiClub, mySquad = [], parentOfferId }: {
  gameId: string; playerId: string; suggestedEur: number; aiClub: boolean;
  mySquad?: { id: string; name: string; ovr: number; position_group: string }[]; parentOfferId?: string;
}) {
  // one idempotency key per rendered form: double clicks / retries cannot create two offers
  const key = useMemo(() => crypto.randomUUID(), []);
  const [swap, setSwap] = useState("");
  const hidden: Record<string, string> = { gameId, playerId, idempotencyKey: key };
  if (parentOfferId) hidden.parentOfferId = parentOfferId;
  return (
    <ActionForm action={createOfferAction} hidden={hidden} submitLabel={parentOfferId ? "Enviar nova proposta" : "Fazer proposta"} pendingLabel="A enviar…"
      icon={<Handshake className="size-4" />} submitClassName="w-full min-h-11">
      {!aiClub && mySquad.length > 0 && (
        <Field label="Troca (opcional)" hint="Ofereces um jogador teu. Com troca, o valor em dinheiro pode ser €0.">
          <select name="swapPlayerId" value={swap} onChange={(e) => setSwap(e.target.value)} className={inputCls}>
            <option value="">Sem troca — só dinheiro</option>
            {mySquad.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.position_group} · {p.ovr}</option>)}
          </select>
        </Field>
      )}
      <Field label={swap ? "Dinheiro a juntar à troca (€)" : "Valor da proposta (€)"} hint={aiClub ? `Clube gerido pela IA: responde de imediato. Valor pedido: €${suggestedEur.toLocaleString("pt-PT")}.` : "O treinador recebe a proposta e pode aceitar, recusar ou contrapropor. A verba fica reservada até lá."}>
        <span className="relative block">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-display text-lg font-bold text-faint">€</span>
          <input name="amountEur" inputMode="numeric" required defaultValue={swap ? 0 : suggestedEur} key={swap ? "swap" : "cash"} className={cn(inputCls, "pl-8 font-display text-lg font-bold tabular")} />
        </span>
      </Field>
      {!aiClub && (
        <Field label="Nota (opcional)">
          <input name="message" maxLength={140} placeholder="Ex.: última oferta antes do fecho do mercado" className={inputCls} />
        </Field>
      )}
    </ActionForm>
  );
}
