# Design de jogo — plano de imersão

Objetivo: cada dia entre jornadas tem 2–3 decisões com consequências visíveis (no jogo, no jornal, no balneário ou nas contas). O ciclo base é a **semana de jornada**: rescaldo → decisões da semana → preparação → jogo.

Princípios: assíncrono (5–10 min/dia no telemóvel), poucas decisões com efeito real, causa-efeito legível (cada efeito tem uma linha de motivo), servidor autoritativo e determinístico (RNG `game|época|jornada|…`), justo entre amigos (as mesmas regras para humanos e IA), tom pt-PT.

## Fases

| Fase | Branch | Conteúdo | Estado |
|---|---|---|---|
| 1 · Liga viva | `feat/phase-1-living-league` | Registo de eventos, jornal O Apito, prémios da jornada, confronto direto e rivalidades, História (Hall of Fame), análise do jogo (xG), notificações push | **Implementado** |
| 2 · Semana de jornada | `feat/phase-2-matchday-week` | Gabinete (eventos aleatórios com escolhas), treino semanal, conferências de imprensa (texto livre + tom), relatório do adversário, instruções de marcação, planos de jogo condicionais, idades reais (Wikidata), traços de personalidade | **Implementado** |
| 3 · Negócio do clube | `feat/phase-3-club-business` | Patrocinadores com cláusulas, direção e confiança, orçamentos, estádio e bilhetes, staff (adjunto, preparador físico, médico, olheiro, formação), economy-v2 | **Implementado** |
| 4a · Rivais e balneário | `feat/phase-4a-rivals-social` | Negociações entre humanos (contrapropostas, trocas + dinheiro, notas), mural da liga (Balneário) com reações e publicações automáticas, conquistas e perfis de treinador | **Implementado** |
| 4b · Taças e carreira | `feat/phase-4b-cups-careers` | Taça a eliminar, academia (jovens gerados), renovações de contrato e saídas a custo zero (jogadores livres) | **Implementado** |
| M · Mercado OSM | `feat/market-osm` | Lista de Transferências que vai enchendo, preços a descer por jornada, vagas de venda, IA compra nas jornadas, estrangeiros na lista | **Implementado** |
| S · Roleta e apostas | `feat/slots-betting` | Roleta (€500k/giro) com prémios e castigos, jackpot da liga, cartas guardáveis, duelos; odds e apostas nos jogos | **Implementado** |
| 5 · Divisões e empréstimos | `feat/phase-5-divisions` | Ligas com duas divisões e subidas/descidas, empréstimos (com divisão de salário e opção de compra), cláusulas de revenda, pré-época guiada | Planeado |

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

## Fase 3 — o que existe

Página **Clube** (`/g/[id]/club`: Direção · Patrocínios · Estádio · Staff), cartão da Direção no Resumo e contas por blocos de 4 jornadas em Finanças. Regras em `src/engine/economy/business.ts` (business-v1 = economy-v2), calibradas para que um clube típico (reputação 60, adeptos a 50, bilhete normal, patrocinadores fixos) ganhe o mesmo que em economy-v1.

