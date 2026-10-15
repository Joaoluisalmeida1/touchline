"use client";
import { useMemo } from "react";
import { ActionForm } from "./action-form";
import { Field, inputCls } from "./ui";
import { createOfferAction } from "@/server/actions";

export function OfferForm({ gameId, playerId, suggestedEur, aiClub }: { gameId: string; playerId: string; suggestedEur: number; aiClub: boolean }) {
  // one idempotency key per rendered form: double clicks / retries cannot create two offers
  const key = useMemo(() => crypto.randomUUID(), []);
  return (
    <ActionForm action={createOfferAction} hidden={{ gameId, playerId, idempotencyKey: key }} submitLabel="Fazer proposta" pendingLabel="A enviar…">
      <Field label="Valor da proposta (€)" hint={aiClub ? `Clube gerido pela IA: responde de imediato. Valor pedido: €${suggestedEur.toLocaleString("pt-PT")}.` : "O treinador recebe a proposta e decide. A verba fica reservada até lá."}>
        <input name="amountEur" inputMode="numeric" required defaultValue={suggestedEur} className={inputCls} />
      </Field>
    </ActionForm>
  );
}
