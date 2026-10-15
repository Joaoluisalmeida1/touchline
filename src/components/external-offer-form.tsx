"use client";
import { Handshake } from "lucide-react";
import { ActionForm } from "./action-form";
import { Field, cn, inputCls } from "./ui";
import { signExternalAction } from "@/server/actions";

/** Offer to an AI club outside the league: it answers at once (accepts at or above its asking price). */
export function ExternalOfferForm({ gameId, sourcePlayerId, askEur }: { gameId: string; sourcePlayerId: string; askEur: number }) {
  return (
    <ActionForm action={signExternalAction} hidden={{ gameId, sourcePlayerId }} submitLabel="Fazer proposta" pendingLabel="A negociar…"
      icon={<Handshake className="size-4" />} submitClassName="w-full min-h-11">
      <Field label="Valor da proposta (€)" hint={`Clube fora da liga, gerido pela IA: responde de imediato. Valor pedido: €${askEur.toLocaleString("pt-PT")}.`}>
        <span className="relative block">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-display text-lg font-bold text-faint">€</span>
          <input name="amountEur" inputMode="numeric" required defaultValue={askEur} className={cn(inputCls, "pl-8 font-display text-lg font-bold tabular")} />
        </span>
      </Field>
    </ActionForm>
  );
}
