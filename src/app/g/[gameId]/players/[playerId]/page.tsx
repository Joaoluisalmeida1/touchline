import { notFound } from "next/navigation";
import { TRAIT_INFO, traitOf } from "@/engine/narrative/traits";
import Link from "next/link";
import { CircleCheck, FileSignature, History, LineChart, Tag } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { Crest } from "@/components/crest";
import { Reveal } from "@/components/fx/motion";
import { Badge, Card, CardTitle, Field, FormArrow, Meter, OvrBadge, POS_LABEL, PosPill, Stat, cn, eur, inputCls } from "@/components/ui";
import { OfferForm } from "@/components/offer-form";
import { OvrChart } from "@/components/ovr-chart";
import { PlayerAvatar } from "@/components/squad/avatar";
import { listPlayerAction, unlistPlayerAction } from "@/server/actions";
import { requireUser } from "@/server/auth";
import { getGame, getPlayer } from "@/server/queries";

const GROUP_NAME: Record<string, string> = { GK: "Guarda-redes", DEF: "Defesa", MID: "Médio", ATT: "Avançado" };

export default async function PlayerPage({ params, searchParams }: { params: Promise<{ gameId: string; playerId: string }>; searchParams: Promise<{ toast?: string }> }) {
  const { gameId, playerId } = await params;
  const { toast } = await searchParams;
  const user = await requireUser();
  const game = (await getGame(user.id, gameId))!;
  const data = await getPlayer(user.id, gameId, playerId);
  if (!data) notFound();
  const { player: p, log, matches, askingPrice, transfers } = data;
  const mine = p.club_id === game.my_club_id;
  const st = p.season_stats_json ?? {};
  const points = [{ label: "Início", ovr: p.initial_ovr }, ...log.map((l) => ({ label: `E${l.season_number} J${l.round_number}`, ovr: l.new_ovr }))];
  const color = p.club_color ?? "#3b4450", color2 = p.club_color2 ?? "#ffffff";
  const delta = p.current_ovr - p.season_start_ovr;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      {toast === "signed" && mine && (
        <p role="status" className="flex items-center gap-2 rounded-2xl border border-accent/40 bg-accent/10 p-3 text-sm font-semibold text-accent lg:col-span-2">
          <CircleCheck className="size-4" />Proposta aceite! {p.name_snapshot} já é jogador do teu clube.
        </p>
      )}
      <div className="min-w-0 space-y-5">
        <Reveal>
          <section className="surface relative overflow-hidden rounded-[var(--radius-card)]">
            <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(600px 260px at 0% 0%, ${color}55, transparent 70%)` }} />
            <div aria-hidden className="pitch-grid pointer-events-none absolute inset-0" />
            <div className="relative flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-7">
              <div className="relative shrink-0 self-center">
                <PlayerAvatar id={p.id} primary={color} secondary={color2} size={112} className="ring-4 ring-bg" />
                <OvrBadge ovr={p.current_ovr} size="lg" className="absolute -bottom-2 -right-3" />
              </div>
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                  <PosPill group={p.position_group} label={POS_LABEL[p.position_group]} />
                  <span className="text-xs font-semibold text-muted">{GROUP_NAME[p.position_group]}{p.position_detail ? ` · ${p.position_detail}` : ""}</span>
                </div>
                <h2 className="headline mt-2 text-4xl sm:text-5xl">{p.name_snapshot}</h2>
                <p className="mt-2 flex items-center justify-center gap-2 text-sm text-muted sm:justify-start">
                  {p.club_id && <Crest id={p.club_id} name={p.club_name ?? ""} short={p.club_short} color={p.club_color} color2={p.club_color2} size={20} />}
                  {p.club_name ?? "Sem clube"} · {p.age ? `${p.age} anos` : "idade não verificada"}
                </p>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5 sm:justify-start">
                  <Badge tone="info">Potencial {p.potential_band}</Badge>
                  <span title={TRAIT_INFO[traitOf(p.id)].hint}><Badge>{TRAIT_INFO[traitOf(p.id)].label}</Badge></span>
                  {p.injured_matches > 0 && <Badge tone="danger">Lesionado ({p.injury_type}) · {p.injured_matches} jogos</Badge>}
                  {p.suspension_matches > 0 && <Badge tone="warn">Suspenso · {p.suspension_matches}</Badge>}
                  {p.listed_price && <Badge tone="accent">À venda</Badge>}
                </div>
              </div>
            </div>
            <div className="relative grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
              {[
                ["OVR na época", <span key="o" className="font-display text-2xl font-extrabold tabular">{p.season_start_ovr} → {p.current_ovr}{delta !== 0 && <span className={cn("ml-1 text-sm", delta > 0 ? "text-accent" : "text-danger")}>{delta > 0 ? `+${delta}` : delta}</span>}</span>],
                ["Forma recente", <span key="f" className="flex items-center gap-2"><FormArrow form={Number(p.form)} /><span className="font-display text-xl font-bold tabular text-muted">{Number(p.form).toFixed(2)}</span></span>],
                ["Condição física", <Meter key="c" value={p.fitness} label="Condição física" />],
                ["Moral", <Meter key="m" value={p.morale} label="Moral" tone="bg-info" />],
              ].map(([k, v]) => (
                <div key={k as string} className="bg-surface px-4 py-3"><p className="mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-faint">{k}</p>{v}</div>
              ))}
            </div>
          </section>
        </Reveal>
        <p className="-mt-2 px-1 text-xs text-faint">A forma e a condição afetam o rendimento imediato (limitado a ±3%). O OVR é a capacidade estrutural e só muda em pontos de avaliação a cada 4 jornadas.</p>

        <Card>
          <CardTitle icon={<LineChart />}>Evolução do OVR</CardTitle>
          <OvrChart points={points} />
          {log.length === 0 ? <p className="mt-3 text-sm text-muted">Sem alterações de OVR desde o início.</p> : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {log.slice().reverse().map((l, i) => (
                <li key={i} className="flex gap-3"><span className="w-20 shrink-0 font-display text-sm font-bold text-faint">E{l.season_number} · J{l.round_number}</span><span className={cn("font-bold tabular", l.new_ovr > l.old_ovr ? "text-accent" : "text-danger")}>{l.new_ovr > l.old_ovr ? "▲" : "▼"}</span><span className="text-muted">{String((l.change_reason_json as { text?: string }).text ?? `${l.old_ovr} → ${l.new_ovr}`)}</span></li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle icon={<History />}>Últimos jogos</CardTitle>
          {matches.length === 0 ? <p className="text-sm text-muted">Ainda não jogou.</p> : (
            <ul className="space-y-1.5 text-sm">
              {matches.map((m) => (
                <li key={m.fixture_id}>
                  <Link href={`/g/${gameId}/matches/${m.fixture_id}`} className="flex items-center gap-3 rounded-xl border border-line bg-bg/40 px-3 py-2 transition hover:border-line-strong">
                    <span className="w-8 font-display text-sm font-bold text-faint">J{m.round_number}</span>
                    <span className="flex-1 truncate font-semibold">{m.home_short} <span className="font-display tabular">{m.result_home}–{m.result_away}</span> {m.away_short}</span>
                    <span className="text-xs text-muted tabular">{m.minutes}&apos;</span>
                    <span className="w-12 text-xs font-semibold tabular">{m.goals ? `${m.goals}G ` : ""}{m.assists ? `${m.assists}A ` : ""}{m.cards_yellow ? "🟨" : ""}{m.cards_red ? "🟥" : ""}</span>
                    <span className="w-10 rounded-md bg-surface-3 py-0.5 text-center font-display font-bold tabular">{m.rating ?? "—"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="space-y-5">
        <Card>
          <CardTitle>Época</CardTitle>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Jogos", st.apps ?? 0], ["Golos", st.goals ?? 0], ["Assist.", st.assists ?? 0], ["Minutos", st.minutes ?? 0], ["Nota", st.rated ? ((st.rating_sum ?? 0) / st.rated).toFixed(2) : "—"]].map(([k, v]) => (
              <Stat key={String(k)} label={k} className="p-2.5 [&_p:nth-child(2)]:text-2xl">{v}</Stat>
            ))}
          </div>
        </Card>
        <Card>
          <CardTitle icon={<FileSignature />}>Contrato e mercado</CardTitle>
          <dl className="divide-y divide-line/70 text-sm">
            <div className="flex justify-between py-2"><dt className="text-muted">Valor de mercado (jogo)</dt><dd className="font-display text-lg font-bold tabular">{eur(p.market_value_cents)}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-muted">Salário semanal</dt><dd className="font-semibold tabular">{eur(p.wage_cents)}</dd></div>
            <div className="flex justify-between py-2"><dt className="text-muted">Contrato até</dt><dd className="font-semibold">Época {p.contract_end_season}</dd></div>
            {p.listed_price && <div className="flex justify-between py-2"><dt className="flex items-center gap-1 text-muted"><Tag className="size-3.5" />À venda por</dt><dd className="font-display text-lg font-bold text-accent tabular">{eur(p.listed_price)}</dd></div>}
          </dl>
          <div className="mt-4">
            {mine ? (
              p.listed_price ? (
                <ActionForm action={unlistPlayerAction} hidden={{ gameId, playerId: p.id }} submitLabel="Retirar do mercado" variant="secondary" submitClassName="w-full" />
              ) : (
                <ActionForm action={listPlayerAction} hidden={{ gameId, playerId: p.id }} submitLabel="Colocar à venda" variant="secondary" submitClassName="w-full">
                  <Field label="Preço pedido (€)"><input name="askingEur" inputMode="numeric" defaultValue={Math.round(Number(p.market_value_cents) / 100 * 1.2)} className={inputCls} /></Field>
                </ActionForm>
              )
            ) : game.my_club_id && p.club_id ? (
              <OfferForm gameId={gameId} playerId={p.id} suggestedEur={Math.round(Number(askingPrice ?? p.market_value_cents) / 100)} aiClub={!p.manager_user_id} />
            ) : null}
          </div>
        </Card>
        {transfers.length > 0 && (
          <Card>
            <CardTitle>Transferências nesta liga</CardTitle>
            <ul className="space-y-1.5 text-sm">{transfers.map((t, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate text-muted">{t.from_name} → {t.to_name}</span><span className="font-display font-bold tabular">{eur(t.price_cents)}</span></li>)}</ul>
          </Card>
        )}
      </div>
    </div>
  );
}
