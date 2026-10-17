"use client";
import { useEffect } from "react";
import { Button, ButtonLink, Card } from "@/components/ui";

/** A failing league page keeps the league header/tabs and offers a retry instead of a blank screen. */
export default function LeagueError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(JSON.stringify({ level: "error", msg: "page.failed", scope: "league", digest: error.digest, error: error.message }));
  }, [error]);
  return (
    <Card className="mx-auto max-w-lg text-center">
      <p className="eyebrow">Erro</p>
      <h2 className="headline mt-1 text-2xl">Não foi possível carregar esta secção</h2>
      <p className="mt-2 text-sm text-muted">Pode ser uma falha temporária. Tenta novamente; se persistir, avisa o criador da liga.</p>
      {error.digest && <p className="mt-2 font-mono text-xs text-faint">Ref. {error.digest}</p>}
      <div className="mt-5 flex justify-center gap-2">
        <Button onClick={reset}>Tentar novamente</Button>
        <ButtonLink href="/dashboard" variant="secondary">As minhas ligas</ButtonLink>
      </div>
    </Card>
  );
}
