const eur = (c: unknown) => `€${Math.round(Number(c) / 100).toLocaleString("pt-PT")}`;

export function notificationText(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case "member_joined": return `${p.display_name ?? "Um manager"} entrou na liga.`;
    case "game_started": return `A liga começou: ${p.rounds} jornadas.`;
    case "matchday_completed": return `Jornada ${p.round} concluída.`;
    case "season_completed": return `Época ${p.season ?? ""} terminada.`;
    case "offer_received": return p.swap
      ? `Proposta de ${p.buyer} por ${p.player}: ${p.swap} + ${eur(p.amount_cents)}.`
      : `Proposta de ${p.buyer} por ${p.player}: ${eur(p.amount_cents)}.`;
    case "offer_countered": return `Contraproposta por ${p.player}: pedem ${eur(p.amount_cents)}.`;
    case "achievement": return `Conquista desbloqueada: ${p.title}.`;
    case "offer_rejected": return "Uma proposta tua foi recusada.";
    case "transfer_completed": return `${p.direction === "in" ? "Contrataste" : "Vendeste"} ${p.player} por ${eur(p.amount_cents)}.`;
    case "week_ready": {
      const parts = [p.press ? "conferência de imprensa" : "", Number(p.events) > 0 ? `${p.events} ${Number(p.events) === 1 ? "assunto" : "assuntos"} no Gabinete` : ""].filter(Boolean);
      return parts.length ? `Jornada ${p.round}: ${parts.join(" e ")} à tua espera.` : `Jornada ${p.round} a caminho.`;
    }
    case "board_warning": return `Aviso da direção: a confiança caiu para ${p.confidence}.`;
    case "board_ultimatum": return `Ultimato da direção (confiança ${p.confidence}): orçamento de transferências cortado.`;
    case "board_praise": return `A direção está satisfeita (confiança ${p.confidence}): orçamento de transferências reforçado.`;
    default: return type;
  }
}
