"use client";
import { useState } from "react";
import { Button } from "./ui";

export function CopyInvite({ code, link }: { code: string; link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">Partilha este link (válido 7 dias). Só aparece agora — guarda-o.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg bg-bg px-3 py-2 font-mono text-lg tracking-widest">{code}</code>
        <Button type="button" variant="secondary" onClick={async () => { await navigator.clipboard.writeText(link); setCopied(true); }}>
          {copied ? "Link copiado ✓" : "Copiar link"}
        </Button>
      </div>
      <p className="break-all text-xs text-faint">{link}</p>
    </div>
  );
}
