import Link from "next/link";
import { ListOrdered } from "lucide-react";
import { ClubLink } from "@/components/club-link";
import { Crest } from "@/components/crest";
import { Card, Empty, FormStrip, cn } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { getGame, getStandings } from "@/server/queries";

export const metadata = { title: "Classificação" };

export default async function TablePage({ params, searchParams }: { params: Promise<{ gameId: string }>; searchParams: Promise<{ season?: string }> }) {
  const { gameId } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const season = sp.season ? Number(sp.season) : undefined;
  const rows = await getStandings(user.id, gameId, season);
  if (!rows.length) return <Empty title="Sem classificação ainda" icon={<ListOrdered />}>A tabela aparece quando a liga começar.</Empty>;
  const n = rows.length;
  const zone = (i: number) => (i === 0 ? "bg-accent" : i < 3 ? "bg-info" : i >= n - 2 && n > 6 ? "bg-danger" : "bg-transparent");
  const top = rows.slice(0, 3);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        {top.map((r, i) => (
          <Link key={r.club_id} href={`/g/${gameId}/clubs/${r.club_id}`} prefetch={false}
            className={cn("surface relative overflow-hidden rounded-[var(--radius-card)] p-3 text-center transition hover:border-line-strong sm:p-5", i === 0 && "border-accent/40")}>
            <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-16 mx-auto size-40 rounded-full opacity-25 blur-2xl" style={{ background: r.primary_color }} />
            <p className={cn("relative font-display text-sm font-extrabold uppercase", i === 0 ? "text-accent" : "text-faint")}>{i + 1}º</p>
            <Crest id={r.club_id} name={r.name_snapshot} short={r.short_name} color={r.primary_color} color2={r.secondary_color} size={44} className="relative mx-auto mt-1" />
            <p className="relative mt-2 truncate text-xs font-bold sm:text-sm">{r.name_snapshot}</p>
            <p className="relative font-display text-2xl font-extrabold leading-tight tabular sm:text-3xl">{r.points}<span className="ml-1 text-[10px] font-bold uppercase text-faint">pontos</span></p>
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden p-0 sm:p-0">
        <div className="flex items-center gap-2 border-b border-line p-3 text-sm">
          <span className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-faint">Época</span>
          {Array.from({ length: game.current_season }, (_, i) => i + 1).map((s) => (
            <Link key={s} href={`?season=${s}`} className={cn("rounded-lg px-3 py-1 font-display text-base font-bold", (season ?? game.current_season) === s ? "bg-accent text-accent-ink" : "text-muted hover:bg-surface-2")}>{s}</Link>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm sm:min-w-[640px]">
            <thead className="text-left text-[10px] font-bold uppercase tracking-[0.12em] text-faint">
              <tr className="border-b border-line">
                <th className="w-12 py-3 pl-4">#</th><th className="py-3">Clube</th>
                {["J", "V", "E", "D", "GM", "GS", "DG"].map((h, k) => <th key={h} className={cn("w-10 py-3 text-center", k > 0 && k < 6 && "hidden sm:table-cell")}>{h}</th>)}
                <th className="w-14 py-3 pr-2 text-center text-ink">Pts</th><th className="hidden py-3 pr-4 sm:table-cell">Forma</th>
              </tr>
            </thead>
              <tbody className="divide-y divide-line/60">
                {rows.map((r, i) => {
                  const mine = r.club_id === game.my_club_id;
                  return (
                    <tr key={r.club_id} className={cn("relative transition-colors hover:bg-surface-2/60", mine && "bg-accent/[.07]")}>
                      <td className="relative py-2.5 pl-4">
                        <span aria-hidden className={cn("absolute inset-y-1.5 left-0 w-[3px] rounded-r", mine ? "bg-accent" : zone(i))} />
                        <span className={cn("font-display text-lg font-bold tabular", i === 0 ? "text-accent" : "text-muted")}>{i + 1}</span>
                      </td>
                      <td className="py-2.5">
                        <ClubLink gameId={gameId} clubId={r.club_id} className="flex items-center gap-2.5">
                          <Crest id={r.club_id} name={r.name_snapshot} short={r.short_name} color={r.primary_color} color2={r.secondary_color} size={26} />
                          <span className="min-w-0">
                            <span className={cn("block truncate", mine ? "font-bold" : "font-semibold")}>{r.name_snapshot}</span>
                            <span className="block text-[11px] text-faint">{r.manager_name ?? "IA"}</span>
                          </span>
                        </ClubLink>
                      </td>
                      {[r.played, r.won, r.drawn, r.lost, r.gf, r.ga, r.gd > 0 ? `+${r.gd}` : r.gd].map((v, k) => (
                        <td key={k} className={cn("py-2.5 text-center tabular", k > 0 && k < 6 && "hidden sm:table-cell", k === 6 ? (r.gd > 0 ? "text-accent" : r.gd < 0 ? "text-danger" : "text-muted") : "text-muted")}>{v}</td>
                      ))}
                      <td className="py-2.5 text-center font-display text-xl font-extrabold tabular">{r.points}</td>
                      <td className="hidden py-2.5 pr-4 sm:table-cell"><FormStrip form={r.form} /></td>
                    </tr>
                  );
                })}
              </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line p-3 text-[11px] text-faint">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-[3px] rounded bg-accent" />Líder</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-[3px] rounded bg-info" />Pódio</span>
          {n > 6 && <span className="flex items-center gap-1.5"><span className="h-2.5 w-[3px] rounded bg-danger" />Últimos 2</span>}
          <span className="ml-auto">Desempate: pontos, diferença de golos, golos marcados, vitórias.</span>
        </div>
      </Card>
    </div>
  );
}
