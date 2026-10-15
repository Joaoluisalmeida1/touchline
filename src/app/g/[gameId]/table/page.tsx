import { Card, ClubDot, Empty, cn } from "@/components/ui";
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
  if (!rows.length) return <Empty title="Sem classificação ainda" />;
  return (
    <Card className="overflow-x-auto p-0">
      <div className="flex items-center gap-2 border-b border-line p-3 text-sm">
        <span className="text-muted">Época</span>
        {Array.from({ length: game.current_season }, (_, i) => i + 1).map((n) => (
          <a key={n} href={`?season=${n}`} className={cn("rounded-full px-3 py-1", (season ?? game.current_season) === n ? "bg-surface-2 font-semibold" : "text-muted")}>{n}</a>
        ))}
      </div>
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-faint">
          <tr><th className="p-3">#</th><th className="p-3">Clube</th><th className="p-3 text-center">J</th><th className="p-3 text-center">V</th><th className="p-3 text-center">E</th><th className="p-3 text-center">D</th><th className="p-3 text-center">GM</th><th className="p-3 text-center">GS</th><th className="p-3 text-center">DG</th><th className="p-3 text-center">Pts</th><th className="p-3">Forma</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => (
            <tr key={r.club_id} className={cn(r.club_id === game.my_club_id && "bg-accent/10")}>
              <td className="p-3 text-muted tabular">{i + 1}</td>
              <td className="p-3"><span className="flex items-center gap-2 font-semibold"><ClubDot color={r.primary_color} />{r.name_snapshot}</span><span className="text-xs text-muted">{r.manager_name ?? "IA"}</span></td>
              {[r.played, r.won, r.drawn, r.lost, r.gf, r.ga, r.gd > 0 ? `+${r.gd}` : r.gd].map((v, k) => <td key={k} className="p-3 text-center tabular">{v}</td>)}
              <td className="p-3 text-center text-base font-black tabular">{r.points}</td>
              <td className="p-3"><span className="flex gap-0.5">{r.form.split("").map((c: string, k: number) => <span key={k} className={cn("inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold", c === "W" ? "bg-accent text-accent-ink" : c === "D" ? "bg-slate-500" : "bg-danger text-black")}>{c === "W" ? "V" : c === "D" ? "E" : "D"}</span>)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-line p-3 text-xs text-faint">Desempate: pontos, diferença de golos, golos marcados, vitórias.</p>
    </Card>
  );
}
