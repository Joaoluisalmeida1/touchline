# Arquitetura

```
Browser ──(Server Actions / RSC, cookies Supabase)──► Next.js na Vercel
                                                       │  getUser() → Supabase Auth (valida JWT)
                                                       │
                                     withUser(uid) ────┼──► Postgres (Supabase)  role=authenticated + claims → RLS
                                     withService() ────┘                           owner → só código servidor confiável
CLI (tsx) ── PlayerElo API ──► catálogo (source_*) ──► dataset_snapshots (initial-rating-v1)
Vercel Cron (1×/dia) ──► /api/cron/process ──► processNextMatchday (lease + idempotência)
```

## Pastas

| Pasta | Conteúdo |
|---|---|
| `supabase/migrations` | Schema, RLS, comandos SQL (`0001`–`0012`) |
| `supabase/seed.sql` | Catálogo + snapshot **fictícios** para dev |
| `supabase/local/00_supabase_shim.sql` | Só testes: papéis + `auth.uid()` num Postgres simples |
| `src/engine/common` | RNG determinístico (xmur3+sfc32), hash canónico, tipos |
| `src/engine/match` | Motor por posses (`simulateMatch`), config de calibração |
| `src/engine/rating` | `initial-rating-v1`: Elo → OVR, potencial, valor |
| `src/engine/progression` | Forma, fitness, moral, lesões, castigos, XP, checkpoints |
| `src/engine/economy` | Salários, receitas, prémios, revalorização |
| `src/engine/lineup` | Formações, adequação posicional, auto-escalação e correção |
| `src/engine/league` | Orquestração pura de uma jornada / época + simulador offline |
| `src/engine/narrative` | `narrative-v1`: factos de uma jornada → notícias d'O Apito, prémios da jornada, factos para o registo de eventos (puro, determinístico) |
| `src/integrations/playerelo` | Cliente HTTP (rate-limit, retries), esquemas Zod tolerantes, importador |
| `src/integrations/catalog` | Construção de snapshots, gerador sintético |
| `src/server` | `pg.ts` (impersonação), `queries.ts`, `league-queries.ts` (jornal, história, rivalidades), `actions/`, `services/` (criar liga, processar jornada, mercado externo, jornal, push) |
| `src/app` | Rotas (pt-PT) |
| `scripts/` | CLI PlayerElo, seed, calibração, reset local |
| `tests/` | integração (Postgres real), E2E (Playwright) |

## Fluxo de uma jornada (exactly-once)

1. `begin_matchday(game)` — `SELECT … FOR UPDATE` no jogo; adquire *lease* (240 s); fixa `processing_round`; escalações e mercado ficam bloqueados enquanto a lease está ativa.
2. `ensureBusiness` (preparação da época, idempotente) e `resolveSponsorDefaults` (espaços de patrocínio sem escolha assinam a proposta fixa). `resolve_due_events(game, round)` aplica a opção por omissão dos assuntos do Gabinete que expiram nesta jornada. TS carrega o estado (clubes, táticas, escalação guardada, plano de treino, plano de jogo, conferência de imprensa respondida, jogadores) e chama `processRound`: corrige escalações inválidas de forma determinística, simula cada jogo com `seed = game|época|jornada|fixture`, calcula `input_hash`, progressão e ledger.
3. `finalize_fixture(fixture, payload)` por jogo — lock da fixture; se já `completed` devolve `already_completed` sem efeitos. Valida golos vs eventos e lease. Grava run, eventos, stats, escalação usada, tabela, jogadores (com verificação de `version`), log de progressão e ledger (chaves idempotentes).
4. `complete_matchday(game, round, payload)` — exige todos os jogos concluídos; aplica estado dos clubes com folga, salários/patrocínios, expira propostas; avança `current_matchday`; liberta a lease.
5. Etapas pós-jogo (não fatais — uma falha é registada e a jornada fica processada):
   - `publishRound` (`services/newspaper.ts`): carrega os factos da jornada, corre `buildEdition` e grava `news_items`, `round_awards` e `game_events` com `on conflict do nothing` (idempotente). A página do jornal faz *back-fill* de jornadas sem edição (`ensureEditions`).
   - `afterRound` (`services/business.ts`): humor dos adeptos e confiança da direção (avisos, cortes/reforços de orçamento), uma vez por jornada (marca `business_round`).
   - `playDueCupRounds` (`services/cup.ts`) joga a(s) ronda(s) da taça marcadas para depois desta jornada; `academyAfterRound` e `aiSignFreeAgents` (`services/career.ts`) tratam da academia e dos jogadores livres.
   - `afterRoundSocial` (`services/social.ts`): manchete da jornada no mural e avaliação de conquistas (marca `social_round`).
   - `prepareWeek` (`services/week.ts`): prepara a jornada seguinte — conferências de imprensa dos clubes humanos e assuntos do Gabinete para todos os clubes — uma só vez (marca `week_prepared`).
   - `flushPush` (`services/push.ts`): envia notificações ainda não enviadas por Web Push (no-op sem chaves VAPID) e marca `pushed_at`.
