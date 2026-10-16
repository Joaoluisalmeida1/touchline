# Design de jogo — plano de imersão

Objetivo: cada dia entre jornadas tem 2–3 decisões com consequências visíveis (no jogo, no jornal, no balneário ou nas contas). O ciclo base é a **semana de jornada**: rescaldo → decisões da semana → preparação → jogo.

Princípios: assíncrono (5–10 min/dia no telemóvel), poucas decisões com efeito real, causa-efeito legível (cada efeito tem uma linha de motivo), servidor autoritativo e determinístico (RNG `game|época|jornada|…`), justo entre amigos (as mesmas regras para humanos e IA), tom pt-PT.

## Fases

| Fase | Branch | Conteúdo | Estado |
|---|---|---|---|
| 1 · Liga viva | `feat/phase-1-living-league` | Registo de eventos, jornal O Apito, prémios da jornada, confronto direto e rivalidades, História (Hall of Fame), análise do jogo (xG), notificações push | **Implementado** |
| 2 · Semana de jornada | `feat/phase-2-matchday-week` | Gabinete (eventos aleatórios com escolhas), treino semanal, conferências de imprensa (texto livre + tom), relatório do adversário, instruções de marcação, planos de jogo condicionais, idades reais (Wikidata), traços de personalidade | Planeado |
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

## Próximas fases — regras de desenho já acordadas

- Idades: só reais (Wikidata, CC0) ou desconhecidas; desenvolvimento por idade só com idade real.
- Conferências: texto livre do treinador + tom escolhido; o tom decide efeitos (moral ±1–3, confiança da direção, adeptos, "mind games" contra rival humano); o texto aparece no jornal.
- Direção: confiança 0–100 com avisos e cortes de orçamento, sem despedimentos.
- Eventos: ~1–2 por treinador por jornada, prazo + escolha por omissão, impacto limitado (≤ ~5% da força, ≤ 10% do saldo), mesmas probabilidades para humanos e IA.
- Conteúdo como dados: eventos, manchetes, marcas e perguntas da imprensa em catálogos versionados (sem migrações para adicionar conteúdo).
