# Balanceamento do jogo

Todos os coeficientes são **hipóteses de protótipo**, não verdades empíricas. Mudar valores que alteram resultados obriga a subir a versão (`ENGINE_VERSION`, `INITIAL_RATING_VERSION`, `PROGRESSION_VERSION`, `ECONOMY_VERSION`). O teste golden master (`src/engine/golden.test.ts`) falha se o resultado mudar sem essa subida; ver [guia do operador](operator-guide.md#testes).

## 1. Rating inicial — `initial-rating-v1` (`src/engine/rating/initial-rating.ts`)

1. **Escala absoluta**: `discover --anchors` lê o Elo do jogador no rank global *r* (`/v1/players?offset=r-1&limit=1`, lista ordenada por Elo). Cada rank tem um OVR-alvo (rank 1 → 93, 100 → 86, 1 000 → 80, 7 000 → 72, 30 000 → 61, 80 000 → 48) e o Elo é interpolado entre âncoras. Assim, um titular de uma liga fraca **não** ganha OVR alto por percentil interno. Sem âncoras: escala robusta da amostra (mediana/MAD + logística), com aviso no relatório.
2. Correção posicional: 50% da diferença de mediana do grupo, limitada a ±3, só com ≥30 jogadores.
3. Forma: `EAR180` normalizado, peso 0,5, limite **±1,5**, multiplicado pela confiança (minutos).
4. Mercado (se existir valor): resíduo de `ln(valor) ~ OVR` (OLS na amostra), peso 0,6, limite **±1,5**. Testado: €10 M → €100 M com o mesmo Elo move ≤2 OVR.
5. Regularização: `prior(liga, posição) + (raw − prior) × (0,8 + 0,2·confiança)`; confiança = minutos/2 500 (0,15–1).
6. Sem double counting: golos/assistências não entram; o Elo já agrega o desempenho.
7. Potencial (oculto, inferido): margem por idade (17 anos ≈ +15 … 29 anos 0) × qualidade, + resíduo de mercado para ≤23 anos, × ruído determinístico `hash(snapshot, jogador)`; teto suave a partir de 94. **Idade desconhecida** → margem pequena (+0,5…+3) e sem progressão por idade.
8. `derivation_json` guarda cada componente (base, offsets, ajustes, prior, confiança, flags).

Testes: elite ≫ mediana sem inflacionar (≥90 < 2%), titular de liga fraca < reserva de elite com Elo superior, nulos válidos e sinalizados, determinismo.

## 2. Motor de jogo — `match-v1.0.0`

Posses discretas (~25 s × ritmo × estilo): pressão/erro na construção → progressão ao último terço (`sigmoid((controlo_A − controlo_B)/22 + táticas)`) → criação de ocasião (`sigmoid(−1,55 + (ataque_A − defesa_B)/22 + casa + mentalidade + contexto)`) → tipo de remate (área, fora, cabeça, 1×1, bolas paradas, penálti) → xG base × qualidade (±) → finalização vs guarda-redes → **um único sorteio de golo**. Golos, assistências, remates, xG, defesas, cartões e notas saem dos mesmos eventos (testes de consistência em 300 jogos).

Força efetiva do jogador = OVR × adequação posicional (1 / 0,88 / 0,75; GR fora 0,40; jogador de campo na baliza 0,35) × fadiga × forma (±3%) × moral (±1,5%) × ritmo. Unidades de equipa (controlo/ataque/defesa/GR) são médias ponderadas por linha e perfil — o perfil redistribui pesos, não soma pontos. Ruído diário por equipa (σ = 2,2 OVR) cria surpresas realistas. Inferioridade numérica: −10% por jogador.

Trade-offs implementados: pressão alta (mais recuperações altas, +desgaste, espaço nas costas quando batida), linha alta (mais foras de jogo, mais 1×1 sofridos), bloco baixo (menos ocasiões concedidas, mais remates de fora), passe direto (progride mais, último passe pior), contra-ataque (transições perigosas, menos paciência em ataque organizado), mentalidade ofensiva (mais ocasiões para ambos), largura vs estreiteza.

### Calibração (100 000 jogos, `reports/calibration-match-v1.0.0.json`)

| Métrica | Resultado | Banda de referência |
|---|---|---|
| Golos/jogo (todas as diferenças) | 3,06 | 2,5–3,1 |
| Golos/jogo, equipas iguais | 2,80 | — |
| Empates (iguais / global) | 28,4% / 22,7% | 20–30% |
| 0-0 | 5,3% | — |
| Remates / enquadrados / xG por equipa | 12,1 / 4,4 / 1,44 | ~12–13 / ~4,5 / ~1,3–1,5 |
| Amarelos por equipa, vermelhos/jogo, penáltis/jogo | 1,87 · 0,18 · 0,32 | ~2 · ~0,15 · ~0,3 |
| Vitória do mais forte (+0/+2/+4/+6/+8/+10/+15 OVR) | 36/45/53/61/70/76/89% | monotónico |
| Campo neutro, iguais | 35,9% vs 34,4% | simétrico |
| Calibração xG (bins 0,1) | conversão ≈ xG (ex.: 0,139 → 0,144; 0,443 → 0,465) | — |
| PPG por tática (casa, força igual) | 1,53–1,69 (balanced 1,58) | sem tática dominante |
| Fitness inicial 72 (fora, iguais) | 0,77 ppg | penaliza rodar pouco |

Conhecido para afinar: contra-ataque/ofensiva ~+0,1 ppg acima de equilibrado; vitórias com +15 OVR podem ser excessivas (diferenças desse tamanho são raras dentro de uma liga).

## 3. Progressão — `progression-v1`

- **Forma**: EWMA (meia-vida 5 jogos) de `nota − 6,6 + 0,04·(força adversária − própria)`, limitada a ±3; sem jogar regressa a 0 (×0,9). Afeta o jogo só ±3%.
- **Fitness**: termina o jogo com a stamina do motor; recupera `20 − 0,15·fadiga + físico` por jornada. **Fadiga** acumulada `0,6·f + 20·min/90`.
- **Sharpness**: + até 15 por jogo, −6 sem jogar. **Moral**: ±4 por resultado, ±3 por nota, −1,5 no banco para jogadores ≥75; regressa a 60.
- **XP por jogo** = `0,75 × dev_rate × min/90 × fator_adversário × (0,40·desempenho + 0,25·treino + 0,20·idade + 0,15·sharpness) × margem_ao_potencial` (acima do potencial a margem é negativa → teto suave). Sem jogar: treino mínimo; idle prolongado retira XP; ≥30 anos (idade verificada) declínio suave.
- **OVR muda só em checkpoints** (cada 4 jornadas), no máximo ±1 (3 XP por ponto), com XP limitado para evitar saltos. Cada mudança gera `player_progression_log` com texto: *"+1 OVR: desenvolvimento consistente, 360 minutos no período, nota média 7,1"*.
- Exactly-once: logs com chave `fixture:<id>:<jogador>`, jogadores com `version`.

### Simulação de 6 épocas (`npm run sim:seasons -- 6`, liga fictícia de 18 clubes)

| Grupo (≥1 500 min) | ΔOVR médio/época | Alvo |
|---|---|---|
| Estabelecidos 24–29 | +0,1 a +0,6 | −1 a +1 |
| Jovens ≤21 | +1,3 a +2,2 | 0 a +3 |
| Veteranos ≥31 | −0,8 a −1,1 | 0 a −2 |
| Jogadores com +4 numa época | 0–4 em ~430 | raro |

Um 85 nunca chegou a 90 numa época (teste). OVR médio da liga desce lentamente porque não há *youth intake* (pós-MVP).

## 4. Economia — `economy-v1`

Salário semanal = €3 000 × e^(0,13·(OVR−65)) × (0,6 + 0,8·reputação/100). Saldo inicial = 12% do valor do plantel + €40 000 × reputação. Por jornada: patrocínio €60 000 + 28·rep²; bilheteira (casa) €150 000 + 60·rep²; prémio de vitória €120 000 / empate €40 000. Fim de época: €40 M repartidos linearmente pela classificação + €8 M ao campeão. Valor de mercado alvo = fórmula(OVR, posição, idade) × √(âncora do fornecedor) × forma × contrato × potencial, aproximado 15% por checkpoint (sem saltos), mínimo €50 000.

Simulação de 6 épocas: nenhum clube em falência sistemática, valor médio +20% em 6 épocas (< 2×), caixa entre ~€14 M e ~€117 M.
