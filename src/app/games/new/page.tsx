import { Database } from "lucide-react";
import { Reveal } from "@/components/fx/motion";
import { SiteHeader } from "@/components/site-header";
import { Card, Empty, Headline } from "@/components/ui";
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
      <main className="mx-auto max-w-2xl px-4 pb-16 pt-8 sm:pt-12">
        <Headline kicker="Nova competição" className="mb-8">Criar liga privada</Headline>
        {options.length === 0 ? (
          <Empty title="Não há datasets disponíveis" icon={<Database />}>
            Um administrador tem de importar e finalizar um dataset (ou correr <code>npm run seed:synthetic</code> em desenvolvimento).
          </Empty>
        ) : (
          <Reveal>
            <Card className="p-6 sm:p-7">
              <NewGameForm options={options.map((o) => ({ snapshotId: o.id, label: o.label, synthetic: o.is_synthetic, leagueId: o.league_id, leagueName: o.league_name, country: o.country, clubs: o.clubs }))} />
            </Card>
          </Reveal>
        )}
      </main>
    </>
  );
}
