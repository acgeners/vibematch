-- 153_works_personal_status_nullable.sql
-- FASE E — `works` para de receber escrita pessoal. Isto tira o último obstáculo.
--
-- Das 19 colunas pessoais, 5 são NOT NULL. Quatro delas têm DEFAULT (is_favorite=false,
-- observation_adjustment=0, synopsis_interest_skipped=false, synopsis_quality_source=
-- 'legacy_unknown'), então um INSERT que as omite continua funcionando.
--
-- `personal_status_id` é NOT NULL **sem default** — é a única que impede o `insert` de
-- simplesmente parar de mandar estado pessoal. Sem este `drop not null`, a criação de obra
-- quebraria com "null value in column personal_status_id violates not-null constraint" no
-- instante em que a Fase E entrasse.
--
-- Depois desta migration, uma obra nova nasce com `works.personal_status_id = NULL`. Isso é
-- CORRETO e não é lido por ninguém: desde a Fase D todo consumidor do status lê o espelho
-- (`user_work_state`) ou a view `works_owner`, e ali "sem linha" já significa "Want to Read".
-- A coluna vira o que ela é hoje na prática: um resquício esperando o `DROP`.
--
-- ⚠️ NÃO é o DROP. É reversível (`set not null` de volta, desde que não haja NULL). O DROP
-- continua bloqueado pelo pg_dump --schema-only (§13.4) — esta migration não o antecipa.
--
-- ⚠️ `alter table` pega AccessExclusiveLock: PARE o dev server antes (a mig 142 deu deadlock).
--
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/153_works_personal_status_nullable.sql

alter table public.works alter column personal_status_id drop not null;

comment on column public.works.personal_status_id is
  'LEGADO — esperando o DROP. O status de leitura é PESSOAL e mora em user_work_state (Fatia 1). Nada escreve aqui desde a Fase E e nada lê desde a Fase D (os consumidores do dono leem a view works_owner). NOT NULL removido na mig 153 justamente para que o insert pudesse parar de preenchê-la.';
