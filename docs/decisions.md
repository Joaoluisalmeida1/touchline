# Decisões (ADR resumido)

Formato: decisão · porquê · como mudar. Todos os parâmetros de jogo estão em código versionado (`ENGINE_CONFIG`, `PROGRESSION`, `ECONOMY`, `games.settings_json`).

## Arquitetura

1. **Uma só app Next.js (sem monorepo).** Fronteiras de domínio por pastas: `src/engine/*` (puro, sem I/O), `src/integrations/*` (PlayerElo, catálogo), `src/server/*` (serviços, queries, actions). Porquê: deploy Vercel trivial, menos tooling; os engines continuam isolados e testáveis. Mudar: mover `src/engine` para `packages/` quando houver segundo consumidor.
2. **Acesso à BD pelo servidor via `pg` com impersonação de papel** (`set local role authenticated` + `request.jwt.claims`), igual ao que o PostgREST faz. RLS e `auth.uid()` aplicam-se a todas as leituras/comandos do utilizador. Supabase Auth trata a identidade. Porquê: SQL completo (joins, transações), tudo testável num Postgres local, e a mesma política de segurança. Custo: precisa de `SUPABASE_DB_URL` (pooler de transações em serverless).
3. **Mutações críticas em PL/pgSQL `SECURITY DEFINER`** (convites, clubes, escalações, propostas, transferências, ledger, finalização de jogos). Atomicidade, locks e idempotência ficam na BD. Ordem de locks: jogador → proposta → clubes (evita deadlocks; testado com aceitações concorrentes).
4. **Motor e progressão em TypeScript puro**; a BD recebe um *payload* versionado e valida (golos = eventos, lease ativa, versões de jogadores).
5. **Comandos só-servidor** (`create_game_tx`, `begin_matchday`, `finalize_fixture`, `complete_matchday`, `end_season`) não são executáveis por `authenticated`/`anon` (teste de invariantes).
6. **Dev auth adapter** (`AUTH_MODE=dev`) só para testes locais sem Supabase; recusado se `VERCEL`/`VERCEL_ENV` existir ou `NODE_ENV=production`.

## Produto (defaults pedidos)

| Parâmetro | Default | Onde |
|---|---|---|
| Idioma | pt-PT | UI |
| Timezone | `Europe/Lisbon`, persistência UTC | `games.timezone` |
| Managers por liga | 2–20 (default 20), resto IA | `games.max_managers` |
| Calendário | ida e volta, método do círculo, byes em número ímpar | `_generate_fixtures` |
| Pontos | 3 / 1 / 0 | `settings_json.points_win/draw` |
| Desempate | pontos, DG, GM, vitórias, id estável | `sortStandings` + query |
| Plantel | mín. 16 / máx. 32 (transferências) | `settings_json.min_squad/max_squad` |
| Avanço | manual (fallback universal) ou diário (cron) | `games.tick_mode` |
| Dinheiro | `bigint` em cêntimos | todas as tabelas |
| OVR | 1–99, inicial 40–95 | `initial-rating-v1` |
| Checkpoint de OVR | a cada 4 jornadas, ±1 máx. | `PROGRESSION.checkpointEveryRounds` |

## Regras simplificadas no MVP (documentadas, mudáveis)

- **Contratos**: renovação automática por 2 épocas no fim do contrato, salário recalculado (`endOfSeasonPlayer`). Negociação é pós-MVP.
- **Salários** pagos por jornada = salário semanal; receitas de bilheteira (casa), patrocínio (por jornada), prémios de resultado e prémios de classificação.
- **Dívida**: o saldo pode ficar negativo por salários; transferências exigem `cash − reservado ≥ valor`.
- **Reservas**: uma proposta reserva a verba até ser aceite/recusada/cancelada/expirada (3 dias). Evita *overspend* com propostas paralelas.
- **IA de mercado**: clube IA responde de imediato — aceita se `valor ≥ preço pedido` (valor de mercado × 1,15–1,60 conforme importância no plantel, −0,20 em fim de contrato), senão recusa e devolve contraproposta. IA não compra (pós-MVP).
- **Agentes livres**: não suportados no MVP.
- **Lesões/castigos** contam em jogos (`injured_matches`), não em datas. Castigo: vermelho direto 2 jogos, 2.º amarelo 1 jogo, 5 amarelos acumulados 1 jogo.
- **Idade**: só com data de nascimento verificada. A API PlayerElo documentada não expõe DOB → por omissão `age = null`. O script `wikidata:ages` preenche datas reais do Wikidata (CC0) só quando há uma correspondência única (nome + clube), com precisão ao dia e idade plausível (15–45); o resto continua desconhecido.
- **Potencial**: inferido pelo jogo, oculto (só banda A–E visível; coluna sem `GRANT`).
- **Convites**: código de 16 caracteres (80 bits), só o hash SHA-256 é guardado; 7 dias; rotação invalida o anterior; erro idêntico para inválido/expirado/revogado.
- **Eliminação de liga**: não exposta no MVP. As FKs são `on delete cascade` a partir de `games`, por isso um `delete from games where id = …` (operador) remove tudo de forma consistente; recomendado `status = 'archived'`.

## Agendamento

Vercel Hobby: cron no máximo 1×/dia e precisão ±59 min (verificado em 2026-10-15). Por isso: botão manual idempotente + cron diário opcional (`vercel.json`, 19:00 UTC). Para kickoffs exatos: Vercel Pro (cron ao minuto) ou um worker dedicado que chame `/api/cron/process`.

