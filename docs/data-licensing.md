# Licenciamento de dados

**Não é aconselhamento jurídico.** Resumo do que foi verificado nas páginas públicas da PlayerElo em 2026-10-15 e das salvaguardas implementadas.

## O que a PlayerElo diz publicamente

- Os planos pagos permitem uso comercial; o plano Business acrescenta "commercial licence" e SLA.
- Os dados são descritos como ratings e análises calculados pela própria PlayerElo (não um feed de terceiros revendido 1:1).
- **Não há termos públicos sobre armazenamento, cache, redistribuição ou exibição** de nomes/estatísticas, nem sobre se o plano Free permite uso público.

## Consequências para o Touchline

| Tema | Decisão |
|---|---|
| Uso público / comercial | Não lançar publicamente com dados reais sem confirmação escrita da PlayerElo (contacto indicado na página de API). Plano Free = avaliação/hobby. |
| Retenção de respostas brutas | **Desligada** por omissão: guarda-se só hash + metadados (`import_raw_records.payload = null`). Ativar apenas com `PLAYERELO_RETAIN_RAW=true` depois de confirmar a licença. |
| Snapshot derivado | O catálogo guarda campos normalizados necessários ao jogo (nome, posição, clube, Elo, EAR, minutos). Confirmar com a PlayerElo se a retenção destes campos dentro de ligas privadas é permitida no plano contratado. |
| Exibição | Ligas privadas entre amigos (membros autenticados). O OVR mostrado é derivado pelo jogo e identificado como tal; o Elo bruto não é mostrado na UI. |
| Nomes de clubes e ligas | Usados como texto. Sem logótipos nem fotografias: só cores neutras e iniciais. Não usar marcas/escudos sem autorização. |
| Imagens | Nenhuma imagem de jogadores. Supabase Storage fica para recursos licenciados no futuro. |
| Idades | Só de fonte licenciada ligada por ID. Nunca gerar datas de nascimento para pessoas reais. |
| Valores e salários | Valor do fornecedor (se existir) marcado como estimativa; salários/contratos são regras do jogo. |
| Dados fictícios | `provider = 'synthetic'`, `is_synthetic = true`, badge "Dados fictícios" na UI. Nomes gerados por sílabas. |

## Wikidata (datas de nascimento)

- Dados estruturados do Wikidata estão em **CC0** (domínio público): podem ser guardados e mostrados sem atribuição obrigatória (atribuímos na mesma em `attributes_json.birth_date.source`).
- Só se usam a API de pesquisa e o endpoint SPARQL oficiais, com User-Agent identificável e ≤ 1 pedido/s — nada de *scraping*.
- Só se guarda a data de nascimento (e o QID) quando a correspondência é única; nunca se inventa nem se estima uma idade.

## Checklist antes de convidar amigos com dados reais

- [ ] Plano PlayerElo adequado e resposta escrita sobre retenção/exibição em ligas privadas.
- [ ] `PLAYERELO_RETAIN_RAW` mantido `false` salvo autorização.
- [ ] Sem logótipos/fotografias.
- [ ] Página `/` mantém o aviso de que o jogo não tem licenças oficiais.