6. Última jornada → `seasonEndCareer` (saídas em fim de contrato) → `end_season`: prémios, rollover de jogadores, nova época e calendário.

Falha a meio: a lease é libertada, `processing_round` mantém-se; a próxima chamada retoma a mesma jornada e salta jogos já concluídos (`alreadyPlayedClubIds`).

## Registo de eventos e jornal

- `game_events`: factos append-only por (liga, época, jornada, tipo, chave) — resultados, dérbis entre treinadores, surpresas, goleadas, hat-tricks, reviravoltas, golos tardios, expulsões, novo líder, jogador/equipa da jornada. É a base para história, conquistas e rumores nas fases seguintes.
- `news_items`: uma edição por jornada, histórias ordenadas por "drama" (clubes humanos pesam +15). `round_awards`: equipa (4-3-3), jogador e golo (menor xG) da jornada.
- Tudo é escrito pelo servidor; membros só leem (RLS `is_game_member`). Mesma jornada ⇒ mesma edição (RNG `game|época|jornada|news|narrative-v1`).
- `push_subscriptions`: subscrições Web Push por dispositivo, sem grants para clientes (geridas por Server Actions).

## Semana de jornada (fase 2)

- Tabelas: `training_plans`, `match_plans` (regras + marcação), `press_conferences`, `inbox_events`. Planos e Gabinete só são legíveis pelo próprio clube; a conferência fica pública para a liga depois de respondida.
- Comandos do utilizador (SECURITY DEFINER, `auth.uid()`): `save_training_plan`, `save_match_plan`, `answer_press`, `answer_inbox_event`. O cliente só escolhe entre opções guardadas pelo servidor; os efeitos são aplicados por `_apply_effects` (interno, limitado, só `service_role`).
- Motor: `MatchTeamInput` ganhou `modifiers` (controlo/ataque/defesa — treino + imprensa), `marking` e `plans`, todos opcionais; sem eles o resultado é bit a bit igual (hash *golden* inalterado).
- Conteúdo como dados, versionado: `events-v1`, `press-v1`, `traits-v1`, `training-v1`.

## Negócio do clube (fase 3)

- Tabelas: `club_business` (humor, preço, lotação base, obras), `club_staff` + `staff_candidates`, `sponsor_offers` + `sponsor_deals`, `board_state` (objetivo, confiança, orçamentos, histórico). Estádio, staff e contratos assinados são públicos na liga; propostas, candidatos e direção só para o próprio clube.
- Comandos: `set_ticket_price`, `start_upgrade`, `hire_staff`, `sign_sponsor`, `set_budget_shift`. `_apply_effects` ganhou `confidence`, `fan_mood`, `ticket_price`. Novos tipos no ledger: `staff_wages`, `infrastructure`.
- Motor: `LeagueClub` ganhou `stadium`, `sponsors` e `staff` opcionais. Sem eles (ligas antigas antes da preparação, simulações offline) tudo funciona como economy-v1 e os testes *golden* não mudam. A assistência fica em `match_runs.result_json.attendance`. As cláusulas de fim de época entram no ledger de `end_season`.

## Rivais e balneário (fase 4a)

- `transfer_offers` ganhou `parent_offer_id` (negociação), `swap_player_id`, `message`, `counter_message` e o estado `countered`; o valor pode ser 0 quando há troca. `_execute_transfer` move os dois jogadores, anula propostas pendentes sobre ambos e publica no mural.
- Tabelas: `wall_posts` (com `dedupe_key` para publicações automáticas idempotentes), `wall_reactions`, `achievements` (única por liga/treinador/conquista). Só leitura para membros; escrita apenas por comandos (`post_wall`, `react_wall`, `delete_wall_post`) ou pelo servidor.

## Taças e carreira (fase 4b)

- Tabelas: `cup_ties` (quadro, resultados, penáltis, eventos resumidos), `academy_prospects`, `contract_talks`; colunas `game_players.free_agent_since` e `free_agent_wage_cents` (com GRANT de coluna para membros).
- Comandos: `promote_prospect`, `release_prospect`, `renew_contract`, `sign_free_agent`. Quadro, jovens e exigências salariais são gerados pelo servidor (TS determinístico) e guardados.
- Motor: `buildMatchInput` (extraído de `processRound`) é partilhado entre liga e taça; `src/engine/cup` e `src/engine/career` são puros e testados.

## Mercado (market-v2)

- Motor puro `src/engine/market/market.ts` (preços, descida, escolha de novos jogadores, compras da IA). Serviço `src/server/services/market.ts`: `marketTick` (idempotente por época/jornada; chamado em `processNextMatchday` antes e depois da jornada, no fim da época e ao abrir o Mercado) e `buyListing` → `buy_listing_tx`. A IA compra através de `_market_ai_buy`, que reutiliza `_execute_transfer` (livro-razão, plantel mínimo/máximo, mural, notificações).
- `transfer_listings` ganhou origem (`manager`/`ai`/`external`), preços inicial/mínimo, jornadas por vender, comprador e preço de venda (migração 0018).

