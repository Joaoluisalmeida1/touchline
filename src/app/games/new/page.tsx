import { SiteHeader } from "@/components/site-header";
import { Card, Empty } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { listSnapshotsForCreation } from "@/server/queries";
import { NewGameForm } from "./form";

export const metadata = { title: "Criar liga" };
export const dynamic = "force-dynamic";

export default async function NewGame() {
  const user = await requireUser("/games/new");
  const options = await listSnapshotsForCreation(user.id);
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-6 text-3xl font-black tracking-tight">Criar liga privada</h1>
        {options.length === 0 ? (
          <Empty title="Não há datasets disponíveis">
            Um administrador tem de importar e finalizar um dataset (ou correr <code>npm run seed:synthetic</code> em desenvolvimento).
          </Empty>
        ) : (
          <Card className="p-6">
            <NewGameForm options={options.map((o) => ({ snapshotId: o.id, label: o.label, synthetic: o.is_synthetic, leagueId: o.league_id, leagueName: o.league_name, clubs: o.clubs }))} />
          </Card>
        )}
      </main>
    </>
  );
}
