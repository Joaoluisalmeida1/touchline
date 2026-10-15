# Touchline (nome provisório)

[![CI](https://github.com/Joaoluisalmeida1/touchline/actions/workflows/ci.yml/badge.svg)](https://github.com/Joaoluisalmeida1/touchline/actions/workflows/ci.yml)

Jogo de gestão de futebol multiplayer assíncrono para browser: ligas privadas entre amigos, plantéis iniciais derivados do PlayerElo (Elo → OVR), jornadas simuladas lance a lance no servidor, mercado de transferências atómico e evolução independente por liga.

> O nome está em `src/lib/brand.ts` / `NEXT_PUBLIC_APP_NAME`.

## Estado

| Área | Estado |
|---|---|
| Schema Supabase, RLS, comandos SQL atómicos | ✅ testado num Postgres real (shim do `auth`) |
| Importador PlayerElo (discover/preview/import/resume/audit/finalize) | ✅ testado contra API mock; ⏳ **falta validar com chave real** (esquemas não documentados) |
| `initial-rating-v1` (Elo → OVR, potencial, valor) | ✅ testes de propriedades |
| Motor de jogo determinístico + calibração 100k | ✅ |
| Progressão (forma/fitness/moral/XP/OVR) + economia | ✅ simulação de várias épocas |
| Jornadas idempotentes (lease, exactly-once), fim de época | ✅ incl. processadores concorrentes |
| Mercado (IA, propostas entre managers, reservas, concorrência) | ✅ |
| UI pt-PT (dashboard, liga, plantel, tática 2D, jogos, replay, tabela, mercado, finanças, definições, admin) | ✅ E2E Playwright local e no CI |
| CI (GitHub Actions) | ✅ lint, unitários, integração (Postgres 17), build, typecheck, verificação de segredos no bundle, E2E — em cada PR |
| Deploy Vercel/Supabase | ⏳ instruções prontas (`docs/deployment.md`); não houve deploy (sem contas) |

## Início rápido (local, sem chaves)

Requisitos: Node 24 (ver `.nvmrc`; `nvm use`), Postgres 15+ com `psql`, e bash (Git Bash no Windows) para `scripts/db/local-reset.sh`.

```bash
npm install
cp .env.example .env.local
# Postgres local:
export LOCAL_PG_URL=postgres://postgres@localhost:5432
npm run db:local:reset
SUPABASE_DB_URL=$LOCAL_PG_URL/touchline_dev npm run seed:synthetic   # dados FICTÍCIOS
# em .env.local: SUPABASE_DB_URL=$LOCAL_PG_URL/touchline_dev  AUTH_MODE=dev  DEV_AUTH_SECRET=<32+ chars>
npm run dev    # http://localhost:3000
```

Com Supabase real: ver [`docs/deployment.md`](docs/deployment.md). Importar ligas reais: [`docs/operator-guide.md`](docs/operator-guide.md).

## Comandos

| Comando | O quê |
|---|---|
| `npm run verify` | lint + typecheck + todos os testes Vitest |
| `npm test` / `npm run test:integration` / `npm run test:e2e` | unitários / Postgres real / Playwright |
| `npm run test:coverage` | unit + integração com cobertura e limites mínimos (ver [guia do operador](docs/operator-guide.md#testes)) |
| `npm run sim:calibrate` | 100 000 jogos → `reports/calibration-*.{json,html}` |
| `npm run sim:seasons -- 10` | balanço de progressão e economia |
| `npm run playerelo:*` | pipeline de importação (ver operator guide) |
| `npm run seed:synthetic` | catálogo + snapshot fictícios |

## Documentação

- [Arquitetura](docs/architecture.md) · [Decisões e defaults](docs/decisions.md)
- [Contrato de dados PlayerElo](docs/data-contract.md) · [Licenciamento](docs/data-licensing.md)
- [Balanceamento do jogo](docs/game-balance.md) · [Custos](docs/costs.md)
- [Deploy](docs/deployment.md) · [Guia do operador](docs/operator-guide.md)

## Princípios

- O browser nunca decide jogos nem dinheiro: comandos validados no Postgres, simulação só no servidor.
- Reprodutível: `seed + engine_version + input_hash` por jogo.
- Sem pay-to-win, sem compras, sem apostas. Sem logótipos/fotografias de terceiros.
