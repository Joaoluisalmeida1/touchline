import "server-only";
import { withUser } from "./db";

/**
 * "Hoje" drawer: everything that is waiting for the manager's answer, newest deadline first. One round-trip, read
 * as the user (RLS), so it only ever lists the caller's own club's items.
 */
export type TodayKind = "inbox" | "press" | "sponsor" | "contract" | "offer_in" | "counter" | "academy";

export interface TodayItem {
  kind: TodayKind;
  id: string;
  title: string;
  detail: string;
  href: string;
  /** league round by which it must be answered (null = no hard deadline) */
  dueRound: number | null;
}

interface Row { kind: TodayKind; id: string; title: string; detail: string | null; due_round: number | null }

export async function getTodayItems(userId: string, gameId: string, clubId: string): Promise<TodayItem[]> {
  const base = `/g/${gameId}`;
  const rows = await withUser(userId, async (c) => (await c.query<Row>(
    `with g as (select current_season s, current_matchday m from games where id = $1)
     select 'inbox' kind, e.id::text id, e.title, e.body detail, e.deadline_round due_round
       from inbox_events e where e.club_id = $2 and e.resolved_at is null
     union all
     select 'press', p.id::text, 'Conferência de imprensa', 'Antes da jornada ' || p.round, p.round
       from press_conferences p, g where p.club_id = $2 and p.answered_at is null and p.season = g.s and p.round = g.m + 1
     union all
     select 'sponsor', min(o.id::text),
            case when count(*) = 1 then 'Proposta de patrocínio: ' || min(o.brand) else count(*) || ' propostas de patrocínio' end,
            'Até €' || round(max(o.base_cents) / 100000.0) || 'k por época', min(o.deadline_round)
       from sponsor_offers o, g where o.club_id = $2 and o.status = 'open' and o.season = g.s
     having count(*) > 0
     union all
     select 'contract', min(t.id::text),
            case when count(*) = 1 then 'Renovação: ' || min(p.name_snapshot) else count(*) || ' contratos a terminar' end,
            'Último ano de contrato: ' || string_agg(p.name_snapshot, ', ' order by p.current_ovr desc), null
       from contract_talks t join game_players p on p.id = t.player_id, g
      where t.club_id = $2 and t.status = 'open' and t.season = g.s and p.club_id = $2
     having count(*) > 0
     union all
     select 'offer_in', o.id::text, 'Proposta por ' || p.name_snapshot, 'De ' || b.name_snapshot || ' · €' || round(o.amount_cents / 100000.0) || 'k', null
       from transfer_offers o join game_players p on p.id = o.player_id join game_clubs b on b.id = o.buyer_club_id
      where o.seller_club_id = $2 and o.status = 'pending' and o.expires_at > now()
     union all
     select 'counter', o.id::text, 'Contraproposta por ' || p.name_snapshot, s.name_snapshot || ' pede €' || round(coalesce(o.counter_amount_cents, o.amount_cents) / 100000.0) || 'k', null
       from transfer_offers o join game_players p on p.id = o.player_id join game_clubs s on s.id = o.seller_club_id
      where o.buyer_club_id = $2 and o.status = 'countered'
     union all
     select 'academy', min(x.id::text), 'Formação: ' || count(*) || (case when count(*) = 1 then ' jovem à espera' else ' jovens à espera' end), 'Promover ou dispensar', null
       from academy_prospects x, g where x.club_id = $2 and x.status = 'academy' and x.season = g.s
     having count(*) > 0`,
    [gameId, clubId])).rows);

  const href: Record<TodayKind, string> = {
    inbox: `${base}/week?tab=gabinete`, press: `${base}/week?tab=imprensa`, sponsor: `${base}/club?tab=patrocinios`,
    contract: `${base}/club?tab=contratos`, offer_in: `${base}/market`, counter: `${base}/market`, academy: `${base}/club?tab=formacao`,
  };
  return rows
    .map((r) => ({ kind: r.kind, id: r.id, title: r.title, detail: r.detail ?? "", href: href[r.kind], dueRound: r.due_round }))
    .sort((a, b) => (a.dueRound ?? 1e9) - (b.dueRound ?? 1e9));
}
