import { Empty } from "@/components/ui";
import { SquadHub } from "@/components/squad/hub";
import { requireUser } from "@/server/auth";
import { loadSquadHub } from "@/server/squad-view";

export const metadata = { title: "Tática" };

export default async function TacticsPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const { data } = await loadSquadHub(user.id, gameId);
  if (!data) return <Empty title="Ainda não tens clube">Escolhe um clube no Resumo.</Empty>;
  return <SquadHub gameId={gameId} {...data} initialTab="instrucoes" />;
}
