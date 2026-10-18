import { Crown, Gem, Layers, Shield, Sparkles, Swords, Ticket } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Crest } from "@/components/crest";
import { DuelAccept, DuelReels } from "@/components/slots/fun-ui";
import { SlotMachine } from "@/components/slots/slot-machine";
import { RARITY } from "@/components/slots/rarity";
import { SlotSymbol } from "@/components/slots/symbols";
import { Badge, Card, CardTitle, Empty, cn, eur } from "@/components/ui";
import { DAILY_SPINS, PRIZES, PRIZE_LABEL, SKIN_LABEL, SPIN_COST_CENTS, type Rarity, type Symbol } from "@/engine/slots/slots";
import { activateCardAction, closeDuelAction, createDuelAction, equipSkinAction, setFunSettingsAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getSlotsView } from "@/server/fun-queries";
import { getGame } from "@/server/queries";

export const metadata = { title: "Roleta" };

const CARD: Record<string, { label: string; text: string; icon: React.ReactNode }> = {
  shield: { label: "Escudo", text: "Anula o próximo azar da roleta (automático).", icon: <Shield /> },
  immunity: { label: "Imunidade", text: "As lesões da jornada em que a ativares não contam.", icon: <Sparkles /> },
  gate: { label: "Bilheteira ×2", text: "Se jogares em casa nessa jornada, a bilheteira vem a dobrar.", icon: <Ticket /> },
};

