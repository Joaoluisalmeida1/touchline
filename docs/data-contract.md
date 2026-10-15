# Contrato de dados — PlayerElo

Verificado nas páginas públicas em **2026-10-15**. Nenhum pedido autenticado foi feito (sem chave neste ambiente), por isso **os esquemas abaixo marcados "não documentado" têm de ser confirmados com `npm run playerelo:discover` e `playerelo:preview -- --probe`** antes de uma importação real.

- Base URL: `https://data-api.playerelo.football` · Auth: `Authorization: Bearer <key>`
- Erros documentados: 401 (chave), 404 (id), 429 (rate limit ou quota mensal)
- Planos (api-access): Free 500 pedidos/mês, 10/min · Pro €19 10 000/mês, 120/min · Ultra €49 50 000/mês, 300/min · Business €199 300 000/mês, 600/min (licença comercial + SLA). `/v1/usage` não conta para a quota.
- Paginação: `limit` 1–100 (default 20) e `offset` — **documentados apenas para `/v1/players`**.

## Endpoints usados

| Endpoint | Estado | Uso | Custo |
|---|---|---|---|
| `GET /v1/usage` | listado, sem esquema | quota antes/depois | grátis |
| `GET /v1/leagues` | listado, sem esquema | discovery | 1 |
| `GET /v1/leagues/{id}/players?limit&offset` | listado, sem esquema; paginação **assumida** | import principal | ~1 por 100 jogadores |
| `GET /v1/players?limit=1&offset=r-1` | **documentado** (lista simples ordenada por Elo desc) | âncoras de ranking global | 1 por âncora (~11) |
| `GET /v1/players/{id}` | **documentado** | enriquecimento opcional (não usado por omissão) | 1 por jogador |
| `GET /v1/players/{id}/value`, `/style` | listados, sem esquema | não usados por omissão (quota) | 1 por jogador |

### Campos documentados

`GET /v1/players` → `player_id` (string), `player_name`, `elo` (number), `position`, `current_team`, `current_league`, `ear_label`.

`GET /v1/players/{id}` → `player_id`, `player_name`, `player_type`, `elo`, `position`, `position_group` (`GK|DEF|MID|ATT`), `current_team`, `current_team_id` (int), `current_league`, `current_league_id` (int), `current_rank`, `games_played`, `total_minutes`, `ear_career`, `ear_label`, `ear_12m`, `ear_label_12m`, `ear_180`, `ear_label_180`.

**Não existe data de nascimento, idade, nacionalidade nem valor de mercado nos campos documentados.**

## Normalização (`src/integrations/playerelo/normalize.ts`)

| Catálogo | Fonte (ordem de preferência) | Se ausente |
|---|---|---|
| `external_id` | `player_id`, `id` | linha descartada |
| `display_name` | `player_name`, `name` | linha descartada |
| `position_group` | `position_group`; senão texto de `position` | `null` + flag `position_unknown` (snapshot usa MID e sinaliza) |
| clube | `current_team_id`; senão chave `name:<liga>:<nome>` | flag `club_missing` |
| `provider_elo` | `elo` | flag `elo_missing` → prior da liga/posição |
| `ear_180/12m/career`, `games_played`, `total_minutes` | mesmos nomes | `null` |
| `birth_date` | `date_of_birth`, `birth_date`, `dob` (só ISO) | `null` + `birth_date_unavailable` — **nunca inventada** |
| `market_value_eur` | `market_value_eur`, `market_value`, `value_eur` | `null` → valor por fórmula do jogo (`value_formula_estimate`) |

Cada jogador guarda `attributes_json.provider_fields` (campo → endpoint de origem), `source_updated_at`, `imported_at` e `data_quality_flags`.

## Pipeline

1. `discover` → `source_leagues` (+ `--anchors` → `data/playerelo-anchors.json`).
2. `preview --leagues A,B [--probe]` → estimativa de pedidos e quota.
3. `import --leagues A,B [--max-requests N]` → `import_runs` + checkpoint por página (`import_checkpoints`), upsert por `(provider, external_id)`, `import_raw_records` só com hash (payload apenas se `PLAYERELO_RETAIN_RAW=true`).
4. `resume --run <id>` → salta páginas `done`/`empty`.
5. `audit` → nulos, sem clube, duplicados suspeitos, plantéis < 16.
6. `finalize` → `dataset_snapshots` (+ clubes e jogadores derivados), relatório de qualidade e histograma de OVR.

Defesas: rate limiter global (9/min), backoff exponencial com jitter, `Retry-After`, timeout 20 s, 401/403/404 sem retry, deteção de `offset` ignorado (página repetida), orçamento de pedidos por execução.
