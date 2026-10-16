# Design de jogo — plano de imersão

Objetivo: cada dia entre jornadas tem 2–3 decisões com consequências visíveis (no jogo, no jornal, no balneário ou nas contas). O ciclo base é a **semana de jornada**: rescaldo → decisões da semana → preparação → jogo.

Princípios: assíncrono (5–10 min/dia no telemóvel), poucas decisões com efeito real, causa-efeito legível (cada efeito tem uma linha de motivo), servidor autoritativo e determinístico (RNG `game|época|jornada|…`), justo entre amigos (as mesmas regras para humanos e IA), tom pt-PT.

## Fases

| Fase | Branch | Conteúdo | Estado |
|---|---|---|---|
| 1 · Liga viva | `feat/phase-1-living-league` | Registo de eventos, jornal O Apito, prémios da jornada, confronto direto e rivalidades, História (Hall of Fame), análise do jogo (xG), notificações push | **Implementado** |
| 2 · Semana de jornada | `feat/phase-2-matchday-week` | Gabinete (eventos aleatórios com escolhas), treino semanal, conferências de imprensa (texto livre + tom), relatório do adversário, instruções de marcação, planos de jogo condicionais, idades reais (Wikidata), traços de personalidade | **Implementado** |
| 3 · Negócio do clube | `feat/phase-3-club-business` | Patrocinadores com cláusulas, direção e confiança, orçamentos, estádio e bilhetes, staff (adjunto, preparador físico, médico, olheiro, formação), economy-v2 | Planeado |
| 4 · Rivais e taças | `feat/phase-4-rivals-cups` | Negociações entre humanos (contrapropostas, trocas, empréstimos), taça a eliminar, mural da liga, conquistas, academia (jovens gerados), renovações e Bosman, subidas/descidas | Planeado |

Cada fase termina com um *gate*: 4 jornadas jogadas com amigos; fica o que for usado.

## Fase 1 — o que existe

- **O Apito** (`/g/[id]/news`): manchete + histórias por jornada, escolhidas por "drama": dérbi entre treinadores, surpresa (diferença de força ≥ 4), goleada (≥ 4 golos de diferença), hat-trick, reviravolta, golo decisivo ≥ 85', novo líder, corrida ao título (2.ª metade), expulsão decisiva, festival de golos (≥ 6) e uma linha para cada clube humano sem outra notícia. Uma história por jogo (o ângulo mais forte). Templates em `src/engine/narrative/newspaper.ts`.
- **Prémios da jornada**: equipa da jornada (4-3-3, ≥ 45 min, por nota), jogador da jornada, golo da jornada (o golo de menor xG, sem penáltis nem autogolos).
- **História** (`/g/[id]/history`): campeões por época, rivalidades entre treinadores (V/E/D, golos), melhores marcadores, mais jogos, maiores goleadas, maior série sem perder, mais vezes jogador da jornada, contadores de feitos.
- **Jogo**: separador de análise com a corrida de xG (acumulado por minuto, golos marcados) e as melhores oportunidades; confronto direto entre os dois clubes nesta liga.
- **Resumo**: as 3 manchetes da última edição.
- **Push**: Definições → "Notificações no telemóvel" (Web Push, requer chaves VAPID na Vercel; no iPhone é preciso adicionar o site ao ecrã principal).

## Fase 2 — o que existe

Tudo vive em **Semana** (`/g/[id]/week`, separadores Gabinete · Imprensa · Treino · Adversário). O Resumo mostra um cartão quando há decisões pendentes e é enviada a notificação "Semana de jornada" (`week_ready`). A semana da jornada N+1 é preparada logo depois da jornada N (`prepareWeek`), ou na primeira visita (1.ª jornada, ligas antigas). Uma marca `week_prepared` em `game_events` garante que os dados são lançados uma só vez.

