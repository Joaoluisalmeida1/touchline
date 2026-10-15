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
| `supabase/migrations` | Schema, RLS, comandos SQL (`0001`–`0009`) |
| `supabase/seed.sql` | Catálogo + snapshot **fictícios** para dev |
| `supabase/local/00_supabase_shim.sql` | Só testes: papéis + `auth.uid()` num Postgres simples |
| `src/engine/common` | RNG determinístico (xmur3+sfc32), hash canónico, tipos |
| `src/engine/match` | Motor por posses (`simulateMatch`), config de calibração |
| `src/engine/rating` | `initial-rating-v1`: Elo → OVR, potencial, valor |
| `src/engine/progression` | Forma, fitness, moral, lesões, castigos, XP, checkpoints |
| `src/engine/economy` | Salários, receitas, prémios, revalorização |
| `src/engine/lineup` | Formações, adequação posicional, auto-escalação e correção |
| `src/engine/league` | Orquestração pura de uma jornada / época + simulador offline |
| `src/integrations/playerelo` | Cliente HTTP (rate-limit, retries), esquemas Zod tolerantes, importador |
| `src/integrations/catalog` | Construção de snapshots, gerador sintético |
| `src/server` | `pg.ts` (impersonação), `queries.ts`, `actions/`, `services/` (criar liga, processar jornada) |
| `src/app` | Rotas (pt-PT) |
| `scripts/` | CLI PlayerElo, seed, calibração, reset local |
| `tests/` | integração (Postgres real), E2E (Playwright) |

## Fluxo de uma jornada (exactly-once)

1. `begin_matchday(game)` — `SELECT … FOR UPDATE` no jogo; adquire *lease* (240 s); fixa `processing_round`; escalações e mercado ficam bloqueados enquanto a lease está ativa.
2. TS carrega o estado (clubes, táticas, escalação guardada, jogadores) e chama `processRound`: corrige escalações inválidas de forma determinística, simula cada jogo com `seed = game|época|jornada|fixture`, calcula `input_hash`, progressão e ledger.
3. `finalize_fixture(fixture, payload)` por jogo — lock da fixture; se já `completed` devolve `already_completed` sem efeitos. Valida golos vs eventos e lease. Grava run, eventos, stats, escalação usada, tabela, jogadores (com verificação de `version`), log de progressão e ledger (chaves idempotentes).
4. `complete_matchday(game, round, payload)` — exige todos os jogos concluídos; aplica estado dos clubes com folga, salários/patrocínios, expira propostas; avança `current_matchday`; liberta a lease.
5. Última jornada → `end_season`: prémios, rollover de jogadores, nova época e calendário.

Falha a meio: a lease é libertada, `processing_round` mantém-se; a próxima chamada retoma a mesma jornada e salta jogos já concluídos (`alreadyPlayedClubIds`).

## Segurança

- RLS em todas as tabelas `public` (teste automático). Leituras por membership (`is_game_member`), dados privados por clube (táticas, escalação atual, ledger, propostas) e notificações por utilizador.
- Nenhum `INSERT/UPDATE/DELETE` concedido a `anon`/`authenticated` (exceto `profiles.display_name/avatar_settings`) — testado.
- `potential_cap` e `hidden_development_rate` sem `GRANT` de coluna.
- Funções: `EXECUTE` revogado de `PUBLIC`/`anon`; allow-list explícita para `authenticated`; comandos de servidor só para owner/`service_role` — testado.
- Segredos só no servidor (`PLAYERELO_API_KEY`, `SUPABASE_DB_URL`, `CRON_SECRET`); nenhum com prefixo `NEXT_PUBLIC_`. Server Actions são POST com verificação de Origin (CSRF).
- Não-membros recebem 404 nas páginas de liga (sem enumeração).

## Observabilidade

Logs JSON estruturados (`matchday.begin`, `fixture.finalized`, `matchday.complete`, `matchday.failed`, `action.failed`) com `game_id`, `fixture_id`, `request_id`, `simulation_version`, duração. `audit_log` regista mutações sensíveis. `/api/health` verifica a BD.
