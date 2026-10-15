import { redirect } from "next/navigation";
import { AuthForms } from "./forms";
import { SiteHeader } from "@/components/site-header";
import { getUser } from "@/server/auth";

export const metadata = { title: "Entrar" };

export default async function AuthPage({ searchParams }: { searchParams: Promise<{ next?: string; mode?: string }> }) {
  const sp = await searchParams;
  if (await getUser()) redirect(sp.next ?? "/dashboard");
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-md px-4 py-12">
        <AuthForms next={sp.next ?? ""} initialMode={sp.mode === "signup" ? "signup" : "login"} />
      </main>
    </>
  );
}