- **Preparação da época** (`ensureBusiness`, uma vez por época): estádio (lotação base 6 000 + 4×reputação²), staff inicial (nível pela reputação), objetivo e orçamentos da direção, 3 candidatos por função de staff e 3 propostas de patrocínio por espaço. Clubes da IA assinam logo a proposta fixa.
- **Patrocínios**: 4 espaços (principal 55%, estádio 20%, manga 15%, técnico 10% do patrocínio de economy-v1). Por espaço: **Fixo** (100% por jornada, 1–3 épocas), **Equilibrado** (80% + bónus por vitória, 2 épocas), **Por objetivos** (55% + bónus maior por vitória + bónus de fim de época se acabar no top do objetivo, 1 época). Marcas fictícias, sem apostas. Sem escolha até à jornada seguinte → assina a fixa.
- **Estádio e bilhetes**: preço Baixo/Normal/Alto (×0,75/1/1,35) muda a assistência (+12%/0/−14%) e o humor dos adeptos (+1/0/−1 por jornada). Assistência = lotação × (0,55 + 0,35×humor + ajuste do preço + 5% contra clubes grandes). Humor: vitória +3, derrota −3, volta devagar a 50. Obras: bancada (+2 000 lugares, €3M, 6 jornadas, até 5) e camarotes (+€40k por jogo em casa, €2M, 8 jornadas, até 3), uma de cada vez.
- **Staff** (salário por jornada, nível 1–5): adjunto (+3,75% evolução por nível acima de 1), preparador físico (+0,75 condição/jornada e −7,5% lesões no treino por nível), médico (−6,25% duração das lesões de jogo por nível), olheiro (nível 1: OVR do adversário em intervalo, sem sistema nem ausências; 2–3: sistema e ausências; 4+: também traços), coordenador da formação (prepara a academia da fase 4). Substituir alguém custa 2 jornadas do salário de quem sai.
- **Direção** (0–100): objetivo pela força do plantel na liga (campeão / top N / evitar os últimos 3). Depois de cada jornada: pontos vs esperado (pela diferença de força e casa/fora, ±6), saldo negativo −2, salários acima do orçamento −1, transferências acima do orçamento −2. Abaixo de 35: aviso; abaixo de 20: ultimato e −25% no orçamento de transferências; a partir de 80: +10%. **Ninguém é despedido.** A nova época começa a meio caminho de 60, ±10 conforme o objetivo foi cumprido.
- **Orçamentos**: transferências = 25–45% do saldo (conforme a confiança), salários = folha atual +5% por jornada; nas 3 primeiras jornadas o treinador pode mover até 20% entre os dois.
- **Gabinete** (events-v2) ganhou 4 eventos: protesto contra o preço dos bilhetes, investidor (1×/época), campanha do patrocinador principal, presidente a exigir o dérbi entre treinadores. Novos efeitos: confiança, humor dos adeptos, preço dos bilhetes.

## Fase 4a — o que existe

- **Negociações** (só entre treinadores humanos; a IA continua a responder de imediato e só aceita dinheiro): a proposta pode incluir um jogador teu em **troca** (com troca, o dinheiro pode ser €0) e uma **nota** (≤ 140). Quem recebe pode **aceitar**, **recusar** ou **contrapropor** outro valor com nota. A contraproposta liberta a verba reservada; o comprador pode **aceitar a contraproposta** (o negócio fecha logo, porque o vendedor já concordou) ou fazer **nova proposta** na mesma negociação (máx. 6 rondas). Tudo validado em SQL (`make_offer`, `counter_offer`, `accept_counter`; `_execute_transfer` move também o jogador da troca).
- **Balneário** (`/g/[id]/social`): mural da liga com mensagens até 280 caracteres (20/dia por treinador), 5 reações, apagar pelo autor ou pelo dono da liga. Publicações automáticas: transferências que envolvem um treinador humano, conquistas desbloqueadas e a manchete d'O Apito de cada jornada.
- **Conquistas** (achievements-v1, 28): séries (invicto 5/10, vitórias 3/5, 3 jogos sem sofrer), goleadas, festival de golos, reviravoltas, golos tardios, hat-tricks, equipa da jornada, dérbis contra treinadores, liderança, títulos, objetivo da direção, mercado (contratação ≥ €20M, vender pelo dobro, trocas, negócios entre amigos), adeptos, direção, obras, imprensa, Gabinete e saldo. Avaliadas depois de cada jornada (e na primeira visita ao Balneário), com notificação e publicação no mural.
- **Treinadores**: cartão por treinador humano com V-E-D, golos, % de vitórias, títulos, conquistas recentes e o confronto direto contigo.

## Fase 4b — o que existe

