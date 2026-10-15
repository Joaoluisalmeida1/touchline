"use client";
import { Handshake } from "lucide-react";
import { useMemo } from "react";
import { ActionForm } from "./action-form";
import { Field, cn, inputCls } from "./ui";
import { createOfferAction } from "@/server/actions";

export function OfferForm({ gameId, playerId, suggestedEur, aiClub }: { gameId: string; playerId: string; suggestedEur: number; aiClub: boolean }) {
  // one idempotency key per rendered form: double clicks / retries cannot create two offers
  const key = useMemo(() => crypto.randomUUID(), []);
  return (
    <ActionForm action={createOfferAction} hidden={{ gameId, playerId, idempotencyKey: key }} submitLabel="Fazer proposta" pendingLabel="A enviar…"
      icon={<Handshake className="size-4" />} submitClassName="w-full min-h-11">
      <Field label="Valor da proposta (€)" hint={aiClub ? `Clube gerido pela IA: responde de imediato. Valor pedido: €${suggestedEur.toLocaleString("pt-PT")}.` : "O treinador recebe a proposta e decide. A verba fica reservada até lá."}>
        <span className="relative block">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-display text-lg font-bold text-faint">€</span>
          <input name="amountEur" inputMode="numeric" required defaultValue={suggestedEur} className={cn(inputCls, "pl-8 font-display text-lg font-bold tabular")} />
        </span>
      </Field>
    </ActionForm>
  );
}