## Interface v2 (fundação)

- `src/app/g/[gameId]/layout.tsx` carrega o jogo, as cores do clube, `getTodayItems` (decisões pendentes, RLS) e o plantel leve, e entrega tudo ao `GameShell` (cliente): barra lateral, barra de contexto com sub-separadores do hub, prazo, ⌘K e gaveta "Por decidir"; doca de 5 hubs no telemóvel.
- Temas por variáveis CSS (`data-theme` em `<html>`), definidos antes do primeiro paint por `src/lib/prefs.ts`. Detalhes em `docs/design-system.md`.

## Segurança

- RLS em todas as tabelas `public` (teste automático). Leituras por membership (`is_game_member`), dados privados por clube (táticas, escalação atual, ledger, propostas) e notificações por utilizador.
- Nenhum `INSERT/UPDATE/DELETE` concedido a `anon`/`authenticated` (exceto `profiles.display_name/avatar_settings`) — testado.
- `potential_cap` e `hidden_development_rate` sem `GRANT` de coluna.
- Funções: `EXECUTE` revogado de `PUBLIC`/`anon`; allow-list explícita para `authenticated`; comandos de servidor só para owner/`service_role` — testado.
- Segredos só no servidor (`PLAYERELO_API_KEY`, `SUPABASE_DB_URL`, `CRON_SECRET`); nenhum com prefixo `NEXT_PUBLIC_`. Server Actions são POST com verificação de Origin (CSRF).
- Não-membros recebem 404 nas páginas de liga (sem enumeração).

## Observabilidade

Logs JSON estruturados (`matchday.begin`, `fixture.finalized`, `matchday.complete`, `matchday.failed`, `action.failed`, `page.failed`, `request.failed` via `src/instrumentation.ts`, `cron.run`) com `game_id`, `fixture_id`, `request_id`, `simulation_version`, duração. `audit_log` regista mutações sensíveis. `/api/health` verifica a BD. Rotinas (cron a cada 15 min, backups, alertas) e incidentes: [`runbook.md`](runbook.md). Erros de página mostram `error.tsx` (liga e app) com a referência (`digest`) que aparece nos logs.

## Desempenho do pedido

Cada página de liga é dinâmica e renderizada por pedido. O custo dominante são idas e voltas (à BD e ao Supabase Auth), por isso:

| Regra | Onde |
|---|---|
| `withUser` abre a transação, define as claims e muda de papel numa só ida à BD (`begin; select set_config(…)`); o `userId` é validado como UUID | `src/server/pg.ts` |
| Utilizador e cabeçalho da liga resolvidos uma vez por pedido (`React.cache`): `getUser`, `getGame`, `getClubColors`, `getProfile` | `src/server/auth.ts`, `src/server/queries.ts` |
| Sessão verificada com `getClaims()` (JWT verificado localmente com chaves assimétricas; com chaves HS256 legadas cai para `getUser()`) | `src/server/auth.ts`, `src/middleware.ts` |
| O middleware ignora prefetches do router e ficheiros estáticos (`sw.js`, ícones) | `src/middleware.ts` |
| Navegação sempre visível (tabs da liga, cabeçalho) com `prefetch={false}`: sem *loading boundary*, o prefetch não trazia nada reutilizável mas custava um pedido por link | `src/components/fx/tabs.tsx`, `site-header.tsx` |
| Pool `pg` registado com `attachDatabasePool` (Fluid compute fecha ligações inativas antes de suspender) | `src/server/db.ts` |
| Índices só para caminhos reais (leituras quentes, cron, eliminação de ligas); FKs de tabelas pequenas por clube ficam sem índice de propósito | `supabase/migrations/…0017_perf_indexes.sql` |

Medido localmente (build de produção, mesmo fluxo): por página, prefetches 12–16 → 0–7 e instruções SQL −20% a −55% (ex.: Finanças 29 → 15, Plantel 39 → 18). Ao criar uma consulta nova, preferir juntar leituras da mesma página numa só chamada `withUser` em vez de várias em paralelo (cada uma ocupa uma ligação do pool).

**Não usar `loading.tsx` em `src/app/g/[gameId]/` por agora**: com esse boundary, as Server Actions das páginas da liga (escolher clube, iniciar liga) deixam de atualizar a página. Causa provável: o layout e a página renderizam em paralelo — o `notFound()` do layout (não-membro / id desconhecido) não impede a página de correr, e 8 páginas fazem `(await getGame(…))!` e rebentam com `null (reading 'status')` (visível nos logs `request.failed`). Sem boundary o erro fica escondido pelo 404 do layout; com boundary fica dentro do Suspense da página. Corrigir primeiro: `const game = await getGame(…); if (!game) notFound();` nas páginas.
