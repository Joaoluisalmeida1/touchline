# Guia do operador

## Desenvolvimento local

```bash
cp .env.example .env.local      # preencher
npm install
```

**Opção A — sem Supabase (só Postgres local, testes):**
```bash
# Postgres 15+ a correr; LOCAL_PG_URL aponta para o servidor (sem nome de BD)
export LOCAL_PG_URL=postgres://postgres@localhost:5432
npm run db:local:reset                    # cria touchline_dev com shim + migrations
SUPABASE_DB_URL=$LOCAL_PG_URL/touchline_dev npm run seed:synthetic
# .env.local: SUPABASE_DB_URL=…/touchline_dev, AUTH_MODE=dev, DEV_AUTH_SECRET=<32+ chars>
npm run dev
```
O adaptador `AUTH_MODE=dev` guarda contas na tabela `auth.users` do shim. **Nunca usar fora de máquinas locais** (recusado na Vercel).

**Opção B — com Supabase local (Docker):** `npx supabase start` → aplica migrations + `seed.sql`; usar as chaves impressas.

## Testes

```bash
npm run lint && npm run typecheck
npm test                      # projeto Vitest "unit": engines, golden master, env, pg-config (sem BD, em paralelo)
npm run test:integration      # projeto "integration": Postgres real — RLS, comandos, jornada, mercado, importador,
                              #   queries.ts, Server Actions e rotas /api (precisa LOCAL_PG_URL, uma BD por suite)
npm run test:coverage         # unit + integration com cobertura → coverage/ (falha abaixo dos limites)
npm run test:e2e              # Playwright; arranca `npm run dev` se nada estiver em :3000 (AUTH_MODE=dev + seed sintético)
npm run sim:calibrate         # 100 000 jogos → reports/calibration-*.json/html (fora do CI)
npm run sim:seasons -- 10     # balanço de progressão/economia a 10 épocas
```

| Camada | Onde | O que garante |
|---|---|---|
| Unitários | `src/**/*.test.ts` | Engines determinísticos, propriedades de balanço, validação de env, config do pool |
| Golden master | `src/engine/golden.test.ts` + `__snapshots__/` | Mesmo seed + mesma versão ⇒ resultado idêntico (ver abaixo) |
| Integração | `tests/integration/` | SQL, RLS e invariantes de segurança; caminho real de leitura (`queries.ts`), Server Actions e `/api/*` com só a sessão simulada |
| E2E | `tests/e2e/` | Fluxo completo de dois amigos, guardas de rotas (anónimo → `/auth`, não-membro → 404), mobile |

**Cobertura**: limites em `vitest.config.mts` (global e `src/engine/**`), ligeiramente abaixo dos valores medidos. Sobem quando a cobertura sobe; nunca se baixam para fazer passar um PR. O relatório HTML fica em `coverage/index.html`.

**Golden master**: cada teste tem a versão do algoritmo no nome (`match engine @ match-v1.0.0`). Se o resultado mudar sem subir a versão, o snapshot falha. Mudança intencional: subir a constante (`ENGINE_VERSION`, `INITIAL_RATING_VERSION`, `PROGRESSION_VERSION`, `ECONOMY_VERSION`), correr `npx vitest run -u src/engine/golden.test.ts` e fazer commit do snapshot novo. Nunca atualizar um hash mantendo a mesma versão.

### CI (`.github/workflows/ci.yml`)

Corre em cada PR e em cada push para `main`, em três jobs paralelos:

| Job | O quê |
|---|---|
| `checks` | `npm run lint` + `npm test` (feedback rápido) |
| `integration` | `npm run test:coverage` (unit + integração) contra um serviço `postgres:17`; aplica os limites de cobertura, publica a tabela de cobertura no resumo do job e o relatório como artefacto `coverage-report` |
| `build-e2e` | `next build` → `npm run typecheck` → verifica que `DEV_AUTH_SECRET`/`CRON_SECRET`/`SUPABASE_DB_URL` não aparecem em `.next/static` → BD `touchline_e2e` + seed sintético → `next start` (`AUTH_MODE=dev`) → Playwright. Em falha, o relatório, traces e `server.log` ficam como artefacto `e2e-report`. |

