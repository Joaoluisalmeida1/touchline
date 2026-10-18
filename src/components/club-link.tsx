import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./ui";

/** Wraps a club crest/name so it opens that club's page (squad and status). Use only where it is not inside another link. */
export function ClubLink({ gameId, clubId, children, className, label }: { gameId: string; clubId: string; children: ReactNode; className?: string; label?: string }) {
  return (
    <Link href={`/g/${gameId}/clubs/${clubId}`} prefetch={false} aria-label={label} className={cn("rounded-lg transition hover:text-accent focus-visible:outline-2 focus-visible:outline-accent", className)}>
      {children}
    </Link>
  );
}
