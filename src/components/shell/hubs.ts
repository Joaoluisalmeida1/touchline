/**
 * The five hubs of the game shell (plus Clube, reached from the crest on phones). Each hub has its own sub-tabs;
 * every pre-v2 route lives under exactly one hub, so URLs did not change.
 */
import { ArrowLeftRight, CalendarDays, House, Landmark, Shirt, Trophy, type LucideIcon } from "lucide-react";

export type HubId = "hoje" | "equipa" | "jogo" | "mercado" | "clube" | "liga";

export interface SubTab { key: string; label: string; keywords?: string }
export interface Hub { id: HubId; label: string; icon: LucideIcon; tabs: SubTab[]; dock: boolean }

export function hubs(isOwner: boolean): Hub[] {
  return [
    { id: "hoje", label: "Hoje", icon: House, dock: true, tabs: [
      { key: "", label: "Resumo", keywords: "início overview home" },
      { key: "/week", label: "Semana", keywords: "gabinete imprensa treino adversário decisões" },
    ] },
    { id: "equipa", label: "Equipa", icon: Shirt, dock: true, tabs: [
      { key: "/squad", label: "Plantel", keywords: "escalação onze jogadores" },
      { key: "/tactics", label: "Tática", keywords: "instruções pressão bloco plano" },
    ] },
    { id: "jogo", label: "Jogo", icon: CalendarDays, dock: true, tabs: [
      { key: "/fixtures", label: "Jogos", keywords: "calendário resultados centro de jogo" },
    ] },
    { id: "mercado", label: "Mercado", icon: ArrowLeftRight, dock: true, tabs: [
      { key: "/market", label: "Mercado", keywords: "transferências propostas livres contratar" },
    ] },
    { id: "clube", label: "Clube", icon: Landmark, dock: false, tabs: [
      { key: "/club", label: "Clube", keywords: "direção patrocínios estádio bilhetes staff formação contratos" },
      { key: "/finances", label: "Finanças", keywords: "dinheiro saldo orçamento" },
    ] },
    { id: "liga", label: "Liga", icon: Trophy, dock: true, tabs: [
      { key: "/table", label: "Tabela", keywords: "classificação pontos" },
      { key: "/news", label: "Jornal", keywords: "o apito notícias" },
      { key: "/cup", label: "Taça", keywords: "eliminatórias" },
      { key: "/social", label: "Balneário", keywords: "mural social conquistas treinadores" },
      { key: "/history", label: "História", keywords: "palmarés épocas" },
      { key: "/settings", label: isOwner ? "Definições" : "Liga", keywords: "convite membros regras" },
    ] },
  ];
}

/** Which hub and sub-tab a pathname belongs to. */
export function locate(path: string, base: string, all: Hub[]): { hub: Hub; tabHref: string } {
  const rest = path.startsWith(base) ? path.slice(base.length) : "";
  const byPrefix = (key: string) => key !== "" && (rest === key || rest.startsWith(key + "/"));
  for (const h of all) {
    const t = h.tabs.find((x) => byPrefix(x.key));
    if (t) return { hub: h, tabHref: base + t.key };
  }
  if (rest.startsWith("/matches/")) return { hub: all.find((h) => h.id === "jogo")!, tabHref: base + "/fixtures" };
  if (rest.startsWith("/players/")) return { hub: all.find((h) => h.id === "equipa")!, tabHref: base + "/squad" };
  return { hub: all[0], tabHref: rest === "" ? base : "" };
}
