-- 188_recommendation_runs_mode_seeds.sql
-- `recommendation_runs.mode` passa a aceitar 'seeds' — as runs de "Mais como estas".
--
-- 🔴 SEM esta migration a Fase 2 quebra NO PIOR MOMENTO POSSÍVEL: depois de a chamada ao
-- modelo ter sido feita e paga. O CHECK só é avaliado no INSERT, que é o último passo —
-- então o usuário esperaria os ~15s do ranker, pagaria os ~5¢, e receberia
-- `violates check constraint "recommendation_runs_mode_check"`, sem resultado e sem
-- reembolso. O erro é de schema, mas a conta é de API.
--
-- O CHECK atual (mig 047) admite apenas 'next_read', 'full_analysis' e 'ranking'.
--
-- ⚠️ 'seeds' é modo PRÓPRIO, e não 'ranking' reaproveitado, porque a pergunta é outra e o
-- `source_meta` guarda coisas diferentes: um run de ranking carrega os FILTROS da URL do
-- /ranking; um de sementes carrega as obras-semente, as anti-sementes e o peso do slider.
-- Colapsá-los tornaria impossível responder "quais recomendações saíram de sementes?" — e
-- é justamente essa a procedência que o Veredito aplicado ao catálogo precisa registrar,
-- porque a justificativa foi escrita SOB o contexto daquelas sementes.
--
-- ⚠️ Constraint de CHECK não pode ser alterada — é DROP + ADD. A janela entre os dois é
-- irrelevante (roda numa transação só), mas o `not valid` NÃO é usado de propósito: a
-- tabela tem poucos milhares de linhas e todas já satisfazem o predicado novo (ele só
-- ACRESCENTA um valor), então validar na hora é barato e deixa a constraint confiável para
-- o planner.
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/188_recommendation_runs_mode_seeds.sql

alter table public.recommendation_runs
  drop constraint if exists recommendation_runs_mode_check;

alter table public.recommendation_runs
  add constraint recommendation_runs_mode_check
  check (mode = any (array['next_read'::text, 'full_analysis'::text, 'ranking'::text, 'seeds'::text]));

comment on column public.recommendation_runs.mode is
  'next_read | full_analysis | ranking | seeds. "seeds" = run de "Mais como estas" (/descobrir): source_meta carrega as obras-semente, as anti-sementes e o peso do slider, e é a procedência da justificativa — ela foi escrita sob o contexto daquelas sementes, não contra o perfil sozinho.';
