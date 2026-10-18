# Runbook — operação e incidentes

O que fazer quando algo corre mal em produção, e como manter as rotinas automáticas (cron, backups, alertas).
Produção: Vercel `cdg1` + Supabase `eu-west-3` (Paris). Projeto, IDs e particularidades: `docs/HANDOFF.md`.

## 1. Rotinas automáticas

| Rotina | Onde | Frequência | Se falhar |
|---|---|---|---|
| Jornadas em modo diário | Vercel Cron → `/api/cron/process` | **1×/dia** (19:00 UTC ±59 min, Hobby) — de propósito | logs Vercel (`cron.run`, HTTP 500 se alguma liga falhar) |
| Uptime (app + BD) | GitHub Actions *Uptime check* → `/api/health` | a cada 15 min | e-mail do GitHub ao último editor do workflow |
| Backup cifrado + teste de restauro | GitHub Actions *Nightly backup* | diário 03:30 UTC | e-mail do GitHub; nada é guardado |
| Alertas de erro do servidor | `src/instrumentation.ts` → webhook | por erro (máx. 1 por erro/rota em 10 min) | `alert.failed` nos logs |

As jornadas são diárias por decisão de produto. Cada chamada do cron processa **todas** as ligas com prazo vencido
(em lotes, até ~240 s) e joga **uma jornada por liga**. O processamento é idempotente e protegido por *lease*, por isso
uma chamada manual (ou o botão do criador) ao mesmo tempo que o cron é segura.

## 2. Configuração (uma vez)

**GitHub → Settings → Secrets and variables → Actions:**

| Nome | Tipo | Valor |
|---|---|---|
| `APP_BASE_URL` | Variable | `https://touchline-garagemonline.vercel.app` |
| `BACKUP_DB_URL` | Secret | connection string do **Session pooler** (porta 5432): `postgresql://postgres.<ref>:<password>@aws-1-eu-west-3.pooler.supabase.com:5432/postgres`. Não usar o transaction pooler (6543) nem a ligação direta (só IPv6; os runners do GitHub não têm IPv6). |
| `BACKUP_AGE_RECIPIENT` | Variable | chave **pública** `age1…` (abaixo) |

Chaves de backup (num computador de confiança, nunca no repositório):
```bash
age-keygen -o touchline-backup.key     # imprime "Public key: age1…" → BACKUP_AGE_RECIPIENT
```
Guardar `touchline-backup.key` num gestor de palavras-passe. **Sem esta chave privada os backups não se podem abrir.**

**Alertas (opcional):** Vercel → Environment Variables → `ALERT_WEBHOOK_URL` = URL de um webhook do Discord
(Server Settings → Integrations → Webhooks) ou Slack (Incoming Webhook). Redeploy para aplicar.

Os workflows saltam com um aviso enquanto não estiverem configurados. Depois de configurar: Actions → workflow → *Run workflow* para testar.
Nota: o GitHub desativa workflows agendados num repo público após 60 dias sem commits — reativar em Actions se acontecer.

## 3. Incidentes

### Site em baixo / `/api/health` devolve 503
1. `curl https://<app>/api/health` — `db: "down"` → problema na BD; erro 5xx sem JSON → problema na app.
2. **BD:** Supabase dashboard — projeto *paused*? (Free pausa após 7 dias sem atividade; o Uptime check evita isto) → *Restore project*. Password mudada? → Integrations → Vercel → *Resync environment variables* + Redeploy (`docs/HANDOFF.md`).
3. **App:** Vercel → Deployments. Se começou com o último deploy: **Instant Rollback** para o anterior (segundos), investigar depois.

### Jornada não foi processada
1. Vercel → Logs, filtrar por `cron.run` (por volta das 19:00 UTC): mostra `processed`/`failed`; a resposta do cron (Vercel → Settings → Cron Jobs → View logs) traz o erro por liga.
2. `failed > 0`: o erro também está nos logs Vercel (`matchday.failed` com `game_id`). A *lease* é libertada no erro e a próxima chamada (o cron do dia seguinte, ou forçar já — ponto 4) retoma a mesma jornada sem repetir jogos.
3. Processo morreu a meio sem libertar a lease: expira em 4 min; a seguinte chamada retoma.
4. Forçar agora: botão "Jogar jornada" (criador) ou `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/process`.

### Erros numa página
O alerta / log `request.failed` traz `route`, `digest` e a mensagem. O `digest` é a referência mostrada ao utilizador no ecrã de erro ("Ref. …").

### Um deploy partiu algo
Vercel **Instant Rollback** primeiro. Se o PR tinha migration, seguir o *Rollback plan* da descrição do PR (`CONTRIBUTING.md` §5).

## 4. Restaurar de um backup

1. **Descarregar** o artefacto: Actions → *Nightly backup* → run → `touchline-backup-…` (30 dias de retenção).
2. **Decifrar** (com a chave privada):
   ```bash
   age -d -i touchline-backup.key touchline-backup-*.tar.gz.age | tar -xzf -
   # README.txt, counts.json, public-data.dump, auth-users.dump, public-schema.sql
   ```
3. **Base de dados de destino** — projeto Supabase novo (ou o mesmo, depois de limpo): aplicar o schema com
   `npx supabase db push` (migrations do repositório no commit do backup).
4. **Carregar os dados** (session pooler do destino em `$TARGET_DB_URL`), utilizadores primeiro:
   ```bash
   pg_restore --data-only -f auth-users.sql auth-users.dump
   pg_restore --data-only -f public-data.sql public-data.dump
   psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 --single-transaction \
     -c "set session_replication_role = replica" \
     -c "do \$\$ declare t text; begin select string_agg(format('public.%I', tablename), ', ') into t from pg_tables where schemaname = 'public'; execute 'truncate ' || t || ' cascade'; end \$\$" \
     -f auth-users.sql -f public-data.sql
   ```
   (`session_replication_role = replica` desliga triggers e FKs durante a carga, como faz o `supabase db dump`.)
5. **Verificar** as contagens contra `counts.json` e abrir uma liga no site. Apontar a app ao projeto novo (variáveis da Vercel) se mudou de projeto.

O teste automático de cada noite valida os passos 3–5 numa BD Postgres criada pelas migrations; o passo 4 contra um
projeto Supabase real ainda **não foi ensaiado** — fazê-lo uma vez num projeto de teste e atualizar esta secção.
