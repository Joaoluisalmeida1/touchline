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
    case "cup_winner": return `${p.club} conquista a Taça da Liga dos Amigos!`;
    case "academy_intake": return `A academia tem ${p.count} novos jovens à espera de decisão.`;
    case "contracts_expired": return `${p.count} ${Number(p.count) === 1 ? "jogador saiu" : "jogadores saíram"} em fim de contrato.`;
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
    case "duel_challenge": return `${p.club} desafia-te para um duelo na roleta (€500 000).`;
    case "duel_result": return p.won ? `Ganhaste o duelo contra ${p.opponent}: +${eur(p.amount_cents)}.` : p.draw ? `Empate no duelo com ${p.opponent}.` : `Perdeste o duelo contra ${p.opponent}.`;
    case "bet_won": return `Aposta ganha: ${p.match} — recebeste ${eur(p.payout_cents)}.`;
    case "jackpot": return `${p.club} ganhou o JACKPOT da liga: ${eur(p.amount_cents)}!`;
    default: return type;
  }
}
