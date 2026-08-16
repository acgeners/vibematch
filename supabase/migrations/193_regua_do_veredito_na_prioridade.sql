-- A régua do Veredito IA na Prioridade — média/σ do catálogo, medidas no recalc.
--
-- 🔴 POR QUE: até aqui a Prioridade somava `alignment_score / 10` à Nota Prevista,
-- o que converte UNIDADE mas não ESCALA. Medido em 2026-08-16 (clone local, 981
-- obras com Prevista, 695 com veredito): o veredito tem média 54,2 numa escala
-- 0–100 enquanto a Prevista vale 76,9 na mesma escala, então o termo entrava 2,27
-- pontos abaixo da âncora e o "ajuste" virava um deslocamento para baixo aplicado
-- só a quem tinha veredito — 625 das 695 obras desciam, média −0,49 ponto.
--
-- Como 29% do catálogo NÃO tem veredito, o efeito era de ORDENAÇÃO: 37.148 pares
-- invertiam a favor de quem não passou pelo re-rank, contra 82 no sentido oposto.
-- A maior alavanca da Prioridade não era o gosto de ninguém — era ter sido
-- processada.
--
-- Com o desvio padronizado (z do veredito × σ da Prevista), o ajuste passa a ser
-- centrado: 367 sobem / 328 descem, shift médio +0,001, e as inversões caem para
-- 2.460. O rho com o `user_score` das 210 rotuladas vai de 0,5828 para 0,6433
-- (Prevista pura: 0,6456).
--
-- ⚠️ Estas três medidas descrevem o CATÁLOGO e por isso moram aqui, não na tela:
-- derivá-las das linhas visíveis faria a mesma obra ter Prioridades diferentes em
-- duas páginas, conforme o filtro. Mesmo motivo de `gpt_mean`, logo acima nesta
-- tabela. Enquanto forem NULL o veredito simplesmente não ajusta, e a Prioridade
-- é a Nota Prevista — o lado seguro, e o mais bem medido.

alter table public.formula_config
  add column if not exists verdict_mean numeric(6,3),
  add column if not exists verdict_std numeric(6,3),
  add column if not exists expected_std numeric(6,4);

comment on column public.formula_config.verdict_mean is
  'Média do alignment_score (0–100) no catálogo, medida no último recalc. Centro do ajuste do Veredito na Prioridade.';
comment on column public.formula_config.verdict_std is
  'Desvio-padrão do alignment_score no catálogo. Denominador do z do Veredito.';
comment on column public.formula_config.expected_std is
  'Desvio-padrão da Nota Prevista (0–10). Converte o z do Veredito para a escala da âncora.';