## Divergências encontradas com o enunciado

- `/v1/leagues`, `/v1/leagues/{id}/players`, `/v1/clubs/{id}/players`, `/v1/players/{id}/value|style`, `/v1/usage` aparecem listados em `/api-access` mas **sem esquema de resposta** na documentação pública. O cliente aceita lista simples ou embrulhada e preserva campos desconhecidos. `offset` só está documentado para `/v1/players`; o importador deteta páginas repetidas e pára.
- Limite Free documentado: 500 pedidos/mês e **10 pedidos/min** (o cliente usa 9/min por omissão).

## Imersão (plano em fases)

Plano completo em `docs/game-design.md`. Decisões tomadas com o Joao (2026-10-16):

- **Jornal "O Apito"**: só templates pt-PT, sem LLM (custo zero, determinístico). Uma edição por jornada; jornadas antigas são geradas quando alguém abre o jornal.
- **Idades**: nunca aleatórias. Fonte prevista: datas de nascimento do **Wikidata** (CC0), importadas por CLI no PC do operador com correspondência por nome + clube; sem correspondência segura ⇒ `age = null` (como hoje). Traços de personalidade são dados de jogo derivados do id do jogador.
- **Conferências de imprensa**: o treinador escreve o que quiser e escolhe um tom (Confiante · Calmo · Provocador · Evasivo); o tom decide os efeitos, o texto é citado no jornal.
- **Direção**: a confiança da direção tem consequências (orçamento, objetivos, avisos), mas **ninguém é despedido**.
- **Entrega**: um branch por fase (`feat/phase-N-…`), testado e integrado antes da fase seguinte.

### Fase 2 (2026-10-16)

- **Tom vs texto**: o texto da conferência nunca é interpretado (sem moderação automática nem LLM); só o tom tem efeitos. O texto é público para a liga depois de responder — é uma liga entre amigos.
- **Mind games**: só contra treinadores humanos; resposta "Calma" do rival anula. Efeito pequeno (−0,3 controlo por resposta provocadora) para não decidir jogos.
- **IA no Gabinete**: mesmos eventos e probabilidades, sempre a opção por omissão (a mais prudente; quem responde pode escolher melhor, mas a vantagem é pequena).
- **Prazo**: todos os assuntos expiram no início da jornada seguinte (sem prazos de vários dias nesta fase).
- **Compatibilidade**: clubes sem plano de treino/jogo e sem conferência jogam exatamente como antes; os testes *golden* do motor não mudam.
- **Wikidata**: corre no PC do operador (o ambiente de build não acede ao Wikidata). Só APIs oficiais (pesquisa + SPARQL), 1 pedido/1,1 s, User-Agent identificável (`WIKIDATA_CONTACT` opcional). Proveniência gravada em `source_players.attributes_json.birth_date`.

### Fase 3 (2026-10-16)

- **Despedimentos**: não existem. A confiança baixa tem custo real (corte de 25% no orçamento de transferências, avisos), mas todos os amigos continuam no jogo com o seu clube.
- **Orçamentos suaves**: gastar acima do orçamento é permitido (o mercado não bloqueia); a direção penaliza a confiança. Evita mexer nos comandos de transferências e mantém a decisão do lado do treinador.
- **Calibração**: economy-v2 reproduz economy-v1 para um clube típico; as escolhas (bilhetes, patrocínios por objetivos, obras, staff) é que criam diferenças.
- **Conteúdo gerado pelo servidor**: propostas de patrocínio e candidatos de staff são gerados por TS determinístico e guardados; o cliente só escolhe uma linha existente (mesmo padrão do Gabinete).
- **Fora desta fase**: empréstimos com juros e embargo de transferências (ficam para quando houver negociações na fase 4).

### Fase 4a (2026-10-16)

- **Fase 4 dividida em 4a (rivais/social) e 4b (taças e carreira)** para entregar o que mais aumenta a interação entre amigos sem esperar pelas mudanças ao calendário (taça) e à estrutura da liga (subidas/descidas).
- **Contrapropostas**: o vendedor fixa um valor; aceitar fecha o negócio de imediato (sem nova ronda de confirmação). A verba só fica reservada enquanto há uma proposta pendente, não durante a contraproposta.
- **Trocas** só entre humanos; a IA continua com o fluxo de dinheiro imediato. Empréstimos, cláusulas de revenda e pagamentos a prestações ficam para a 4b (precisam de contratos e da janela de mercado).
- **Mural** sem imagens e com limite diário; moderação = dono da liga apaga. Sem filtragem automática de texto (liga entre amigos).
- **Conquistas por liga** (não globais) para respeitar o RLS por liga; um perfil global entre ligas fica para depois.

### Fase 4b (2026-10-16)

- **Taça fora da tabela `fixtures`**: os jogos da taça vivem em `cup_ties` e são simulados no mesmo job da jornada, sem tocar na classificação nem nas estatísticas da liga (evita mexer em `finalize_fixture` e nos índices de calendário). Sem prolongamento nem castigos na v1.
- **Jovens da academia são fictícios** (nomes gerados, idades do jogo) — não violam a regra de nunca inventar idades de pessoas reais.
- **Bosman só para clubes humanos**: a IA continua a renovar automaticamente para manter os plantéis estáveis; nunca se desce abaixo do plantel mínimo (os excedentes renovam automaticamente).
- **Divisões/subidas e empréstimos passam para a fase 5**: exigem calendários e classificações por divisão e contratos temporários — mudanças estruturais que merecem um ramo próprio.
