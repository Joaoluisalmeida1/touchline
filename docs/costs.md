# Custos (estimativas, verificadas em 2026-10-15)

Não há promessa de custo zero: os planos gratuitos têm limites e a Vercel Hobby é **só para uso pessoal/não comercial**.

## Limites atuais relevantes

| Serviço | Free/Hobby | Pago de entrada |
|---|---|---|
| Supabase | 500 MB BD/projeto, 5 GB egress, 50 000 MAU, 2 projetos ativos, **pausa após 1 semana sem atividade** | Pro desde $25/mês: 8 GB disco, 250 GB egress, sem pausa, backups |
| Vercel | Hobby grátis, não comercial; 1 M invocações, 4 h CPU ativo, 100 GB transferência; cron 1×/dia ±59 min; funções até 300 s | Pro $20/utilizador/mês: cron ao minuto, funções até 800 s |
| PlayerElo | 500 pedidos/mês, 10/min | Pro €19 (10 000/mês, 120/min), Business €199 com licença comercial |

## Volume do jogo (medido localmente)

- Simulação: ~3 ms por jogo; uma jornada de 10 jogos + escrita ≈ 1–3 s no total (dominado por I/O).
- Dados por liga de 18 clubes: ~430 jogadores, ~306 jogos/época × (~60 eventos + ~30 linhas de stats) ≈ 30 000 linhas/época ≈ 10–15 MB/época incluindo `input_snapshot` dos jogos.
- Catálogo: ~700 jogadores por liga importada (+ snapshot) ≈ 1–2 MB por liga.

## Cenários

| Utilizadores | Ligas | BD após 1 época | Pedidos PlayerElo | Plano sugerido | Custo/mês aprox. |
|---|---|---|---|---|---|
| 10 | 1–2 | < 50 MB | ~60 uma vez (7 ligas) | Supabase Free + Vercel Hobby + PlayerElo Free | €0 (atenção à pausa do Supabase e ao uso não comercial) |
| 50 | 3–8 | 50–150 MB | idem | Supabase Free (no limite de 500 MB em ~3 épocas) ou Pro; Vercel Hobby se não comercial | €0–25 |
| 200 | 10–30 | 150–500 MB | idem + refreshes | Supabase Pro + Vercel Pro + PlayerElo pago se houver uso comercial | ~$45 + €19–199 |

## Pontos de upgrade

1. **Supabase Pro** quando: a pausa semanal incomodar, BD > ~400 MB, ou quiser backups automáticos.
2. **Vercel Pro** quando: quiser kickoffs a horas exatas (cron ao minuto) ou houver uso comercial.
3. **PlayerElo pago** para: uso comercial, refrescar datasets mais vezes, ou enriquecimento por jogador (value/style custam 1 pedido por jogador).
4. Reduzir armazenamento: `match_runs.input_snapshot` pode ser purgado ao fim da época (o seed + versão + `input_hash` continuam a provar o resultado se o snapshot for exportado antes).
