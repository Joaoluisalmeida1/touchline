"use client";
import { useEffect } from "react";
import { Button, ButtonLink, Card } from "@/components/ui";

/** App-wide fallback for errors outside the league section (dashboard, auth, admin…). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", msg: "page.failed", scope: "app", digest: error.digest, error: error.message }));
  }, [error]);
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <Card className="text-center">
        <p className="eyebrow">Erro</p>
        <h1 className="headline mt-1 text-2xl">Algo correu mal</h1>
        <p className="mt-2 text-sm text-muted">Pode ser uma falha temporária. Tenta novamente.</p>
        {error.digest && <p className="mt-2 font-mono text-xs text-faint">Ref. {error.digest}</p>}
        <div className="mt-5 flex justify-center gap-2">
          <Button onClick={reset}>Tentar novamente</Button>
          <ButtonLink href="/" variant="secondary">Início</ButtonLink>
        </div>
      </Card>
    </main>
  );
}
