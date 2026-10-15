import { notFound } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { Badge, Card, CardTitle } from "@/components/ui";
import { requireUser } from "@/server/auth";
import { withService } from "@/server/db";
import { getProfile } from "@/server/queries";

export const metadata = { title: "Admin · Dados" };
export const dynamic = "force-dynamic";

/** Read-only operator view. Imports run from the CLI (long-running, quota-aware); see docs/operator-guide.md. */
export default async function AdminImport() {
  const user = await requireUser("/admin/import");
  const profile = await getProfile(user.id);
  if (!profile?.is_admin) notFound();
  const { runs, snapshots, leagues } = await withService(async (c) => ({
    runs: (await c.query(`select id, provider, selected_league_ids, status, pages_done, requests_used, jsonb_array_length(errors_json) errors, started_at, completed_at from import_runs order by started_at desc limit 20`)).rows,
    snapshots: (await c.query(`select id, label, source, is_synthetic, status, scoring_version, created_at, data_quality_report from dataset_snapshots order by created_at desc limit 20`)).rows,
    leagues: (await c.query(`select l.provider, l.external_id, l.name, l.country, l.enabled, (select count(*) from source_players p where p.league_id = l.id)::int players from source_leagues l order by l.enabled desc, l.name limit 200`)).rows,
  }));
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8">
        <h1 className="text-3xl font-black">Dados e importação</h1>
        <Card>
          <CardTitle>Como importar (CLI)</CardTitle>
          <pre className="overflow-x-auto rounded-lg bg-bg p-3 text-xs leading-relaxed">{`npm run playerelo:discover -- --anchors      # ligas + âncoras da escala (≈12 pedidos)
npm run playerelo:preview -- --leagues ID1,ID2 --probe
npm run playerelo:import -- --leagues ID1,ID2 --max-requests 150
npm run playerelo:resume -- --run <run-id>
npm run playerelo:audit -- --leagues ID1,ID2
npm run playerelo:finalize -- --leagues ID1,ID2 --label "Época 26/27"`}</pre>
        </Card>
        <Card>
          <CardTitle>Snapshots</CardTitle>
          <ul className="space-y-2 text-sm">
            {snapshots.map((s) => (
              <li key={s.id} className="rounded-lg bg-bg/60 p-2">
                <div className="flex flex-wrap items-center gap-2"><b>{s.label}</b><Badge>{s.status}</Badge>{s.is_synthetic && <Badge tone="warn">fictício</Badge>}<span className="text-xs text-muted">{s.scoring_version} · {new Date(s.created_at).toLocaleString("pt-PT")}</span></div>
                <p className="mt-1 text-xs text-muted">{s.data_quality_report?.clubs_in_snapshot} clubes · {s.data_quality_report?.players_in_snapshot} jogadores · escala: {s.data_quality_report?.reference} · avisos: {(s.data_quality_report?.calibration_warnings ?? []).join(", ") || "—"}</p>
                <p className="mt-1 text-xs text-faint">Histograma OVR: {Object.entries(s.data_quality_report?.ovr_histogram ?? {}).sort().map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Execuções de importação</CardTitle>
          <table className="w-full text-xs"><tbody className="divide-y divide-line">
            {runs.map((r) => <tr key={r.id}><td className="py-1 font-mono">{r.id.slice(0, 8)}</td><td>{r.provider}</td><td>{r.selected_league_ids.join(",")}</td><td><Badge>{r.status}</Badge></td><td>{r.pages_done} pág.</td><td>{r.requests_used} req.</td><td>{r.errors} avisos</td></tr>)}
          </tbody></table>
        </Card>
        <Card>
          <CardTitle>Ligas no catálogo</CardTitle>
          <table className="w-full text-xs"><tbody className="divide-y divide-line">
            {leagues.map((l) => <tr key={`${l.provider}-${l.external_id}`}><td className="py-1">{l.provider}</td><td className="font-mono">{l.external_id}</td><td>{l.name}</td><td>{l.country}</td><td>{l.players} jogadores</td><td>{l.enabled ? "✓" : ""}</td></tr>)}
          </tbody></table>
        </Card>
      </main>
    </>
  );
}
