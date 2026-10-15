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
npm test                      # engines (unitários)
npm run test:integration      # Postgres real: RLS, comandos, jornada, mercado, importador (precisa LOCAL_PG_URL)
npm run test:e2e              # app a correr em :3000 (AUTH_MODE=dev + seed sintético)
npm run sim:calibrate         # 100 000 jogos → reports/calibration-*.json/html (fora do CI)
npm run sim:seasons -- 10     # balanço de progressão/economia a 10 épocas
```

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

## Operação de ligas

- Processar jornada: botão do criador (idempotente). Para várias ligas em modo diário: cron da Vercel ou `curl -H "Authorization: Bearer $CRON_SECRET" $APP_BASE_URL/api/cron/process`.
- Jornada "presa": se uma execução falhar, a lease é libertada e o botão retoma a mesma jornada. Se o processo morrer sem libertar, a lease expira em 4 min.
- Rollback de um bug de progressão: `player_progression_log` tem `old_ovr/new_ovr` por jogador e fixture; corrigir com SQL dentro de uma transação e registar em `audit_log`.

## Backups e migração

```bash
pg_dump "$SUPABASE_DB_URL" -Fc -f backup-$(date +%F).dump          # backup completo
pg_restore --clean --no-owner -d "$TARGET_DB_URL" backup-AAAA-MM-DD.dump
# copiar só o catálogo (ex.: dev → staging):
pg_dump "$SRC" --data-only -t public.source_providers -t public.source_leagues -t public.source_clubs -t public.source_players \
  -t public.dataset_snapshots -t public.dataset_snapshot_clubs -t public.dataset_snapshot_players | psql "$DST"
```

Regenerar `supabase/seed.sql` (fictício): BD limpa → `npm run seed:synthetic` → `pg_dump --data-only --inserts` das 6 tabelas de catálogo.
