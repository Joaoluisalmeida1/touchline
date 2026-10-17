# Deploy: Supabase + Vercel

> Estado: **ainda não houve deploy** (não havia contas/credenciais no ambiente de construção). Os passos abaixo são os exatos a seguir; a verificação final é `/api/health` + o fluxo E2E contra o URL da Vercel.

## 1. Supabase (uma vez por ambiente: dev / staging / prod)

1. Criar projeto em <https://supabase.com/dashboard> (região perto de Lisboa, ex. `eu-west-2`/`eu-central-1`; a Vercel deve correr na mesma região — ver passo 3).
2. Auth → Providers → Email: ativo. Para testes com amigos pode desligar "Confirm email"; em produção manter ligado e configurar:
   - Auth → URL Configuration → Site URL = `https://<app>.vercel.app`; Redirect URLs += `https://<app>.vercel.app/auth/callback`.
3. Aplicar migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push            # aplica supabase/migrations/*
   ```
   (Alternativa sem CLI: colar cada ficheiro de `supabase/migrations` por ordem no SQL Editor.)
4. **Smoke test de papéis** (SQL Editor) — confirma que o utilizador da connection string pode impersonar `authenticated`:
   ```sql
   begin;
   select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}', true);
   set local role authenticated;
   select auth.uid(), current_user;      -- deve devolver o uuid e "authenticated"
   select count(*) from public.games;    -- 0 (RLS)
   rollback;
   ```
5. Dados:
   - **Dev/staging**: `psql "$SUPABASE_DB_URL" -f supabase/seed.sql` (dataset fictício) ou `npm run seed:synthetic`.
   - **Real**: ver `docs/operator-guide.md` (discover → preview → import → audit → finalize).
6. Tornar-se admin (para `/admin/import`): `update public.profiles set is_admin = true where id = '<o teu user id>';`
7. Connection strings (Project Settings → Database → Connect):
   - Vercel: **Transaction pooler** (porta 6543) → `SUPABASE_DB_URL`.
   - CLI de importação: Session pooler (5432) ou direct.

## 2. Vercel

1. Importar o repositório GitHub (Framework: Next.js; root = raiz do repo).
2. Environment Variables (Production e Preview, com valores distintos por ambiente):

| Variável | Notas |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` |
| `SUPABASE_DB_URL` | pooler de transações (6543) — **secreto** |
| `APP_BASE_URL` | `https://<app>.vercel.app` |
| `CRON_SECRET` | `openssl rand -hex 32` — a Vercel envia-o no header do cron |
| `NEXT_PUBLIC_APP_NAME` | opcional |
| `AUTH_MODE` | **não definir** (default `supabase`). `dev` é recusado na Vercel. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | opcional — notificações push. Gerar com `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | opcional, **secreto** — par da chave pública acima |
| `VAPID_SUBJECT` | opcional, ex.: `mailto:teu-email@exemplo.pt` |

   `PLAYERELO_API_KEY` **não** é necessária na Vercel (importação é feita por CLI).
3. Settings → Functions → Region: a mesma região do Supabase (latência por query — cada página faz 10–40 instruções SQL). Manter **Fluid compute** ligado (default); o pool já está registado com `attachDatabasePool`.
   No Supabase: Project Settings → **JWT Keys** → usar chaves assimétricas (ECC/RSA). Assim `getClaims()` verifica a sessão localmente, sem ida ao Supabase Auth em cada pedido; com a chave HS256 legada funciona na mesma, mas faz a chamada de rede.
4. Deploy. O `vercel.json` regista o cron diário `0 19 * * *` em `/api/cron/process` (Hobby: 1×/dia, ±59 min).
5. Verificar:
   ```bash
   curl https://<app>.vercel.app/api/health          # {"ok":true,"db":"up","finalized_snapshots":N}
   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>.vercel.app/api/cron/process
   E2E_BASE_URL=https://<app>.vercel.app npx playwright test   # requer confirmação de email desligada para contas de teste
   ```

## 3. Checklist de segredos e segurança antes de convidar amigos

- [ ] Nenhuma variável secreta com prefixo `NEXT_PUBLIC_` (`grep -r NEXT_PUBLIC_ .env*`).
- [ ] `npm run build` e procurar a connection string no bundle: `grep -r "pooler.supabase" .next/static` → vazio.
- [ ] Migration `0008` aplicada (privilégios de funções). Correr `npm run test:integration` localmente antes de cada migration nova.
- [ ] Toda a tabela nova: `enable row level security` + `revoke all … from anon, authenticated` (o teste de invariantes falha se esquecer).
- [ ] Backups: Supabase Pro faz backups diários; no Free exportar com `pg_dump` (ver operator guide).

## 4. Ambientes

`dev` (local, Postgres + `AUTH_MODE=dev` ou projeto Supabase de dev) → `staging` (projeto Supabase + Preview deployments da Vercel) → `prod`. Migrations sempre por CLI (`supabase db push`) e na mesma ordem.
