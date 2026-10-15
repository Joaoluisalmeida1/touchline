import { Empty } from "@/components/ui";
import { SquadHub, type HubTab } from "@/components/squad/hub";
import { requireUser } from "@/server/auth";
import { loadSquadHub } from "@/server/squad-view";

export const metadata = { title: "Plantel" };
const TABS: HubTab[] = ["equipa", "instrucoes", "lista", "profundidade"];

export default async function SquadPage({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { gameId } = await params;
  const { tab } = await searchParams;
  const user = await requireUser();
  const { data } = await loadSquadHub(user.id, gameId);
  if (!data) return <Empty title="Ainda não tens clube">Escolhe um clube no Resumo.</Empty>;
  return (
    <SquadHub gameId={gameId} {...data} initialTab={TABS.includes(tab as HubTab) ? (tab as HubTab) : "equipa"} />
  );
}
