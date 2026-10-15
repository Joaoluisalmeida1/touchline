"use client";
import { Link2 } from "lucide-react";
import { CopyButton } from "./fx/copy-button";

export function CopyInvite({ code, link }: { code: string; link: string }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">Partilha este link (válido 7 dias). Só aparece agora — guarda-o.</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-xl border border-accent/30 bg-accent/[.06] px-4 py-2 font-mono text-lg font-semibold tracking-[0.22em] text-accent">{code}</code>
        <CopyButton value={link} />
      </div>
      <p className="flex items-center gap-1.5 break-all text-xs text-faint"><Link2 className="size-3.5 shrink-0" />{link}</p>
    </div>
  );
}
