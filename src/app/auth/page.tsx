import { redirect } from "next/navigation";
import { AuthForms } from "./forms";
import { Reveal } from "@/components/fx/motion";
import { SiteHeader } from "@/components/site-header";
import { getUser } from "@/server/auth";

export const metadata = { title: "Entrar" };

export default async function AuthPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const sp = await searchParams;
  if (await getUser()) redirect(sp.next ?? "/dashboard");
  return (
    <>
      <SiteHeader />
      <div className="relative overflow-hidden">
        <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0" />
        <main className="relative mx-auto max-w-md px-4 py-10 sm:py-16">
          <h1 className="sr-only">Entrar ou criar conta</h1>
          <Reveal><AuthForms next={sp.next ?? ""} initialMode={sp.mode === "signup" ? "signup" : "login"} /></Reveal>
          <p className="mt-6 text-center text-xs text-faint">Sem compras na app nem apostas. Só futebol e rivalidades entre amigos.</p>
        </main>
      </div>
    </>
  );
}