- **Taça da Liga dos Amigos** (`/g/[id]/cup`, cup-v1): eliminatórias a uma mão com todos os clubes, quadro por força (os mais fortes ficam isentos quando o número de clubes não é potência de 2). As rondas jogam-se logo a seguir a jornadas do campeonato espalhadas pela época (ex.: 18 clubes → 5 rondas após as jornadas 6, 11, 17, 23 e 28 de 34). Empate → penáltis (5 + morte súbita; qualidade do marcador e do guarda-redes por OVR; sem prolongamento na v1). Usa a escalação guardada; os jogos da taça cansam (condição por minutos) e podem lesionar, mas não contam para estatísticas da liga nem castigos. Prémios: €1M/€0,6M/€0,4M por eliminatória ganha nas rondas finais, €4M ao vencedor e €2M ao finalista. O vencedor é anunciado no mural e conta para a conquista "Taça no museu".
- **Academia** (career-v1, separador Formação do Clube): depois de ~2/3 da época, cada clube recebe 3–6 jovens fictícios (16–18 anos, OVR 40–66, potencial por banda), mais e melhores com coordenador da formação de nível alto. Promover = contrato de 3 épocas na equipa principal; dispensar = sai. A IA promove o melhor se tiver espaço e dispensa os restantes no fim da época. Conquista "Prata da casa".
- **Contratos** (separador Contratos): jogadores no último ano pedem um salário para renovar (1–3 épocas; mais caro se a moral estiver baixa ou forem ambiciosos, mais barato se leais; ≥ 33 anos só 1 época). Jogadores muito descontentes recusam renovar. Na mudança de época, quem não renovou num clube humano **sai a custo zero** (nunca abaixo do plantel mínimo); os clubes da IA continuam a renovar automaticamente.
- **Jogadores livres** (Mercado): podem ser contratados por qualquer treinador sem custo de transferência, ao salário pedido, até à 3.ª jornada; depois a IA fica com os restantes, cada um no clube que mais precisa daquela posição.

## Mercado (market-v2, estilo OSM) — o que existe

- **Lista de Transferências** (`/g/[id]/market`): um só mercado para a liga. A cada jornada entram jogadores novos — de clubes da IA desta liga (nunca os 3 melhores de cada clube nem abaixo do plantel mínimo + 2) e de clubes estrangeiros do dataset (OVR dentro da gama da liga). 4–8 por jornada (3 + nº de treinadores), o dobro no início de cada época, até 24 abertos. Os caros são mais raros (peso ∝ valor^−0,6), com ~12% de hipótese de sair uma "pérola" do terço mais valioso.
- **Preço**: entra a 1,15–1,35× o valor e desce 8% por jornada sem comprador até 70% do valor; depois de uma jornada no mínimo sai da lista. A UI mostra o preço da próxima jornada e "Última jornada".
- **Comprar**: um clique, ao preço mostrado (se o preço mudou entretanto, a compra falha e mostra o novo); quem clicar primeiro leva. Estrangeiros ganham salário pela reputação do clube e contrato de 2+ épocas.
- **Vender**: o treinador põe jogadores na lista a preço fixo entre 50% e 150% do valor, com 4 vagas (`settings_json.market_slots`). Os amigos compram logo; a IA compra nas jornadas — probabilidade `clamp(1,6 − preço/valor)` × fase da época (1,3 no início → 0,7 no fim) × tamanho (jogadores caros vendem pior), no máximo uma compra por clube da IA por jornada, preferindo o clube com menos jogadores dessa posição.
- **Clubes da IA não respondem a propostas**: só vendem pela lista. Entre treinadores humanos mantêm-se as negociações (propostas, contrapropostas, trocas, notas). Ligas antigas podem voltar ao mercado clássico com `settings_json.market = 'classic'`.
- Tudo corre no servidor numa "ronda de mercado" por (época, jornada), idempotente (marcador `market_tick`), depois de cada jornada e na primeira visita ao mercado.

