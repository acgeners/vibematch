-- 146_user_calculated_scores_precision.sql
--
-- Corrige a mig 145: eu criei as colunas como `numeric` livre, mas as de `calculated_scores`
-- têm ESCALA FIXA. O Postgres arredonda na escrita, então a mesma conta grava valores
-- diferentes nas duas tabelas:
--
--   calculated_scores.expected_score  numeric(4,2)  → 8.05
--   user_calculated_scores.expected_score numeric   → 8.052998578935533
--
-- O número é o mesmo; o ARREDONDAMENTO é que não veio junto. Passou batido no `create table`
-- porque tipo e precisão parecem a mesma coisa e não são.
--
-- Consequência se ficasse: a Nota Prevista de um Leitor free renderizada com 15 casas, o
-- espelho eternamente "divergente" do original, e qualquer comparação entre as duas tabelas
-- (que é como esta fatia se testa) acusando erro onde não há.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/146_user_calculated_scores_precision.sql

alter table public.user_calculated_scores alter column expected_score          type numeric(4,2);
alter table public.user_calculated_scores alter column expected_baseline       type numeric(5,3);
alter table public.user_calculated_scores alter column expected_quality_adj    type numeric(5,3);
alter table public.user_calculated_scores alter column calc_score              type numeric(6,4);
alter table public.user_calculated_scores alter column chance_score            type numeric(5,2);
alter table public.user_calculated_scores alter column personal_fit            type numeric(4,3);
alter table public.user_calculated_scores alter column personal_fit_percentile type numeric(5,2);
alter table public.user_calculated_scores alter column alignment_score         type numeric(5,2);
alter table public.user_calculated_scores alter column mae_calc                type numeric(6,4);
alter table public.user_calculated_scores alter column rmse_calc               type numeric(6,4);

-- `tag_overlap_net` e `confidence` são `numeric` livre também no original — ficam como estão.

-- Confere (tem que devolver 0):
--   select count(*) from calculated_scores cs
--   join user_calculated_scores u on u.work_id = cs.work_id
--   where cs.expected_score is distinct from u.expected_score
--      or cs.calc_score is distinct from u.calc_score
--      or cs.personal_fit is distinct from u.personal_fit;
