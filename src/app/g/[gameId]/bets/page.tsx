import { Dices, Trophy } from "lucide-react";
import { Crest } from "@/components/crest";
import { BetSlip } from "@/components/slots/fun-ui";
import { Badge, Card, CardTitle, Empty, cn, eur } from "@/components/ui";
import { odds } from "@/engine/betting/odds";
import { requireUser } from "@/server/auth";
import { getBetsView } from "@/server/fun-queries";
import { getFinances, getGame } from "@/server/queries";

export const metadata = { title: "Apostas" };

const PICK: Record<string, string> = { "1": "Casa", X: "Empate", "2": "Fora" };
const ST: Record<string, { t: string; tone: "info" | "accent" | "default" | "danger" }> = {
  open: { t: "Em jogo", tone: "info" }, won: { t: "Ganha", tone: "accent" }, lost: { t: "Perdida", tone: "danger" }, void: { t: "Anulada", tone: "default" },
};

export default async function BetsPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const clubId: string | null = game.my_club_id ?? null;
  const [v, fin] = await Promise.all([getBetsView(user.id, gameId), clubId ? getFinances(user.id, clubId) : null]);
  const available = fin ? Number(fin.club?.cash_cents ?? 0) - Number(fin.club?.reserved_cents ?? 0) : 0;
  const enabled = v.game.settings?.betting !== false;
  const poolBy = new Map<string, { n: number; stake: number }>();
  for (const p of v.pool) poolBy.set(`${p.fixture_id}:${p.pick}`, { n: p.n, stake: Number(p.stake) });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">Jogo · Jornada {v.game.round + 1}</p>
          <h2 className="headline text-4xl sm:text-5xl">Apostas</h2>
          <p className="mt-2 max-w-xl text-sm text-muted">Aposta o que quiseres em qualquer jogo da próxima jornada — menos no teu. Odds pela força das equipas; o prémio cai na conta depois da jornada. Só dinheiro do jogo.</p>
        </div>
        {clubId && <div className="rounded-xl border border-line bg-surface px-4 py-2"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Disponível</p><p className="font-display text-2xl font-black tabular">{eur(available)}</p></div>}
      </header>

      {!enabled ? <Empty title="Apostas desligadas" icon={<Dices />}>O dono da liga desligou as apostas.</Empty> : v.game.status !== "active" ? (
        <Empty title="A liga ainda não começou" icon={<Dices />} />
      ) : v.fixtures.length === 0 ? <Empty title="Sem jogos para apostar" icon={<Dices />}>A próxima jornada ainda não tem jogos marcados.</Empty> : (
        <div className="grid gap-4 md:grid-cols-2">
          {v.fixtures.map((f) => {
            const o = odds(Number(f.hs), Number(f.as));
            const own = clubId === f.home_id || clubId === f.away_id;
            const crowd = (["1", "X", "2"] as const).map((k) => poolBy.get(`${f.id}:${k}`)).filter(Boolean);
            return (
              <Card key={f.id} className="space-y-4">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="flex min-w-0 flex-col items-center gap-1 text-center">
                    <Crest id={f.home_id} name={f.home} short={f.home_short} color={f.home_color} color2={f.home_color2} skin={f.home_skin} size={44} />
                    <p className="w-full truncate font-display text-lg font-black uppercase leading-tight">{f.home}</p>
                    {f.home_mgr && <p className="text-[11px] text-muted">{f.home_mgr}</p>}
                  </div>
                  <span className="font-display text-xl font-black text-muted">vs</span>
                  <div className="flex min-w-0 flex-col items-center gap-1 text-center">
                    <Crest id={f.away_id} name={f.away} short={f.away_short} color={f.away_color} color2={f.away_color2} skin={f.away_skin} size={44} />
                    <p className="w-full truncate font-display text-lg font-black uppercase leading-tight">{f.away}</p>
                    {f.away_mgr && <p className="text-[11px] text-muted">{f.away_mgr}</p>}
                  </div>
                </div>
                {clubId ? (
                  <BetSlip gameId={gameId} fixtureId={f.id} odds={o} home={f.home} away={f.away} availableCents={available} disabled={own ? "É o teu jogo — não podes apostar." : undefined} />
                ) : <p className="text-sm text-muted">Escolhe um clube para apostar.</p>}
                {crowd.length > 0 && (
                  <p className="text-xs text-muted">Apostado: {(["1", "X", "2"] as const).map((k) => { const p = poolBy.get(`${f.id}:${k}`); return p ? `${PICK[k]} ${eur(p.stake)} (${p.n})` : null; }).filter(Boolean).join(" · ")}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardTitle icon={<Dices />}>As minhas apostas</CardTitle>
          {v.mine.length === 0 ? <p className="text-sm text-muted">Ainda não apostaste.</p> : (
            <ul className="divide-y divide-line">
              {v.mine.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{b.home} {b.hg !== null ? `${b.hg}–${b.ag}` : "–"} {b.away} <span className="text-xs text-muted">· J{b.round}</span></p>
                    <p className="text-xs text-muted">{PICK[b.pick]} a <b className="tabular">{Number(b.odds).toFixed(2)}</b> · aposta {eur(b.stake_cents)}</p>
                  </div>
                  <span className={cn("font-display text-lg font-black tabular", b.status === "won" ? "text-up" : b.status === "lost" ? "text-down" : "text-ink")}>
                    {b.status === "won" ? `+${eur(b.payout_cents)}` : b.status === "lost" ? `−${eur(b.stake_cents)}` : eur(Math.round(Number(b.stake_cents) * Number(b.odds)))}
                  </span>
                  <Badge tone={ST[b.status].tone}>{ST[b.status].t}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle icon={<Trophy />}>Tabela dos apostadores</CardTitle>
          {v.board.length === 0 ? <p className="text-sm text-muted">Sem apostas resolvidas.</p> : (
            <ol className="space-y-2">
              {v.board.map((r, i) => {
                const profit = Number(r.returned) - Number(r.staked ?? 0);
                return (
                  <li key={r.manager + r.club} className="flex items-center gap-3 text-sm">
                    <span className="w-5 font-display font-black tabular">{i + 1}</span>
                    <div className="min-w-0 flex-1"><p className="truncate font-semibold">{r.manager}</p><p className="truncate text-xs text-muted">{r.club} · {r.bets} apostas</p></div>
                    <span className={cn("font-display text-lg font-black tabular", profit >= 0 ? "text-up" : "text-down")}>{profit >= 0 ? "+" : "−"}{eur(Math.abs(profit))}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