- **Gabinete** (`src/engine/narrative/events.ts`, events-v1): 0–2 assuntos por clube e jornada (55% o primeiro, 20% o segundo), escolhidos entre 14 eventos com gatilhos: jogador quer minutos, noite fora, queixas no treino, patrocinador local, protesto de adeptos (2 derrotas), pedido de folga (3 vitórias), líder quer falar (após derrota), discussão no balneário, jogo solidário, entrevista na TV, empresário ao telefone, homenagem, relvado estragado, jovem a brilhar. Cada escolha mostra o efeito; sem resposta, aplica-se a opção por omissão quando a jornada começa (`resolve_due_events`). Os clubes da IA recebem os mesmos eventos com as mesmas probabilidades e ficam com a opção por omissão. Valores em euros escalam com o patrocínio por jornada do clube. Todos os efeitos passam por `_apply_effects` (SQL), que volta a limitá-los: moral ±20, condição ±30, forma ±1,5, lesão ≤ 6 jogos, indisponível ≤ 3, dinheiro ≤ €10M.
- **Traços de personalidade** (`traits.ts`): um por jogador, derivado só do id (Profissional, Reservado, Ambicioso, Leal, Temperamental, Boémio, Líder). São ficção do jogo — não dizem nada sobre a pessoa real — e decidem que eventos podem acontecer. Visíveis na ficha e no painel do jogador.
- **Conferência de imprensa** (`press.ts`, press-v1): 3 perguntas por jogo dos clubes humanos (adversário/rival humano, forma, tabela/historial/objetivo). Cada resposta = tom + texto livre (≤ 280). Efeitos (`answer_press`): moral do plantel +1 por resposta não evasiva (máx. +3); **Confiante** +0,15 controlo no jogo por resposta; **Provocador** contra treinador humano −0,3 ao controlo do rival por resposta, anulado se o rival tiver respondido com pelo menos um **Calmo**; **Evasivo** nada. As respostas ficam públicas na liga e O Apito publica a frase mais forte, julgada pelo resultado ("falou demais" se provocou e perdeu).
- **Treino** (`src/engine/training/training.ts`, training-v1): intensidade (Leve: +6 condição, ×0,7 evolução, sem lesões · Normal · Intensa: −3 condição, ×1,3 evolução, 1,2% de lesão no treino por jogador/jornada) e foco (Ataque/Defesa/Posse dão +1 ao setor no jogo, ×0,5 leve, ×1,5 intensa; Bolas paradas meio ataque; Tática um pouco de tudo; Físico +4 condição). Clubes sem plano guardado jogam exatamente como antes (os testes *golden* não mudam).
- **Plano de jogo**: até 3 regras para a 2.ª parte ("ao minuto 65, se estiver a perder → mentalidade ofensiva e/ou troca X por Y"), disparam uma vez; e até 2 marcações individuais (o marcado rende ×0,94; custa 0,5 de controlo por marcação). As regras disparadas ficam em `match_runs.result_json.plans_fired`.
- **Relatório do adversário**: posição, golos e xG por jogo, sistema do último jogo, forma, historial, jogadores-chave (com traço), ausências, marcadores e a última frase do treinador rival na imprensa.
- **Idades reais** (`npm run wikidata:ages`): datas de nascimento do Wikidata (CC0) para quem o fornecedor não deu. Ver `docs/operator-guide.md`.

## Próximas fases — regras de desenho já acordadas

- Idades: só reais (Wikidata, CC0) ou desconhecidas; desenvolvimento por idade só com idade real.
- Conferências: texto livre do treinador + tom escolhido; o tom decide efeitos (moral ±1–3, confiança da direção, adeptos, "mind games" contra rival humano); o texto aparece no jornal.
- Direção: confiança 0–100 com avisos e cortes de orçamento, sem despedimentos.
- Eventos: ~1–2 por treinador por jornada, prazo + escolha por omissão, impacto limitado (≤ ~5% da força, ≤ 10% do saldo), mesmas probabilidades para humanos e IA.
- Conteúdo como dados: eventos, manchetes, marcas e perguntas da imprensa em catálogos versionados (sem migrações para adicionar conteúdo).
