import { ActionForm } from "@/components/action-form";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui";
import { joinGameAction } from "@/server/actions";
import { requireUser } from "@/server/auth";

export const metadata = { title: "Convite" };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await requireUser(`/join/${code}`);
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-md px-4 py-12">
        <Card className="p-6">
          <h1 className="text-2xl font-black">Foste convidado para uma liga</h1>
          <p className="mt-2 text-sm text-muted">Ao entrares, poderás escolher um clube que ainda não tenha treinador.</p>
          <div className="mt-6">
            <ActionForm action={joinGameAction} hidden={{ code }} submitLabel="Aceitar convite" pendingLabel="A entrar…" />
          </div>
        </Card>
      </main>
    </>
  );
}
