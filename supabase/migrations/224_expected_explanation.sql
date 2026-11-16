-- 224 — A JUSTIFICATIVA da Nota Prevista (pedido de 2026-11-16)
--
-- O QUE ESTA MIGRATION FAZ: só estrutura. Uma coluna jsonb nas duas tabelas de scores, para o recálculo
-- gravar a decomposição da Nota Prevista que ele já calcula e jogava fora. Nenhuma nota muda.
--
--   calculated_scores.expected_explanation       — a do dono (quem lê é a página da obra)
--   user_calculated_scores.expected_explanation  — a de cada pessoa, como as demais colunas pessoais
--
-- FORMATO (dono: `lib/calculations/expected-explanation.ts`, versão `v: 1`):
--   {"v": 1, "base": 7.62, "contributions": {"romance": 0.31, "Nota.M": -0.04, …}, "obs": 0.3,
--    "score": 7.85, "editions": {"normal": {…mesmo formato…}, "r18": {…}}}
--   · `base` = a previsão de uma obra média do treino; `contributions` = quanto cada entrada do modelo
--     somou ou tirou (coeficiente × distância da média); `obs` = o ajuste manual; `score` = a Nota
--     Prevista final. base + Σ contributions = a previsão linear, antes do ajuste e do limite 0–10.
--   · `editions` só em obra `mixed`: a justificativa de cada edição, como `expected_by_edition`.
--
-- ⚠️ NÃO entra na guarda do contrato canônico (mig 202): a coluna não é resultado de scoring por si
-- só — ela é gravada no MESMO upsert de `expected_score`, que é guardado. Um checkout que não conheça
-- a coluna simplesmente não a grava (fica a da gravação anterior, e a página a esconde quando a nota
-- não bate mais).
--
-- ORDEM DE PUBLICAÇÃO: esta migration ANTES do deploy (o código novo grava a coluna; sem ela o upsert
-- do recálculo falharia) → deploy → `npm run recalc:scores:cloud` para preencher.

alter table public.calculated_scores add column if not exists expected_explanation jsonb;
alter table public.user_calculated_scores add column if not exists expected_explanation jsonb;

comment on column public.calculated_scores.expected_explanation is
  'Justificativa da Nota Prevista: base + contribuição de cada entrada do modelo + ajuste manual (lib/calculations/expected-explanation.ts). Migration 224.';
comment on column public.user_calculated_scores.expected_explanation is
  'Como calculated_scores.expected_explanation, por usuário. Migration 224.';