## Roleta, duelos e apostas — o que existe

- **Roleta da Liga** (`/g/[id]/slots`, slots-v1, Hoje › Roleta): cada giro custa **€500 000**, até **5 giros por dia** por treinador (dia na timezone da liga). Máquina com luzes, três rolos, som (Web Audio, com botão de silêncio), vibração e confetes; o resultado é sempre decidido no servidor (aleatoriedade criptográfica, não previsível pelo código aberto). Probabilidades públicas na página:
  - **Comum (~43%)**: €100–400k, +6 moral a 3 jogadores, +8% condição ao plantel.
  - **Raro (~22%)**: €1–2,5M, giro grátis, carta Escudo, emblema raro.
  - **Épico (~11%)**: carta Imunidade a lesões, carta Bilheteira ×2, emblema épico, **jogador** (de clubes fora da liga e fora da Lista; peso ∝ valor^−0,8 — os caros são raros mas qualquer um pode sair; plantel cheio → metade do valor em dinheiro).
  - **Lendário (~1,6%)**: €5–10M, emblema animado, **JACKPOT** (pote da liga: €2M + 20% de cada giro + todas as multas).
  - **Azar (~22%)**: lesão no treino (1–3 jornadas), multa €300k–€1M (vai para o jackpot), jogador amuado (−12 moral). **Desastre (0,5%)**: −1 ponto na classificação.
  - O dono da liga pode desligar os azares e decide o −1 ponto (desligado por omissão → sai uma multa). O Escudo anula o próximo azar.
- **Cartas guardáveis**: Escudo (automático), Imunidade (ativa-se para a próxima jornada: as lesões dessa jornada não contam), Bilheteira ×2 (a receita de bilheteira dessa jornada em casa vem a dobrar), Giro grátis (não conta para o limite).
- **Emblemas**: riscas, aros, estrela, faixa, xadrez (raros), ouro, carbono, vitral (épicos), chama e relâmpago (animados, lendários). Coleção na Roleta; o emblema escolhido aparece no cabeçalho, na tabela e nas apostas. Repetido → €250k.
- **Duelos**: desafias outro treinador; €500 000 ficam reservados; ao aceitar, os dois giram (pontos por símbolo, pares +5, trio ×2) e quem fizer mais leva €500 000 do outro; empate = ninguém paga. No "Por decidir" e no mural.
- **Mural**: épicos, lendários, desastres, jackpots, duelos e apostas grandes são publicados automaticamente.
- **Apostas** (`/g/[id]/bets`, betting-v1, Jogo › Apostas): odds 1X2 para todos os jogos da próxima jornada, pela força das equipas e o fator casa (margem 7%). Cada treinador aposta o que quiser (mínimo €10 000, até ao dinheiro disponível) em qualquer jogo **menos o seu**. A aposta sai logo da conta; o prémio (aposta × odd) entra depois da jornada. Tabela dos apostadores por lucro. O dono pode desligar as apostas.
- Tudo com dinheiro do jogo — não há forma de comprar giros ou fichas com dinheiro real.

## Próximas fases — regras de desenho já acordadas

- Idades: só reais (Wikidata, CC0) ou desconhecidas; desenvolvimento por idade só com idade real.
- Conferências: texto livre do treinador + tom escolhido; o tom decide efeitos (moral ±1–3, confiança da direção, adeptos, "mind games" contra rival humano); o texto aparece no jornal.
- Direção: confiança 0–100 com avisos e cortes de orçamento, sem despedimentos.
- Eventos: ~1–2 por treinador por jornada, prazo + escolha por omissão, impacto limitado (≤ ~5% da força, ≤ 10% do saldo), mesmas probabilidades para humanos e IA.
- Conteúdo como dados: eventos, manchetes, marcas e perguntas da imprensa em catálogos versionados (sem migrações para adicionar conteúdo).