O workflow `.github/workflows/pr-rules.yml` (*Migration PRs have a rollback plan*) falha um PR que altere `supabase/migrations/` sem a secção **Rollback plan** preenchida (Code + Database); volta a correr ao editar a descrição. Regras completas em [`CONTRIBUTING.md`](../CONTRIBUTING.md).

O CI não usa segredos reais nem contas Supabase. O Dependabot (`.github/dependabot.yml`) abre PRs semanais de dependências npm (`next` e `eslint-config-next` agrupados) e mensais de GitHub Actions. Recomendado: proteger `main` no GitHub (Settings → Branches) exigindo os três jobs antes do merge.

## Importar ligas reais (PlayerElo)

Pré-requisitos: `PLAYERELO_API_KEY` e `SUPABASE_DB_URL` (session pooler) em `.env.local`. Ler `docs/data-licensing.md`.

```bash
npm run playerelo:discover -- --anchors
#   → imprime ligas e ids reais; guarda âncoras de ranking em data/playerelo-anchors.json (~12 pedidos)
#   → CONFIRMAR os nomes dos campos impressos em "Sample raw rows" e atualizar docs/data-contract.md
npm run playerelo:preview -- --leagues <ID_PT>,<ID_EN> --probe
npm run playerelo:import  -- --leagues <ID_PT>,<ID_EN> --max-requests 120
npm run playerelo:resume  -- --run <run-id>            # se ficou "paused" (orçamento) ou "failed"
npm run playerelo:audit   -- --leagues <ID_PT>,<ID_EN>
npm run playerelo:finalize -- --leagues <ID_PT>,<ID_EN> --label "PT+EN 2026/27"
```

Orçamento típico no plano Free (500/mês): âncoras 12 + 7 ligas × ~8 páginas ≈ 70 pedidos. Não usar enriquecimento por jogador no Free.

Depois de finalizar, o snapshot aparece em **Criar liga**. Confirmar em `/admin/import` o histograma de OVR (elite rara, maioria 60–80) e os avisos (`no_global_anchors…` significa escala relativa à amostra — evitar).

## Idades reais (Wikidata, CC0)

Para jogadores reais sem data de nascimento. Corre no teu PC (precisa de internet e de `SUPABASE_DB_URL`):

```bash
npm run wikidata:ages -- --leagues all --limit-clubs 3     # ensaio: mostra o que encontraria, não escreve
npm run wikidata:ages -- --leagues all --apply             # escreve só onde a data ainda é null
#   opções: --leagues <uuid,uuid> · --since 2023 (passagens pelo clube desde esse ano) · WIKIDATA_CONTACT=email (User-Agent)
```

Escreve em `source_players`, `dataset_snapshot_players` e nas ligas já criadas (`game_players.age`, `age_known`). Correspondência única por nome dentro do plantel do clube no Wikidata; ambíguos, sem data ao dia ou idades fora de 15–45 ficam por preencher. Volta a correr sem problema (idempotente).

## Operação de ligas

- Processar jornada: botão do criador (idempotente). Para várias ligas em modo diário: cron da Vercel ou `curl -H "Authorization: Bearer $CRON_SECRET" $APP_BASE_URL/api/cron/process`.
- Jornada "presa": se uma execução falhar, a lease é libertada e o botão retoma a mesma jornada. Se o processo morrer sem libertar, a lease expira em 4 min.
- Rollback de um bug de progressão: `player_progression_log` tem `old_ovr/new_ovr` por jogador e fixture; corrigir com SQL dentro de uma transação e registar em `audit_log`.

## Backups e migração

Backups automáticos (diários, cifrados, com teste de restauro) e o procedimento de restauro: [`docs/runbook.md`](runbook.md). Os comandos abaixo são para cópias manuais pontuais.

```bash
pg_dump "$SUPABASE_DB_URL" -Fc -f backup-$(date +%F).dump          # backup completo
pg_restore --clean --no-owner -d "$TARGET_DB_URL" backup-AAAA-MM-DD.dump
# copiar só o catálogo (ex.: dev → staging):
pg_dump "$SRC" --data-only -t public.source_providers -t public.source_leagues -t public.source_clubs -t public.source_players \
  -t public.dataset_snapshots -t public.dataset_snapshot_clubs -t public.dataset_snapshot_players | psql "$DST"
```

Regenerar `supabase/seed.sql` (fictício): BD limpa → `npm run seed:synthetic` → `pg_dump --data-only --inserts` das 6 tabelas de catálogo.