export default async function SlotsPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const clubId: string | null = game.my_club_id ?? null;
  const v = await getSlotsView(user.id, gameId, clubId);
  const settings = (game.settings_json ?? {}) as Record<string, unknown>;
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  const byRarity = (["common", "rare", "epic", "legendary", "bad", "disaster"] as Rarity[]).map((r) => ({
    r, pct: (PRIZES.filter((p) => p.rarity === r).reduce((s, p) => s + p.weight, 0) / total) * 100, items: PRIZES.filter((p) => p.rarity === r),
  }));
  const me = v.me;
  const pot = Number(v.pot?.pot_cents ?? 200_000_000);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-2">Hoje · {DAILY_SPINS} giros por dia · {eur(SPIN_COST_CENTS)} cada</p>
          <h2 className="headline text-4xl sm:text-5xl">Roleta da Liga</h2>
          <p className="mt-2 max-w-xl text-sm text-muted">Dinheiro, emblemas, cartas e até jogadores — ou uma lesão, uma multa, um castigo. 20% de cada giro e todas as multas vão para o jackpot.</p>
        </div>
        {v.pot?.last_winner && <Badge tone="warn"><Crown className="size-3" />Último jackpot: {v.pot.last_winner} · {eur(v.pot.last_won_cents)}</Badge>}
      </header>

      {me ? (
        <SlotMachine gameId={gameId} potCents={pot} spinsLeft={DAILY_SPINS - me.spins_today} freeSpins={me.free_spins} dailySpins={DAILY_SPINS}
          canAfford={Number(me.available) >= SPIN_COST_CENTS} />
      ) : <Empty title="Escolhe um clube para jogar" />}

      <div className="grid gap-5 lg:grid-cols-3">
        {me && (
          <Card>
            <CardTitle icon={<Layers />}>As minhas cartas</CardTitle>
            {me.cards.length === 0 ? <p className="text-sm text-muted">Sem cartas. Saem na roleta.</p> : (
              <ul className="space-y-2">
                {me.cards.map((k) => (
                  <li key={k.id} className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-ink [&_svg]:size-[18px]">{CARD[k.kind]?.icon}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{CARD[k.kind]?.label ?? k.kind}{k.status === "active" && <Badge tone="accent" className="ml-2">Ativa J{k.active_round}</Badge>}</p>
                      <p className="text-xs text-muted">{CARD[k.kind]?.text}</p>
                      {k.status === "held" && k.kind !== "shield" && game.status === "active" && (
                        <ActionForm action={activateCardAction} hidden={{ gameId, cardId: k.id }} submitLabel={`Usar na J${game.current_matchday + 1}`} variant="secondary" inline className="mt-2" submitClassName="min-h-8 px-3 text-xs" />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {me && (
          <Card>
            <CardTitle icon={<Gem />}>Coleção de emblemas</CardTitle>
            <div className="grid grid-cols-3 gap-2">
              {[null, ...me.skins].map((s) => {
                const on = (me.crest_skin ?? null) === s;
                return (
                  <div key={s ?? "base"} className={cn("flex flex-col items-center gap-1 rounded-xl border p-2", on ? "border-accent bg-accent/10" : "border-line")}>
                    <Crest id={clubId!} name={me.name} short={me.short_name} color={me.primary_color} color2={me.secondary_color} skin={s} size={52} />
                    <span className="text-center text-[11px] font-semibold leading-tight">{s ? SKIN_LABEL[s] ?? s : "Original"}</span>
                    {on ? <span className="text-[10px] font-bold uppercase text-accent">Em uso</span>
                      : <ActionForm action={equipSkinAction} hidden={{ gameId, skin: s ?? "" }} submitLabel="Usar" variant="ghost" inline className="justify-center" submitClassName="min-h-7 px-2 text-[11px]" />}
                  </div>
                );
              })}
            </div>
            {me.skins.length === 0 && <p className="mt-3 text-xs text-muted">Emblemas raros, épicos e lendários saem na roleta. Os amigos vêem-nos na tabela.</p>}
          </Card>
        )}

        <Card>
          <CardTitle icon={<Swords />}>Duelos (€500 000)</CardTitle>
          {me && v.rivals.length > 0 && (
            <ActionForm action={createDuelAction} hidden={{ gameId }} submitLabel="Desafiar" inline submitClassName="min-h-10" className="mb-4">
              <select name="clubId" aria-label="Adversário" className="min-h-10 flex-1 rounded-[10px] border border-line-strong bg-bg/80 px-3 text-sm">
                {v.rivals.map((r) => <option key={r.id} value={r.id}>{r.manager} ({r.name})</option>)}
              </select>
            </ActionForm>
          )}
          {v.duels.length === 0 ? <p className="text-sm text-muted">Desafia um amigo: os dois giram e quem fizer mais pontos leva €500 000 do outro.</p> : (
            <ul className="space-y-3">
              {v.duels.map((d) => {
                const iAmOpp = clubId === d.opponent_club_id, iAmCh = clubId === d.challenger_club_id;
                return (
                  <li key={d.id} className="rounded-xl border border-line p-3">
                    <p className="text-sm font-semibold">{d.challenger} <span className="text-muted">vs</span> {d.opponent}</p>
                    {d.status === "open" ? (
                      iAmOpp ? <div className="mt-2 space-y-2"><DuelAccept gameId={gameId} duelId={d.id} me={d.opponent} them={d.challenger} />
                        <ActionForm action={closeDuelAction} hidden={{ gameId, duelId: d.id }} submitLabel="Recusar" variant="ghost" inline submitClassName="min-h-8 px-2 text-xs" /></div>
                      : iAmCh ? <ActionForm action={closeDuelAction} hidden={{ gameId, duelId: d.id }} submitLabel="Cancelar desafio" variant="ghost" inline className="mt-1" submitClassName="min-h-8 px-2 text-xs" />
                      : <p className="text-xs text-muted">À espera de resposta.</p>
                    ) : d.status === "done" && d.challenger_reels && d.opponent_reels ? (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <DuelReels reels={d.challenger_reels as Symbol[]} score={d.challenger_score ?? 0} label={d.challenger} win={d.winner_club_id ? d.winner_club_id === d.challenger_club_id : null} />
                        <DuelReels reels={d.opponent_reels as Symbol[]} score={d.opponent_score ?? 0} label={d.opponent} win={d.winner_club_id ? d.winner_club_id === d.opponent_club_id : null} />
                      </div>
                    ) : <p className="text-xs text-muted">{d.status === "declined" ? "Recusado." : d.status === "cancelled" ? "Cancelado." : d.status}</p>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardTitle>Últimos giros da liga</CardTitle>
          {v.feed.length === 0 ? <p className="text-sm text-muted">Ninguém girou ainda. Sê o primeiro.</p> : (
            <ul className="divide-y divide-line">
              {v.feed.map((s) => {
                const r = RARITY[s.rarity as Rarity];
                return (
                  <li key={s.id} className="flex items-center gap-3 py-2.5">
                    <span className="flex shrink-0 gap-0.5">{(s.reels as Symbol[]).map((x, i) => <SlotSymbol key={i} s={x} size={22} />)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm"><b>{s.club}</b> · {s.label}</p>
                      {s.payload?.detail && <p className="truncate text-xs text-muted">{s.payload.detail}</p>}
                    </div>
                    <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider" style={{ background: r.bg, color: r.ink }}>{r.label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardTitle>Probabilidades</CardTitle>
            <ul className="space-y-2 text-sm">
              {byRarity.filter((x) => x.items.length).map((x) => (
                <li key={x.r}>
                  <div className="flex items-center justify-between">
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider" style={{ background: RARITY[x.r].bg, color: RARITY[x.r].ink }}>{RARITY[x.r].label}</span>
                    <span className="font-bold tabular">{x.pct.toFixed(1)}%</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{x.items.map((p) => PRIZE_LABEL[p.kind]).join(" · ")}</p>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">
              {settings.slots_negatives === false ? "Nesta liga os azares estão desligados (saem trocos)." : settings.slots_point_penalty === true ? "O castigo de −1 ponto está ligado nesta liga." : "O castigo de −1 ponto está desligado: em vez dele sai uma multa."}
              {" "}Só dinheiro do jogo — nunca dinheiro real.
            </p>
          </Card>

          {game.is_owner && (
            <Card>
              <CardTitle>Regras da liga (dono)</CardTitle>
              <ActionForm action={setFunSettingsAction} hidden={{ gameId }} submitLabel="Guardar" variant="secondary" submitClassName="w-full">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="negatives" defaultChecked={settings.slots_negatives !== false} />Azares na roleta (lesões, multas, amuos)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="pointPenalty" defaultChecked={settings.slots_point_penalty === true} />Castigo de −1 ponto (0,5%)</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="betting" defaultChecked={settings.betting !== false} />Apostas nos jogos</label>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
