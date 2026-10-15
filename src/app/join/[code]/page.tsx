import { Handshake } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Reveal } from "@/components/fx/motion";
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
      <main className="mx-auto max-w-md px-4 py-12 sm:py-20">
        <Reveal>
          <Card glow className="overflow-hidden p-7 text-center">
            <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0" />
            <div className="relative">
              <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-ink shadow-[0_10px_30px_-10px_rgb(212_255_58/.7)]"><Handshake className="size-6" /></span>
              <p className="eyebrow mt-6 justify-center">Convite recebido</p>
              <h1 className="headline mt-2 text-4xl">Foste convidado para uma liga</h1>
              <p className="mt-3 text-sm text-muted">Ao entrares, poderás escolher um clube que ainda não tenha treinador.</p>
              <p className="mt-4 inline-block rounded-xl bg-bg/70 px-3 py-1.5 font-mono text-sm tracking-[0.2em] text-muted ring-1 ring-line">{code.slice(0, 24)}</p>
              <div className="mt-6">
                <ActionForm action={joinGameAction} hidden={{ code }} submitLabel="Aceitar convite" pendingLabel="A entrar…" submitClassName="min-h-12 w-full text-base" />
              </div>
            </div>
          </Card>
        </Reveal>
      </main>
    </>
  );
}
